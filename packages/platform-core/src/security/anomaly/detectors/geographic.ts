/**
 * Geographic Anomaly Detector
 *
 * Detects impossible travel scenarios by analyzing geographic locations
 * of user logins and calculating travel speed between them using the
 * Haversine formula.
 *
 * Flags suspicious activity when:
 * - Travel speed between logins exceeds maximum plausible speed (1200 km/h)
 * - Access from high-risk countries
 * - Potential VPN/proxy usage detected
 *
 * @packageDocumentation
 * @module security/anomaly/detectors/geographic
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../../../common/logger.js';
import { getRedis } from '../../../common/redis.js';
import type {
  Detector,
  DetectionResult,
  SecurityEvent,
  GeoLocation,
  GeographicDetectorConfig,
  Indicator,
  AnomalySeverity,
} from '../types.js';
import {
  DEFAULT_GEOGRAPHIC_DETECTOR_CONFIG,
  AnomalySeverity as Severity,
} from '../types.js';

const logger = createLogger({ component: 'geographic-detector' });

// =============================================================================
// Constants
// =============================================================================

/** Earth radius in kilometers */
const EARTH_RADIUS_KM = 6371;

/** Redis key prefix for location history */
const LOCATION_HISTORY_PREFIX = 'vorion:anomaly:geo:history:';

/** Maximum number of location records to keep per user */
const MAX_LOCATION_HISTORY = 100;

/** Time-to-live for location records in seconds (30 days) */
const LOCATION_TTL_SECONDS = 30 * 24 * 60 * 60;

// =============================================================================
// Haversine Distance Calculation
// =============================================================================

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate the great-circle distance between two points using the Haversine formula
 *
 * @param lat1 - Latitude of first point in decimal degrees
 * @param lon1 - Longitude of first point in decimal degrees
 * @param lat2 - Latitude of second point in decimal degrees
 * @param lon2 - Longitude of second point in decimal degrees
 * @returns Distance in kilometers
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

/**
 * Calculate travel speed between two locations given timestamps
 *
 * @param loc1 - First location
 * @param time1 - Timestamp of first location
 * @param loc2 - Second location
 * @param time2 - Timestamp of second location
 * @returns Speed in km/h, or null if time difference is zero
 */
export function calculateTravelSpeed(
  loc1: GeoLocation,
  time1: Date,
  loc2: GeoLocation,
  time2: Date
): number | null {
  const distanceKm = calculateHaversineDistance(
    loc1.latitude,
    loc1.longitude,
    loc2.latitude,
    loc2.longitude
  );

  const timeDiffMs = Math.abs(time2.getTime() - time1.getTime());
  const timeDiffHours = timeDiffMs / (1000 * 60 * 60);

  if (timeDiffHours === 0) {
    return null;
  }

  return distanceKm / timeDiffHours;
}

// =============================================================================
// Location History Record
// =============================================================================

/**
 * A recorded location event
 */
interface LocationRecord {
  location: GeoLocation;
  timestamp: string; // ISO string for Redis storage
  ipAddress: string;
  eventId: string;
}

// =============================================================================
// Geographic Detector Implementation
// =============================================================================

/**
 * Geographic anomaly detector implementing impossible travel detection
 */
export class GeographicDetector implements Detector {
  public readonly name = 'geographic';
  public readonly description =
    'Detects impossible travel and geographic anomalies based on login locations';

  private readonly config: GeographicDetectorConfig;
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor(
    config: Partial<GeographicDetectorConfig> = {},
    keyPrefix: string = LOCATION_HISTORY_PREFIX
  ) {
    this.config = { ...DEFAULT_GEOGRAPHIC_DETECTOR_CONFIG, ...config };
    this.redis = getRedis();
    this.keyPrefix = keyPrefix;
  }

  /**
   * Analyze an event for geographic anomalies
   */
  async detect(event: SecurityEvent): Promise<DetectionResult> {
    const startTime = performance.now();
    const indicators: Indicator[] = [];
    const suggestedActions: string[] = [];

    try {
      // Skip if no location data or no user ID
      if (!event.location || !event.userId) {
        return this.createResult(false, indicators, suggestedActions, startTime);
      }

      // Get previous locations for this user
      const previousLocations = await this.getLocationHistory(event.userId);

      // Check for impossible travel
      const travelResult = this.checkImpossibleTravel(
        event.location,
        event.timestamp,
        previousLocations
      );

      if (travelResult.detected) {
        indicators.push(...travelResult.indicators);
        suggestedActions.push(
          'Verify user identity through secondary authentication',
          'Check if user has legitimate reason for rapid travel (VPN, proxy)',
          'Review recent account activity for unauthorized access'
        );
      }

      // Check for high-risk country
      if (event.location.countryCode) {
        const countryResult = this.checkHighRiskCountry(event.location.countryCode);
        if (countryResult.detected) {
          indicators.push(...countryResult.indicators);
          suggestedActions.push(
            'Verify access is expected from this location',
            'Consider implementing additional authentication requirements'
          );
        }
      }

      // Calculate overall severity and confidence
      const hasAnomaly = indicators.length > 0;
      let severity: AnomalySeverity | undefined;
      let confidence: number | undefined;
      let description: string | undefined;

      if (hasAnomaly) {
        const totalWeight = indicators.reduce((sum, i) => sum + i.weight, 0);
        confidence = Math.min(100, totalWeight);
        severity = this.calculateSeverity(confidence, indicators);
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
      logger.error({ error, eventId: event.eventId }, 'Geographic detection failed');

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
   * Learn from an event by storing location history
   */
  async learn(event: SecurityEvent): Promise<void> {
    if (!event.location || !event.userId) {
      return;
    }

    try {
      const record: LocationRecord = {
        location: event.location,
        timestamp: event.timestamp.toISOString(),
        ipAddress: event.ipAddress,
        eventId: event.eventId,
      };

      const key = this.getHistoryKey(event.userId);

      // Add to sorted set with timestamp as score
      await this.redis.zadd(key, event.timestamp.getTime(), JSON.stringify(record));

      // Trim to keep only recent records
      const count = await this.redis.zcard(key);
      if (count > MAX_LOCATION_HISTORY) {
        await this.redis.zremrangebyrank(key, 0, count - MAX_LOCATION_HISTORY - 1);
      }

      // Set TTL
      await this.redis.expire(key, LOCATION_TTL_SECONDS);

      logger.debug(
        { userId: event.userId, location: event.location },
        'Stored location record'
      );
    } catch (error) {
      logger.error({ error, userId: event.userId }, 'Failed to store location record');
    }
  }

  /**
   * Reset all learned location history
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

      logger.info('Geographic detector baselines reset');
    } catch (error) {
      logger.error({ error }, 'Failed to reset geographic detector');
      throw error;
    }
  }

  /**
   * Get location history for a user
   */
  private async getLocationHistory(userId: string): Promise<LocationRecord[]> {
    const key = this.getHistoryKey(userId);

    // Get all records, newest first
    const records = await this.redis.zrevrange(key, 0, -1);

    return records.map((record) => JSON.parse(record) as LocationRecord);
  }

  /**
   * Get Redis key for user's location history
   */
  private getHistoryKey(userId: string): string {
    return `${this.keyPrefix}${userId}`;
  }

  /**
   * Check for impossible travel between current location and history
   */
  private checkImpossibleTravel(
    currentLocation: GeoLocation,
    currentTime: Date,
    history: LocationRecord[]
  ): { detected: boolean; indicators: Indicator[] } {
    const indicators: Indicator[] = [];

    if (history.length === 0) {
      return { detected: false, indicators };
    }

    // Check against recent locations
    for (const record of history.slice(0, 10)) {
      const previousTime = new Date(record.timestamp);
      const distance = calculateHaversineDistance(
        currentLocation.latitude,
        currentLocation.longitude,
        record.location.latitude,
        record.location.longitude
      );

      // Skip if distance is below minimum threshold
      if (distance < this.config.minDistanceKm) {
        continue;
      }

      const speed = calculateTravelSpeed(
        record.location,
        previousTime,
        currentLocation,
        currentTime
      );

      if (speed !== null && speed > this.config.maxTravelSpeedKmh) {
        const timeDiffMinutes = Math.abs(
          currentTime.getTime() - previousTime.getTime()
        ) / (1000 * 60);

        indicators.push({
          type: 'impossible_travel',
          description: `Travel speed of ${Math.round(speed)} km/h detected between locations ${Math.round(distance)} km apart in ${Math.round(timeDiffMinutes)} minutes`,
          value: speed,
          weight: this.calculateTravelWeight(speed),
        });

        indicators.push({
          type: 'location_change',
          description: `Location changed from ${this.formatLocation(record.location)} to ${this.formatLocation(currentLocation)}`,
          value: distance,
          weight: 20,
        });

        // Only report the most recent impossible travel
        break;
      }
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check if country is in high-risk list
   */
  private checkHighRiskCountry(
    countryCode: string
  ): { detected: boolean; indicators: Indicator[] } {
    const indicators: Indicator[] = [];

    if (this.config.highRiskCountries.includes(countryCode.toUpperCase())) {
      indicators.push({
        type: 'high_risk_country',
        description: `Access from high-risk country: ${countryCode}`,
        value: countryCode,
        weight: 40,
      });
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Calculate weight based on travel speed excess
   */
  private calculateTravelWeight(speed: number): number {
    const excess = speed - this.config.maxTravelSpeedKmh;
    const excessRatio = excess / this.config.maxTravelSpeedKmh;

    // Base weight of 50, increasing with speed excess
    return Math.min(100, 50 + Math.round(excessRatio * 50));
  }

  /**
   * Calculate severity based on confidence and indicators
   */
  private calculateSeverity(
    confidence: number,
    indicators: Indicator[]
  ): AnomalySeverity {
    const hasImpossibleTravel = indicators.some((i) => i.type === 'impossible_travel');
    const hasHighRiskCountry = indicators.some((i) => i.type === 'high_risk_country');

    if (confidence >= 90 || (hasImpossibleTravel && hasHighRiskCountry)) {
      return Severity.CRITICAL;
    }
    if (confidence >= 70 || hasImpossibleTravel) {
      return Severity.HIGH;
    }
    if (confidence >= 50) {
      return Severity.MEDIUM;
    }
    return Severity.LOW;
  }

  /**
   * Generate human-readable description
   */
  private generateDescription(
    event: SecurityEvent,
    indicators: Indicator[]
  ): string {
    const parts: string[] = [];

    const travelIndicator = indicators.find((i) => i.type === 'impossible_travel');
    if (travelIndicator) {
      parts.push(`Impossible travel detected: ${travelIndicator.description}`);
    }

    const countryIndicator = indicators.find((i) => i.type === 'high_risk_country');
    if (countryIndicator) {
      parts.push(countryIndicator.description);
    }

    return parts.join('. ') || 'Geographic anomaly detected';
  }

  /**
   * Format location for display
   */
  private formatLocation(location: GeoLocation): string {
    if (location.city && location.countryCode) {
      return `${location.city}, ${location.countryCode}`;
    }
    if (location.countryCode) {
      return location.countryCode;
    }
    return `${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`;
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
}

/**
 * Create a new geographic detector instance
 */
export function createGeographicDetector(
  config?: Partial<GeographicDetectorConfig>,
  keyPrefix?: string
): GeographicDetector {
  return new GeographicDetector(config, keyPrefix);
}
