/**
 * Account Compromise Detector
 *
 * Detects potential account compromise by analyzing:
 * - Password/MFA changes followed by unusual activity
 * - Session from new device after credential change
 * - Activity during user's typical offline hours
 * - Combined signals: impossible travel + new device + sensitive access
 *
 * Uses multi-signal fusion to identify compromised accounts with
 * high confidence.
 *
 * @packageDocumentation
 * @module security/anomaly/detectors/account-compromise
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
  GeoLocation,
} from '../types.js';
import { AnomalySeverity as Severity } from '../types.js';

const logger = createLogger({ component: 'account-compromise-detector' });

// =============================================================================
// Constants
// =============================================================================

/** Redis key prefix for user activity baselines */
const ACTIVITY_BASELINE_PREFIX = 'vorion:anomaly:compromise:baseline:';

/** Redis key prefix for credential change tracking */
const CREDENTIAL_CHANGE_PREFIX = 'vorion:anomaly:compromise:cred:';

/** Redis key prefix for device tracking */
const DEVICE_PREFIX = 'vorion:anomaly:compromise:device:';

/** Redis key prefix for session tracking */
const SESSION_PREFIX = 'vorion:anomaly:compromise:session:';

/** Redis key prefix for location history */
const LOCATION_PREFIX = 'vorion:anomaly:compromise:location:';

/** Time-to-live for baselines in seconds (30 days) */
const BASELINE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Time window to monitor after credential change (24 hours) */
const POST_CREDENTIAL_CHANGE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Minimum events to establish baseline */
const MIN_EVENTS_FOR_BASELINE = 20;

/** Earth radius in kilometers for distance calculation */
const EARTH_RADIUS_KM = 6371;

/** Maximum travel speed for impossible travel detection (km/h) */
const MAX_TRAVEL_SPEED_KMH = 1000;

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for account compromise detection
 */
export interface AccountCompromiseDetectorConfig {
  /** Hours in a day (24-hour format) */
  hoursInDay: number;
  /** Weight for impossible travel signal */
  impossibleTravelWeight: number;
  /** Weight for new device signal */
  newDeviceWeight: number;
  /** Weight for credential change + activity signal */
  credentialChangeActivityWeight: number;
  /** Weight for unusual time signal */
  unusualTimeWeight: number;
  /** Weight for sensitive access signal */
  sensitiveAccessWeight: number;
  /** Sensitive resources that increase risk */
  sensitiveResources: string[];
  /** Minimum confidence to combine signals */
  signalCombinationThreshold: number;
  /** Number of signals required for high confidence */
  minSignalsForHighConfidence: number;
  /** Track user active hours */
  trackActiveHours: boolean;
}

export const DEFAULT_ACCOUNT_COMPROMISE_CONFIG: AccountCompromiseDetectorConfig = {
  hoursInDay: 24,
  impossibleTravelWeight: 35,
  newDeviceWeight: 25,
  credentialChangeActivityWeight: 40,
  unusualTimeWeight: 20,
  sensitiveAccessWeight: 30,
  sensitiveResources: [
    'admin',
    'settings',
    'security',
    'billing',
    'payment',
    'export',
    'api-key',
    'credentials',
    'password',
    'mfa',
    '2fa',
  ],
  signalCombinationThreshold: 30,
  minSignalsForHighConfidence: 3,
  trackActiveHours: true,
};

// =============================================================================
// Baseline Types
// =============================================================================

/**
 * User's activity baseline for compromise detection
 */
interface UserActivityBaseline {
  userId: string;
  /** Known device fingerprints */
  knownDevices: string[];
  /** Known IP addresses */
  knownIps: string[];
  /** Active hours histogram (24 bins) */
  activeHourHistogram: number[];
  /** Typical locations */
  typicalLocations: Array<{
    latitude: number;
    longitude: number;
    countryCode?: string;
    city?: string;
  }>;
  /** Resources typically accessed */
  typicalResources: string[];
  /** Last credential change timestamp */
  lastCredentialChange?: string;
  /** Total events tracked */
  totalEvents: number;
  /** Last updated */
  lastUpdated: string;
}

/**
 * Credential change record
 */
interface CredentialChangeRecord {
  timestamp: string;
  type: 'password' | 'mfa' | 'email' | 'phone' | 'recovery' | 'api_key';
  ipAddress: string;
  deviceFingerprint?: string;
  location?: GeoLocation;
}

/**
 * Device session record
 */
interface DeviceSession {
  deviceFingerprint: string;
  firstSeen: string;
  lastSeen: string;
  ipAddress: string;
  userAgent?: string;
  location?: GeoLocation;
  eventCount: number;
}

/**
 * Combined signal tracking for multi-signal detection
 */
interface SignalState {
  impossibleTravel: boolean;
  newDevice: boolean;
  recentCredentialChange: boolean;
  unusualTime: boolean;
  sensitiveAccess: boolean;
  postCredentialChangeActivity: boolean;
  signals: string[];
  weights: number[];
}

// =============================================================================
// Account Compromise Detector Implementation
// =============================================================================

/**
 * Account compromise anomaly detector
 */
export class AccountCompromiseDetector implements Detector {
  public readonly name = 'account-compromise';
  public readonly description =
    'Detects account compromise through credential changes, device analysis, and multi-signal fusion';

  private readonly config: AccountCompromiseDetectorConfig;
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor(
    config: Partial<AccountCompromiseDetectorConfig> = {},
    keyPrefix: string = ACTIVITY_BASELINE_PREFIX
  ) {
    this.config = { ...DEFAULT_ACCOUNT_COMPROMISE_CONFIG, ...config };
    this.redis = getRedis();
    this.keyPrefix = keyPrefix;
  }

  /**
   * Analyze an event for account compromise indicators
   */
  async detect(event: SecurityEvent): Promise<DetectionResult> {
    const startTime = performance.now();
    const indicators: Indicator[] = [];
    const suggestedActions: string[] = [];

    try {
      const userId = event.userId;
      if (!userId) {
        return this.createResult(false, indicators, suggestedActions, startTime);
      }

      // Get user's baseline
      const baseline = await this.getBaseline(userId);

      // Initialize signal tracking
      const signalState: SignalState = {
        impossibleTravel: false,
        newDevice: false,
        recentCredentialChange: false,
        unusualTime: false,
        sensitiveAccess: false,
        postCredentialChangeActivity: false,
        signals: [],
        weights: [],
      };

      // Check for credential change event
      if (this.isCredentialChangeEvent(event)) {
        await this.recordCredentialChange(event);
      }

      // Check for post-credential-change activity
      const credResult = await this.checkPostCredentialChangeActivity(event, baseline);
      if (credResult.detected) {
        indicators.push(...credResult.indicators);
        signalState.recentCredentialChange = true;
        signalState.postCredentialChangeActivity = true;
        signalState.signals.push('credential_change');
        signalState.weights.push(this.config.credentialChangeActivityWeight);
        suggestedActions.push(
          'Verify recent credential change was authorized by the user',
          'Consider requiring additional verification'
        );
      }

      // Check for new device
      const deviceResult = await this.checkNewDevice(event, baseline);
      if (deviceResult.detected) {
        indicators.push(...deviceResult.indicators);
        signalState.newDevice = true;
        signalState.signals.push('new_device');
        signalState.weights.push(this.config.newDeviceWeight);
        suggestedActions.push(
          'Verify user recognizes the new device',
          'Consider sending device verification notification'
        );
      }

      // Check for impossible travel
      const travelResult = await this.checkImpossibleTravel(event, baseline);
      if (travelResult.detected) {
        indicators.push(...travelResult.indicators);
        signalState.impossibleTravel = true;
        signalState.signals.push('impossible_travel');
        signalState.weights.push(this.config.impossibleTravelWeight);
        suggestedActions.push(
          'Verify user location or VPN usage',
          'Check for credential theft indicators'
        );
      }

      // Check for unusual time activity
      const timeResult = this.checkUnusualTimeActivity(event, baseline);
      if (timeResult.detected) {
        indicators.push(...timeResult.indicators);
        signalState.unusualTime = true;
        signalState.signals.push('unusual_time');
        signalState.weights.push(this.config.unusualTimeWeight);
        suggestedActions.push(
          'Verify user was active during this time',
          'Check for automated/scripted access'
        );
      }

      // Check for sensitive access
      const sensitiveResult = this.checkSensitiveAccess(event, baseline);
      if (sensitiveResult.detected) {
        indicators.push(...sensitiveResult.indicators);
        signalState.sensitiveAccess = true;
        signalState.signals.push('sensitive_access');
        signalState.weights.push(this.config.sensitiveAccessWeight);
        suggestedActions.push(
          'Review sensitive resource access justification',
          'Consider additional authentication requirements'
        );
      }

      // Perform multi-signal fusion
      const fusionResult = this.performSignalFusion(signalState, baseline);
      if (fusionResult.detected) {
        indicators.push(...fusionResult.indicators);
        suggestedActions.push(
          'Initiate account security review immediately',
          'Consider temporary account lock pending investigation',
          'Contact user through verified channel to confirm activity'
        );
      }

      // Calculate overall result
      const hasAnomaly = indicators.length > 0;
      let severity: AnomalySeverity | undefined;
      let confidence: number | undefined;
      let description: string | undefined;

      if (hasAnomaly) {
        const { score, calculatedSeverity } = this.calculateRiskScore(indicators, signalState);
        confidence = score;
        severity = calculatedSeverity;
        description = this.generateDescription(event, indicators, signalState);
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
      logger.error({ error, eventId: event.eventId }, 'Account compromise detection failed');

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
    if (!event.userId) {
      return;
    }

    try {
      await Promise.all([
        this.updateUserBaseline(event),
        this.updateDeviceTracking(event),
        this.updateLocationHistory(event),
      ]);

      logger.debug(
        { userId: event.userId, eventType: event.eventType },
        'Updated account compromise baselines'
      );
    } catch (error) {
      logger.error({ error, userId: event.userId }, 'Failed to update account compromise baselines');
    }
  }

  /**
   * Reset all learned baselines
   */
  async reset(): Promise<void> {
    try {
      const patterns = [
        `${this.keyPrefix}*`,
        `${CREDENTIAL_CHANGE_PREFIX}*`,
        `${DEVICE_PREFIX}*`,
        `${SESSION_PREFIX}*`,
        `${LOCATION_PREFIX}*`,
      ];

      for (const pattern of patterns) {
        await this.deleteKeysByPattern(pattern);
      }

      logger.info('Account compromise detector baselines reset');
    } catch (error) {
      logger.error({ error }, 'Failed to reset account compromise detector');
      throw error;
    }
  }

  /**
   * Get baseline for a specific user
   */
  async getBaseline(userId: string): Promise<UserActivityBaseline> {
    const key = `${this.keyPrefix}${userId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return this.createEmptyBaseline(userId);
    }

    try {
      return JSON.parse(data) as UserActivityBaseline;
    } catch {
      return this.createEmptyBaseline(userId);
    }
  }

  /**
   * Update baseline for a user based on a security event
   */
  async updateBaseline(userId: string, event: SecurityEvent): Promise<void> {
    await this.updateUserBaseline(event);
  }

  // ===========================================================================
  // Private Detection Methods
  // ===========================================================================

  /**
   * Check if event is a credential change event
   */
  private isCredentialChangeEvent(event: SecurityEvent): boolean {
    const credentialEventTypes = [
      'password_change',
      'password_reset',
      'mfa_enable',
      'mfa_disable',
      'mfa_change',
      'email_change',
      'phone_change',
      'recovery_change',
      'api_key_create',
      'api_key_rotate',
    ];

    return credentialEventTypes.includes(event.eventType) ||
           event.eventType.includes('credential') ||
           event.eventType.includes('password') ||
           event.eventType.includes('mfa');
  }

  /**
   * Record a credential change event
   */
  private async recordCredentialChange(event: SecurityEvent): Promise<void> {
    const userId = event.userId!;
    const key = `${CREDENTIAL_CHANGE_PREFIX}${userId}`;

    const record: CredentialChangeRecord = {
      timestamp: event.timestamp.toISOString(),
      type: this.getCredentialChangeType(event),
      ipAddress: event.ipAddress,
      deviceFingerprint: event.deviceFingerprint,
      location: event.location,
    };

    await this.redis.zadd(key, event.timestamp.getTime(), JSON.stringify(record));

    // Keep only last 30 days
    const cutoff = Date.now() - BASELINE_TTL_SECONDS * 1000;
    await this.redis.zremrangebyscore(key, '-inf', cutoff);
    await this.redis.expire(key, BASELINE_TTL_SECONDS);

    // Also update baseline
    const baseline = await this.getBaseline(userId);
    baseline.lastCredentialChange = event.timestamp.toISOString();
    await this.saveBaseline(userId, baseline);
  }

  /**
   * Get the type of credential change
   */
  private getCredentialChangeType(event: SecurityEvent): CredentialChangeRecord['type'] {
    const eventType = event.eventType.toLowerCase();

    if (eventType.includes('password')) return 'password';
    if (eventType.includes('mfa') || eventType.includes('2fa')) return 'mfa';
    if (eventType.includes('email')) return 'email';
    if (eventType.includes('phone')) return 'phone';
    if (eventType.includes('recovery')) return 'recovery';
    if (eventType.includes('api_key')) return 'api_key';

    return 'password'; // Default
  }

  /**
   * Check for unusual activity after recent credential change
   */
  private async checkPostCredentialChangeActivity(
    event: SecurityEvent,
    baseline: UserActivityBaseline
  ): Promise<{ detected: boolean; indicators: Indicator[] }> {
    const indicators: Indicator[] = [];
    const userId = event.userId!;

    // Skip if this is a credential change event itself
    if (this.isCredentialChangeEvent(event)) {
      return { detected: false, indicators };
    }

    // Get recent credential changes
    const key = `${CREDENTIAL_CHANGE_PREFIX}${userId}`;
    const recentChanges = await this.redis.zrangebyscore(
      key,
      Date.now() - POST_CREDENTIAL_CHANGE_WINDOW_MS,
      '+inf'
    );

    if (recentChanges.length === 0) {
      return { detected: false, indicators };
    }

    const latestChange = JSON.parse(recentChanges[recentChanges.length - 1]) as CredentialChangeRecord;
    const hoursSinceChange = (Date.now() - new Date(latestChange.timestamp).getTime()) / (60 * 60 * 1000);

    // Check if activity is from different device/IP than credential change
    const isDifferentDevice = event.deviceFingerprint &&
                             latestChange.deviceFingerprint &&
                             event.deviceFingerprint !== latestChange.deviceFingerprint;
    const isDifferentIp = event.ipAddress !== latestChange.ipAddress;

    if (isDifferentDevice || isDifferentIp) {
      indicators.push({
        type: 'post_credential_change_different_context',
        description: `Activity from ${isDifferentDevice ? 'different device' : 'different IP'} within ${hoursSinceChange.toFixed(1)} hours of ${latestChange.type} change`,
        value: hoursSinceChange,
        weight: isDifferentDevice ? 50 : 35,
      });
    }

    // Check if accessing sensitive resources after credential change
    if (this.isSensitiveResource(event.resource || '')) {
      indicators.push({
        type: 'sensitive_access_post_credential_change',
        description: `Sensitive resource access within ${hoursSinceChange.toFixed(1)} hours of credential change`,
        value: event.resource || '',
        weight: 45,
      });
    }

    // Check for multiple credential changes in short period
    if (recentChanges.length >= 3) {
      indicators.push({
        type: 'multiple_credential_changes',
        description: `${recentChanges.length} credential changes in past 24 hours`,
        value: recentChanges.length,
        weight: 40,
      });
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check for activity from new device
   */
  private async checkNewDevice(
    event: SecurityEvent,
    baseline: UserActivityBaseline
  ): Promise<{ detected: boolean; indicators: Indicator[] }> {
    const indicators: Indicator[] = [];
    const deviceFingerprint = event.deviceFingerprint;

    if (!deviceFingerprint) {
      return { detected: false, indicators };
    }

    // Check if device is known
    const isKnownDevice = baseline.knownDevices.includes(deviceFingerprint);

    if (!isKnownDevice && baseline.totalEvents >= MIN_EVENTS_FOR_BASELINE) {
      indicators.push({
        type: 'new_device',
        description: `Activity from previously unseen device (fingerprint: ${deviceFingerprint.substring(0, 8)}...)`,
        value: deviceFingerprint,
        weight: this.config.newDeviceWeight,
      });

      // Additional weight if it's immediately after credential change
      if (baseline.lastCredentialChange) {
        const hoursSinceCredChange = (Date.now() - new Date(baseline.lastCredentialChange).getTime()) / (60 * 60 * 1000);
        if (hoursSinceCredChange < 24) {
          indicators.push({
            type: 'new_device_post_credential_change',
            description: `New device appeared within ${hoursSinceCredChange.toFixed(1)} hours of credential change`,
            value: hoursSinceCredChange,
            weight: 35,
          });
        }
      }
    }

    // Check for new IP address
    const isKnownIp = baseline.knownIps.includes(event.ipAddress);
    if (!isKnownIp && baseline.totalEvents >= MIN_EVENTS_FOR_BASELINE) {
      indicators.push({
        type: 'new_ip_address',
        description: `Activity from new IP address: ${event.ipAddress}`,
        value: event.ipAddress,
        weight: 15,
      });
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check for impossible travel
   */
  private async checkImpossibleTravel(
    event: SecurityEvent,
    baseline: UserActivityBaseline
  ): Promise<{ detected: boolean; indicators: Indicator[] }> {
    const indicators: Indicator[] = [];

    if (!event.location || baseline.typicalLocations.length === 0) {
      return { detected: false, indicators };
    }

    // Get recent location history
    const recentLocations = await this.getRecentLocations(event.userId!);

    if (recentLocations.length === 0) {
      return { detected: false, indicators };
    }

    // Check against most recent location
    const lastLocation = recentLocations[0];
    const timeDiffMs = event.timestamp.getTime() - new Date(lastLocation.timestamp).getTime();
    const timeDiffHours = timeDiffMs / (60 * 60 * 1000);

    if (timeDiffHours <= 0) {
      return { detected: false, indicators };
    }

    const distance = this.calculateDistance(
      event.location.latitude,
      event.location.longitude,
      lastLocation.latitude,
      lastLocation.longitude
    );

    const speed = distance / timeDiffHours;

    if (speed > MAX_TRAVEL_SPEED_KMH && distance > 100) {
      indicators.push({
        type: 'impossible_travel',
        description: `Travel speed of ${Math.round(speed)} km/h between ${this.formatLocation(lastLocation)} and ${this.formatLocation(event.location)} in ${timeDiffHours.toFixed(1)} hours`,
        value: speed,
        weight: this.config.impossibleTravelWeight,
      });
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check for activity during unusual hours
   */
  private checkUnusualTimeActivity(
    event: SecurityEvent,
    baseline: UserActivityBaseline
  ): { detected: boolean; indicators: Indicator[] } {
    const indicators: Indicator[] = [];

    if (!this.config.trackActiveHours || baseline.totalEvents < MIN_EVENTS_FOR_BASELINE) {
      return { detected: false, indicators };
    }

    const hour = event.timestamp.getHours();
    const totalActivity = baseline.activeHourHistogram.reduce((a, b) => a + b, 0);
    const hourActivity = baseline.activeHourHistogram[hour];
    const hourPercentage = totalActivity > 0 ? (hourActivity / totalActivity) * 100 : 0;

    // Check if this hour is unusual for the user
    if (hourPercentage < 2 && hourActivity === 0) {
      indicators.push({
        type: 'unusual_activity_hour',
        description: `Activity at ${hour}:00 which is outside user's normal active hours`,
        value: hour,
        weight: this.config.unusualTimeWeight,
      });
    }

    // Check for late night / early morning activity (0-5 AM)
    if (hour >= 0 && hour <= 5 && hourActivity < 3) {
      indicators.push({
        type: 'late_night_activity',
        description: `Late night activity at ${hour}:00 with minimal historical activity at this time`,
        value: hour,
        weight: 25,
      });
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check for access to sensitive resources
   */
  private checkSensitiveAccess(
    event: SecurityEvent,
    baseline: UserActivityBaseline
  ): { detected: boolean; indicators: Indicator[] } {
    const indicators: Indicator[] = [];
    const resource = event.resource || '';

    if (!this.isSensitiveResource(resource)) {
      return { detected: false, indicators };
    }

    // Check if this is a new sensitive resource for the user
    const isTypicalResource = baseline.typicalResources.some(
      (r) => resource.includes(r) || r.includes(resource)
    );

    if (!isTypicalResource && baseline.totalEvents >= MIN_EVENTS_FOR_BASELINE) {
      indicators.push({
        type: 'new_sensitive_resource',
        description: `First-time access to sensitive resource: ${resource}`,
        value: resource,
        weight: this.config.sensitiveAccessWeight,
      });
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Perform multi-signal fusion for compromise detection
   */
  private performSignalFusion(
    signalState: SignalState,
    baseline: UserActivityBaseline
  ): { detected: boolean; indicators: Indicator[] } {
    const indicators: Indicator[] = [];
    const activeSignals = signalState.signals.length;

    if (activeSignals < 2) {
      return { detected: false, indicators };
    }

    // Check for high-confidence compromise patterns
    const hasCompromisePattern =
      // Pattern 1: Impossible travel + new device
      (signalState.impossibleTravel && signalState.newDevice) ||
      // Pattern 2: Credential change + new device + sensitive access
      (signalState.postCredentialChangeActivity && signalState.newDevice && signalState.sensitiveAccess) ||
      // Pattern 3: Impossible travel + sensitive access
      (signalState.impossibleTravel && signalState.sensitiveAccess) ||
      // Pattern 4: Multiple signals (3+)
      activeSignals >= this.config.minSignalsForHighConfidence;

    if (hasCompromisePattern) {
      const totalWeight = signalState.weights.reduce((a, b) => a + b, 0);
      const avgWeight = totalWeight / activeSignals;
      const fusionWeight = Math.min(100, avgWeight + (activeSignals - 1) * 10);

      indicators.push({
        type: 'multi_signal_compromise',
        description: `Multiple compromise indicators detected: ${signalState.signals.join(', ')}`,
        value: activeSignals,
        weight: fusionWeight,
      });

      // Specific pattern indicators
      if (signalState.impossibleTravel && signalState.newDevice) {
        indicators.push({
          type: 'impossible_travel_new_device_combo',
          description: 'Impossible travel combined with new device strongly suggests credential theft',
          value: true,
          weight: 60,
        });
      }

      if (signalState.postCredentialChangeActivity && signalState.newDevice) {
        indicators.push({
          type: 'credential_change_new_device_combo',
          description: 'New device appearing shortly after credential change suggests account takeover',
          value: true,
          weight: 55,
        });
      }
    }

    return { detected: indicators.length > 0, indicators };
  }

  // ===========================================================================
  // Private Baseline Methods
  // ===========================================================================

  /**
   * Update user's activity baseline
   */
  private async updateUserBaseline(event: SecurityEvent): Promise<void> {
    const userId = event.userId!;
    const baseline = await this.getBaseline(userId);

    // Update known devices
    if (event.deviceFingerprint && !baseline.knownDevices.includes(event.deviceFingerprint)) {
      baseline.knownDevices.push(event.deviceFingerprint);
      if (baseline.knownDevices.length > 20) {
        baseline.knownDevices.shift();
      }
    }

    // Update known IPs
    if (!baseline.knownIps.includes(event.ipAddress)) {
      baseline.knownIps.push(event.ipAddress);
      if (baseline.knownIps.length > 50) {
        baseline.knownIps.shift();
      }
    }

    // Update active hours histogram
    const hour = event.timestamp.getHours();
    baseline.activeHourHistogram[hour]++;

    // Update typical locations
    if (event.location && !baseline.typicalLocations.some(
      (loc) => this.calculateDistance(
        loc.latitude, loc.longitude,
        event.location!.latitude, event.location!.longitude
      ) < 50 // Within 50km
    )) {
      baseline.typicalLocations.push({
        latitude: event.location.latitude,
        longitude: event.location.longitude,
        countryCode: event.location.countryCode,
        city: event.location.city,
      });
      if (baseline.typicalLocations.length > 10) {
        baseline.typicalLocations.shift();
      }
    }

    // Update typical resources
    if (event.resource && !baseline.typicalResources.includes(event.resource)) {
      baseline.typicalResources.push(event.resource);
      if (baseline.typicalResources.length > 100) {
        baseline.typicalResources.shift();
      }
    }

    baseline.totalEvents++;
    baseline.lastUpdated = new Date().toISOString();

    await this.saveBaseline(userId, baseline);
  }

  /**
   * Update device tracking
   */
  private async updateDeviceTracking(event: SecurityEvent): Promise<void> {
    if (!event.deviceFingerprint) {
      return;
    }

    const userId = event.userId!;
    const key = `${DEVICE_PREFIX}${userId}:${event.deviceFingerprint}`;

    const existingData = await this.redis.get(key);
    const session: DeviceSession = existingData
      ? JSON.parse(existingData)
      : {
          deviceFingerprint: event.deviceFingerprint,
          firstSeen: event.timestamp.toISOString(),
          lastSeen: event.timestamp.toISOString(),
          ipAddress: event.ipAddress,
          userAgent: event.userAgent,
          location: event.location,
          eventCount: 0,
        };

    session.lastSeen = event.timestamp.toISOString();
    session.ipAddress = event.ipAddress;
    session.eventCount++;

    await this.redis.set(key, JSON.stringify(session), 'EX', BASELINE_TTL_SECONDS);
  }

  /**
   * Update location history
   */
  private async updateLocationHistory(event: SecurityEvent): Promise<void> {
    if (!event.location) {
      return;
    }

    const userId = event.userId!;
    const key = `${LOCATION_PREFIX}${userId}`;

    const record = {
      timestamp: event.timestamp.toISOString(),
      latitude: event.location.latitude,
      longitude: event.location.longitude,
      countryCode: event.location.countryCode,
      city: event.location.city,
      ipAddress: event.ipAddress,
    };

    await this.redis.zadd(key, event.timestamp.getTime(), JSON.stringify(record));

    // Keep only last 100 locations
    const count = await this.redis.zcard(key);
    if (count > 100) {
      await this.redis.zremrangebyrank(key, 0, count - 101);
    }

    await this.redis.expire(key, BASELINE_TTL_SECONDS);
  }

  /**
   * Get recent locations for a user
   */
  private async getRecentLocations(userId: string): Promise<Array<{
    timestamp: string;
    latitude: number;
    longitude: number;
    countryCode?: string;
    city?: string;
  }>> {
    const key = `${LOCATION_PREFIX}${userId}`;
    const records = await this.redis.zrevrange(key, 0, 9);

    return records.map((r) => JSON.parse(r));
  }

  /**
   * Check if resource is sensitive
   */
  private isSensitiveResource(resource: string): boolean {
    const lowerResource = resource.toLowerCase();
    return this.config.sensitiveResources.some(
      (sensitive) => lowerResource.includes(sensitive)
    );
  }

  /**
   * Calculate distance between two points using Haversine formula
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return EARTH_RADIUS_KM * c;
  }

  /**
   * Convert degrees to radians
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Format location for display
   */
  private formatLocation(location: { city?: string; countryCode?: string; latitude: number; longitude: number }): string {
    if (location.city && location.countryCode) {
      return `${location.city}, ${location.countryCode}`;
    }
    if (location.countryCode) {
      return location.countryCode;
    }
    return `${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`;
  }

  /**
   * Save baseline to Redis
   */
  private async saveBaseline(userId: string, baseline: UserActivityBaseline): Promise<void> {
    const key = `${this.keyPrefix}${userId}`;
    await this.redis.set(key, JSON.stringify(baseline), 'EX', BASELINE_TTL_SECONDS);
  }

  /**
   * Create empty baseline for new user
   */
  private createEmptyBaseline(userId: string): UserActivityBaseline {
    return {
      userId,
      knownDevices: [],
      knownIps: [],
      activeHourHistogram: new Array(this.config.hoursInDay).fill(0),
      typicalLocations: [],
      typicalResources: [],
      totalEvents: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Calculate combined risk score
   */
  private calculateRiskScore(
    indicators: Indicator[],
    signalState: SignalState
  ): { score: number; calculatedSeverity: AnomalySeverity } {
    const totalWeight = indicators.reduce((sum, i) => sum + i.weight, 0);
    const signalCount = signalState.signals.length;

    // Apply signal correlation bonus
    const correlationBonus = Math.min(25, (signalCount - 1) * 8);

    let score = Math.min(100, totalWeight + correlationBonus);

    // Boost for specific high-risk combinations
    if (signalState.impossibleTravel && signalState.newDevice) {
      score = Math.min(100, score + 15);
    }
    if (signalState.postCredentialChangeActivity && signalState.newDevice) {
      score = Math.min(100, score + 15);
    }
    if (signalCount >= 3) {
      score = Math.min(100, score + 10);
    }

    // Determine severity
    let calculatedSeverity: AnomalySeverity;
    const hasMultiSignal = indicators.some((i) => i.type === 'multi_signal_compromise');

    if (score >= 85 || (hasMultiSignal && signalCount >= 3)) {
      calculatedSeverity = Severity.CRITICAL;
    } else if (score >= 70 || hasMultiSignal) {
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
  private generateDescription(
    event: SecurityEvent,
    indicators: Indicator[],
    signalState: SignalState
  ): string {
    const parts: string[] = ['Potential account compromise detected:'];

    if (signalState.signals.length >= 2) {
      parts.push(`Multiple indicators present (${signalState.signals.join(', ')}).`);
    }

    const multiSignal = indicators.find((i) => i.type === 'multi_signal_compromise');
    if (multiSignal) {
      parts.push(multiSignal.description);
    } else {
      const primaryIndicator = indicators[0];
      if (primaryIndicator) {
        parts.push(primaryIndicator.description);
      }
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
 * Create a new account compromise detector instance
 */
export function createAccountCompromiseDetector(
  config?: Partial<AccountCompromiseDetectorConfig>,
  keyPrefix?: string
): AccountCompromiseDetector {
  return new AccountCompromiseDetector(config, keyPrefix);
}
