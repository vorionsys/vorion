/**
 * Anomaly Detection Types
 *
 * Type definitions for the rule-based anomaly detection engine.
 * Provides interfaces for detecting suspicious patterns including:
 * - Impossible travel (geographic anomalies)
 * - Unusual access times (temporal anomalies)
 * - Volume spikes (behavioral anomalies)
 * - New device access
 * - Authentication failure spikes
 * - Privilege probing attempts
 *
 * @packageDocumentation
 * @module security/anomaly/types
 */

import { z } from 'zod';

// =============================================================================
// Anomaly Types
// =============================================================================

/**
 * Types of anomalies that can be detected
 */
export const AnomalyType = {
  IMPOSSIBLE_TRAVEL: 'impossible-travel',
  UNUSUAL_TIME: 'unusual-time',
  VOLUME_SPIKE: 'volume-spike',
  NEW_DEVICE: 'new-device',
  FAILED_AUTH_SPIKE: 'failed-auth-spike',
  PRIVILEGE_PROBE: 'privilege-probe',
} as const;

export type AnomalyType = (typeof AnomalyType)[keyof typeof AnomalyType];

export const anomalyTypeSchema = z.nativeEnum(AnomalyType);

/**
 * Severity levels for detected anomalies
 */
export const AnomalySeverity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

export type AnomalySeverity = (typeof AnomalySeverity)[keyof typeof AnomalySeverity];

export const anomalySeveritySchema = z.nativeEnum(AnomalySeverity);

// =============================================================================
// Indicator Types
// =============================================================================

/**
 * An indicator of compromise or suspicious activity
 */
export interface Indicator {
  /** Type of indicator */
  type: string;
  /** Human-readable description */
  description: string;
  /** Raw value of the indicator */
  value: string | number | boolean;
  /** Weight/importance of this indicator (0-100) */
  weight: number;
}

export const indicatorSchema = z.object({
  type: z.string().min(1),
  description: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
  weight: z.number().min(0).max(100),
});

// =============================================================================
// Anomaly Interface
// =============================================================================

/**
 * A detected anomaly
 */
export interface Anomaly {
  /** Unique anomaly ID */
  id: string;
  /** When the anomaly was detected */
  timestamp: Date;
  /** Type of anomaly */
  type: AnomalyType;
  /** Severity level */
  severity: AnomalySeverity;
  /** Confidence score (0-100) */
  confidence: number;
  /** User ID if associated with a user */
  userId?: string;
  /** Tenant ID if multi-tenant */
  tenantId?: string;
  /** IP address if relevant */
  ipAddress?: string;
  /** Human-readable description */
  description: string;
  /** List of indicators that contributed to detection */
  indicators: Indicator[];
  /** Suggested actions to take */
  suggestedActions: string[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export const anomalySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  type: anomalyTypeSchema,
  severity: anomalySeveritySchema,
  confidence: z.number().min(0).max(100),
  userId: z.string().optional(),
  tenantId: z.string().optional(),
  ipAddress: z.string().optional(),
  description: z.string().min(1),
  indicators: z.array(indicatorSchema),
  suggestedActions: z.array(z.string()),
  metadata: z.record(z.unknown()).optional(),
});

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for the anomaly detector
 */
export interface AnomalyDetectorConfig {
  /** Whether anomaly detection is enabled */
  enabled: boolean;
  /** List of enabled detector names */
  detectors: string[];
  /** Minimum confidence threshold for alerting (0-100) */
  alertThreshold: number;
  /** Number of days to learn normal behavior patterns */
  learningPeriodDays: number;
  /** Whether to automatically block suspicious IPs/users */
  autoBlock: boolean;
  /** Confidence threshold for automatic blocking (0-100) */
  autoBlockThreshold: number;
  /** Redis key prefix for storage */
  redisKeyPrefix?: string;
}

export const anomalyDetectorConfigSchema = z.object({
  enabled: z.boolean().default(true),
  detectors: z.array(z.string()).default(['geographic', 'temporal', 'volume']),
  alertThreshold: z.number().min(0).max(100).default(70),
  learningPeriodDays: z.number().int().positive().default(14),
  autoBlock: z.boolean().default(false),
  autoBlockThreshold: z.number().min(0).max(100).default(90),
  redisKeyPrefix: z.string().default('vorion:anomaly:'),
});

/**
 * Default configuration values
 */
export const DEFAULT_ANOMALY_DETECTOR_CONFIG: AnomalyDetectorConfig = {
  enabled: true,
  detectors: ['geographic', 'temporal', 'volume'],
  alertThreshold: 70,
  learningPeriodDays: 14,
  autoBlock: false,
  autoBlockThreshold: 90,
  redisKeyPrefix: 'vorion:anomaly:',
};

// =============================================================================
// Geographic Detection Types
// =============================================================================

/**
 * Geographic location data
 */
export interface GeoLocation {
  /** Latitude in decimal degrees */
  latitude: number;
  /** Longitude in decimal degrees */
  longitude: number;
  /** Country code (ISO 3166-1 alpha-2) */
  countryCode?: string;
  /** City name */
  city?: string;
  /** Region/state */
  region?: string;
  /** Timezone */
  timezone?: string;
}

export const geoLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  countryCode: z.string().length(2).optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  timezone: z.string().optional(),
});

/**
 * Configuration for geographic anomaly detection
 */
export interface GeographicDetectorConfig {
  /** Maximum travel speed in km/h before flagging as impossible */
  maxTravelSpeedKmh: number;
  /** Minimum distance in km to consider for travel analysis */
  minDistanceKm: number;
  /** List of country codes to flag as high risk */
  highRiskCountries: string[];
  /** Whether to flag VPN/proxy usage */
  flagVpnUsage: boolean;
}

export const geographicDetectorConfigSchema = z.object({
  maxTravelSpeedKmh: z.number().positive().default(1200),
  minDistanceKm: z.number().positive().default(100),
  highRiskCountries: z.array(z.string().length(2)).default([]),
  flagVpnUsage: z.boolean().default(true),
});

export const DEFAULT_GEOGRAPHIC_DETECTOR_CONFIG: GeographicDetectorConfig = {
  maxTravelSpeedKmh: 1200, // Faster than commercial aviation (~900 km/h) with buffer
  minDistanceKm: 100,
  highRiskCountries: [],
  flagVpnUsage: true,
};

// =============================================================================
// Temporal Detection Types
// =============================================================================

/**
 * Configuration for temporal anomaly detection
 */
export interface TemporalDetectorConfig {
  /** Hours of the day considered normal for access (0-23) */
  normalHoursStart: number;
  /** End of normal hours (0-23) */
  normalHoursEnd: number;
  /** Days of the week considered normal (0=Sunday, 6=Saturday) */
  normalDays: number[];
  /** Whether to learn user-specific patterns */
  learnUserPatterns: boolean;
  /** Minimum number of events to establish a baseline */
  minEventsForBaseline: number;
}

export const temporalDetectorConfigSchema = z.object({
  normalHoursStart: z.number().int().min(0).max(23).default(6),
  normalHoursEnd: z.number().int().min(0).max(23).default(22),
  normalDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  learnUserPatterns: z.boolean().default(true),
  minEventsForBaseline: z.number().int().positive().default(20),
});

export const DEFAULT_TEMPORAL_DETECTOR_CONFIG: TemporalDetectorConfig = {
  normalHoursStart: 6, // 6 AM
  normalHoursEnd: 22, // 10 PM
  normalDays: [1, 2, 3, 4, 5], // Monday through Friday
  learnUserPatterns: true,
  minEventsForBaseline: 20,
};

/**
 * User access pattern for temporal analysis
 */
export interface UserAccessPattern {
  /** User ID */
  userId: string;
  /** Histogram of access hours (24 bins) */
  hourHistogram: number[];
  /** Histogram of access days (7 bins) */
  dayHistogram: number[];
  /** Total number of events tracked */
  totalEvents: number;
  /** When the pattern was last updated */
  lastUpdated: Date;
}

export const userAccessPatternSchema = z.object({
  userId: z.string().min(1),
  hourHistogram: z.array(z.number()).length(24),
  dayHistogram: z.array(z.number()).length(7),
  totalEvents: z.number().int().nonnegative(),
  lastUpdated: z.coerce.date(),
});

// =============================================================================
// Volume Detection Types
// =============================================================================

/**
 * Configuration for volume spike detection
 */
export interface VolumeDetectorConfig {
  /** Time window in minutes for rate calculation */
  windowMinutes: number;
  /** Standard deviations above mean to trigger alert */
  spikeThresholdStdDev: number;
  /** Absolute maximum requests per window before alert */
  absoluteMaxRequests: number;
  /** Whether to track per-user volumes */
  trackPerUser: boolean;
  /** Whether to track per-IP volumes */
  trackPerIp: boolean;
  /** Whether to track per-endpoint volumes */
  trackPerEndpoint: boolean;
}

export const volumeDetectorConfigSchema = z.object({
  windowMinutes: z.number().int().positive().default(5),
  spikeThresholdStdDev: z.number().positive().default(3),
  absoluteMaxRequests: z.number().int().positive().default(1000),
  trackPerUser: z.boolean().default(true),
  trackPerIp: z.boolean().default(true),
  trackPerEndpoint: z.boolean().default(false),
});

export const DEFAULT_VOLUME_DETECTOR_CONFIG: VolumeDetectorConfig = {
  windowMinutes: 5,
  spikeThresholdStdDev: 3,
  absoluteMaxRequests: 1000,
  trackPerUser: true,
  trackPerIp: true,
  trackPerEndpoint: false,
};

/**
 * Volume baseline statistics
 */
export interface VolumeBaseline {
  /** Identifier (user ID, IP, or endpoint) */
  identifier: string;
  /** Type of identifier */
  identifierType: 'user' | 'ip' | 'endpoint';
  /** Mean requests per window */
  mean: number;
  /** Standard deviation */
  stdDev: number;
  /** Number of samples in baseline */
  sampleCount: number;
  /** When the baseline was last updated */
  lastUpdated: Date;
}

export const volumeBaselineSchema = z.object({
  identifier: z.string().min(1),
  identifierType: z.enum(['user', 'ip', 'endpoint']),
  mean: z.number().nonnegative(),
  stdDev: z.number().nonnegative(),
  sampleCount: z.number().int().nonnegative(),
  lastUpdated: z.coerce.date(),
});

// =============================================================================
// Event Types
// =============================================================================

/**
 * A security event to be analyzed for anomalies
 */
export interface SecurityEvent {
  /** Unique event ID */
  eventId: string;
  /** Event timestamp */
  timestamp: Date;
  /** Event type (e.g., 'login', 'api_call', 'permission_check') */
  eventType: string;
  /** User ID if authenticated */
  userId?: string;
  /** Tenant ID if multi-tenant */
  tenantId?: string;
  /** IP address of the request */
  ipAddress: string;
  /** User agent string */
  userAgent?: string;
  /** Geographic location if available */
  location?: GeoLocation;
  /** Requested resource/endpoint */
  resource?: string;
  /** HTTP method if applicable */
  method?: string;
  /** Whether the request was successful */
  success: boolean;
  /** Failure reason if unsuccessful */
  failureReason?: string;
  /** Device fingerprint if available */
  deviceFingerprint?: string;
  /** Additional event metadata */
  metadata?: Record<string, unknown>;
}

export const securityEventSchema = z.object({
  eventId: z.string().min(1),
  timestamp: z.coerce.date(),
  eventType: z.string().min(1),
  userId: z.string().optional(),
  tenantId: z.string().optional(),
  ipAddress: z.string().min(1),
  userAgent: z.string().optional(),
  location: geoLocationSchema.optional(),
  resource: z.string().optional(),
  method: z.string().optional(),
  success: z.boolean(),
  failureReason: z.string().optional(),
  deviceFingerprint: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// =============================================================================
// Detection Result Types
// =============================================================================

/**
 * Result from a single detector
 */
export interface DetectionResult {
  /** Name of the detector */
  detectorName: string;
  /** Whether an anomaly was detected */
  anomalyDetected: boolean;
  /** Confidence score if anomaly detected (0-100) */
  confidence?: number;
  /** Severity if anomaly detected */
  severity?: AnomalySeverity;
  /** Description of the finding */
  description?: string;
  /** Indicators found */
  indicators: Indicator[];
  /** Suggested actions */
  suggestedActions: string[];
  /** Time taken for detection in milliseconds */
  durationMs: number;
  /** Error if detection failed */
  error?: string;
}

export const detectionResultSchema = z.object({
  detectorName: z.string().min(1),
  anomalyDetected: z.boolean(),
  confidence: z.number().min(0).max(100).optional(),
  severity: anomalySeveritySchema.optional(),
  description: z.string().optional(),
  indicators: z.array(indicatorSchema),
  suggestedActions: z.array(z.string()),
  durationMs: z.number().nonnegative(),
  error: z.string().optional(),
});

/**
 * Aggregated result from all detectors
 */
export interface AggregatedDetectionResult {
  /** The event that was analyzed */
  event: SecurityEvent;
  /** Results from individual detectors */
  detectorResults: DetectionResult[];
  /** Combined anomalies (if any) */
  anomalies: Anomaly[];
  /** Total processing time in milliseconds */
  totalDurationMs: number;
  /** Timestamp of analysis */
  analyzedAt: Date;
}

export const aggregatedDetectionResultSchema = z.object({
  event: securityEventSchema,
  detectorResults: z.array(detectionResultSchema),
  anomalies: z.array(anomalySchema),
  totalDurationMs: z.number().nonnegative(),
  analyzedAt: z.coerce.date(),
});

// =============================================================================
// Detector Interface
// =============================================================================

/**
 * Interface that all detectors must implement
 */
export interface Detector {
  /** Unique name of the detector */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /**
   * Analyze an event for anomalies
   * @param event The security event to analyze
   * @returns Detection result
   */
  detect(event: SecurityEvent): Promise<DetectionResult>;

  /**
   * Update baselines with new event data
   * @param event The event to learn from
   */
  learn(event: SecurityEvent): Promise<void>;

  /**
   * Reset all learned baselines
   */
  reset(): Promise<void>;
}

// =============================================================================
// Alert Types
// =============================================================================

/**
 * An alert generated from detected anomalies
 */
export interface AnomalyAlert {
  /** Unique alert ID */
  alertId: string;
  /** The anomaly that triggered the alert */
  anomaly: Anomaly;
  /** Alert status */
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
  /** When the alert was created */
  createdAt: Date;
  /** When the alert was last updated */
  updatedAt: Date;
  /** User who acknowledged/resolved the alert */
  handledBy?: string;
  /** Notes added during handling */
  notes?: string;
  /** Whether automatic action was taken */
  autoActionTaken: boolean;
  /** Description of automatic action if taken */
  autoActionDescription?: string;
}

export const anomalyAlertSchema = z.object({
  alertId: z.string().uuid(),
  anomaly: anomalySchema,
  status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed']),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  handledBy: z.string().optional(),
  notes: z.string().optional(),
  autoActionTaken: z.boolean(),
  autoActionDescription: z.string().optional(),
});

// =============================================================================
// Callback Types
// =============================================================================

/**
 * Callback function for when an anomaly is detected
 */
export type AnomalyCallback = (anomaly: Anomaly) => void | Promise<void>;

/**
 * Callback function for when an alert should be generated
 */
export type AlertCallback = (alert: AnomalyAlert) => void | Promise<void>;
