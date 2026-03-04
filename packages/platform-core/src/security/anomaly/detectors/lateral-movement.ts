/**
 * Lateral Movement Detector
 *
 * Detects suspicious lateral movement patterns by analyzing:
 * - Access to new systems/services
 * - Authentication from unusual service accounts
 * - Cross-tenant access patterns
 *
 * Uses behavioral baselines to score based on hop count,
 * time between hops, and destination sensitivity.
 *
 * @packageDocumentation
 * @module security/anomaly/detectors/lateral-movement
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

const logger = createLogger({ component: 'lateral-movement-detector' });

// =============================================================================
// Constants
// =============================================================================

/** Redis key prefix for access baselines */
const ACCESS_BASELINE_PREFIX = 'vorion:anomaly:lateral:baseline:';

/** Redis key prefix for hop tracking */
const HOP_TRACKING_PREFIX = 'vorion:anomaly:lateral:hops:';

/** Redis key prefix for service account patterns */
const SERVICE_ACCOUNT_PREFIX = 'vorion:anomaly:lateral:svc:';

/** Redis key prefix for tenant access tracking */
const TENANT_ACCESS_PREFIX = 'vorion:anomaly:lateral:tenant:';

/** Time-to-live for baselines in seconds (30 days) */
const BASELINE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Time window for hop analysis in seconds (1 hour) */
const HOP_WINDOW_SECONDS = 60 * 60;

/** Minimum events to establish baseline */
const MIN_EVENTS_FOR_BASELINE = 15;

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for lateral movement detection
 */
export interface LateralMovementDetectorConfig {
  /** Maximum hops in a single session before alerting */
  maxHopsPerSession: number;
  /** Minimum time between hops to be considered suspicious (seconds) */
  minTimeBetweenHopsSeconds: number;
  /** High-sensitivity systems/services */
  highSensitivitySystems: string[];
  /** Service account patterns (regex) */
  serviceAccountPatterns: string[];
  /** Maximum cross-tenant access in session */
  maxCrossTenantsPerSession: number;
  /** System sensitivity levels */
  systemSensitivity: Record<string, number>;
  /** Enable service account monitoring */
  enableServiceAccountMonitoring: boolean;
}

export const DEFAULT_LATERAL_MOVEMENT_CONFIG: LateralMovementDetectorConfig = {
  maxHopsPerSession: 10,
  minTimeBetweenHopsSeconds: 5,
  highSensitivitySystems: [
    'database',
    'db',
    'vault',
    'secrets',
    'admin',
    'backup',
    'monitoring',
    'audit',
    'identity',
    'authentication',
  ],
  serviceAccountPatterns: [
    '^svc[_-]',
    '^service[_-]',
    '^system[_-]',
    '^app[_-]',
    '^bot[_-]',
    '@serviceaccount',
  ],
  maxCrossTenantsPerSession: 2,
  systemSensitivity: {
    'production': 80,
    'prod': 80,
    'database': 90,
    'vault': 100,
    'secrets': 100,
    'admin': 85,
    'identity': 95,
    'backup': 75,
    'staging': 40,
    'development': 20,
    'default': 50,
  },
  enableServiceAccountMonitoring: true,
};

// =============================================================================
// Baseline Types
// =============================================================================

/**
 * User's lateral movement baseline
 */
interface LateralMovementBaseline {
  userId: string;
  /** Normal systems accessed */
  normalSystems: string[];
  /** Normal services accessed */
  normalServices: string[];
  /** Normal tenants accessed */
  normalTenants: string[];
  /** Average systems per session */
  avgSystemsPerSession: number;
  /** Average hops per hour */
  avgHopsPerHour: number;
  /** Standard deviation of hops per hour */
  stdDevHopsPerHour: number;
  /** Total sessions tracked */
  sessionCount: number;
  /** Total events tracked */
  totalEvents: number;
  /** Last updated */
  lastUpdated: string;
}

/**
 * Current session hop tracking
 */
interface SessionHops {
  userId: string;
  sessionStart: number;
  hops: Array<{
    timestamp: number;
    system: string;
    service?: string;
    tenant?: string;
    ipAddress: string;
  }>;
  uniqueSystems: Set<string>;
  uniqueTenants: Set<string>;
}

/**
 * Service account access pattern
 */
interface ServiceAccountPattern {
  accountId: string;
  normalSources: string[];
  normalTargets: string[];
  normalHours: number[];
  totalAccesses: number;
  lastUpdated: string;
}

// =============================================================================
// Lateral Movement Detector Implementation
// =============================================================================

/**
 * Lateral movement anomaly detector
 */
export class LateralMovementDetector implements Detector {
  public readonly name = 'lateral-movement';
  public readonly description =
    'Detects access to new systems, unusual service account usage, and cross-tenant access patterns';

  private readonly config: LateralMovementDetectorConfig;
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor(
    config: Partial<LateralMovementDetectorConfig> = {},
    keyPrefix: string = ACCESS_BASELINE_PREFIX
  ) {
    this.config = { ...DEFAULT_LATERAL_MOVEMENT_CONFIG, ...config };
    this.redis = getRedis();
    this.keyPrefix = keyPrefix;
  }

  /**
   * Analyze an event for lateral movement anomalies
   */
  async detect(event: SecurityEvent): Promise<DetectionResult> {
    const startTime = performance.now();
    const indicators: Indicator[] = [];
    const suggestedActions: string[] = [];

    try {
      // Only analyze access/authentication events
      if (!this.isAccessEvent(event)) {
        return this.createResult(false, indicators, suggestedActions, startTime);
      }

      const userId = event.userId;
      if (!userId) {
        return this.createResult(false, indicators, suggestedActions, startTime);
      }

      // Get user's baseline
      const baseline = await this.getBaseline(userId);

      // Update hop tracking and get current session
      const sessionHops = await this.updateHopTracking(event);

      // Check for access to new systems
      const newSystemResult = await this.checkNewSystemAccess(event, baseline);
      if (newSystemResult.detected) {
        indicators.push(...newSystemResult.indicators);
        suggestedActions.push(
          'Verify user authorization for new system access',
          'Review access request and approval workflow'
        );
      }

      // Check hop patterns
      const hopResult = this.checkHopPattern(event, baseline, sessionHops);
      if (hopResult.detected) {
        indicators.push(...hopResult.indicators);
        suggestedActions.push(
          'Investigate rapid system access patterns',
          'Check for compromised credentials or automated attacks'
        );
      }

      // Check for unusual service account usage
      if (this.config.enableServiceAccountMonitoring && this.isServiceAccount(userId)) {
        const svcResult = await this.checkServiceAccountAnomaly(event);
        if (svcResult.detected) {
          indicators.push(...svcResult.indicators);
          suggestedActions.push(
            'Review service account permissions and usage',
            'Check for compromised service credentials'
          );
        }
      }

      // Check cross-tenant access patterns
      const tenantResult = await this.checkCrossTenantAccess(event, baseline, sessionHops);
      if (tenantResult.detected) {
        indicators.push(...tenantResult.indicators);
        suggestedActions.push(
          'Verify cross-tenant access is authorized',
          'Review tenant isolation controls'
        );
      }

      // Check destination sensitivity
      const sensitivityResult = this.checkDestinationSensitivity(event, baseline);
      if (sensitivityResult.detected) {
        indicators.push(...sensitivityResult.indicators);
        suggestedActions.push(
          'Apply additional monitoring for sensitive system access',
          'Verify user has need-to-know access'
        );
      }

      // Calculate overall result
      const hasAnomaly = indicators.length > 0;
      let severity: AnomalySeverity | undefined;
      let confidence: number | undefined;
      let description: string | undefined;

      if (hasAnomaly) {
        const { score, calculatedSeverity } = this.calculateRiskScore(indicators, event, sessionHops);
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
      logger.error({ error, eventId: event.eventId }, 'Lateral movement detection failed');

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
    if (!this.isAccessEvent(event) || !event.userId) {
      return;
    }

    try {
      await Promise.all([
        this.updateUserBaseline(event),
        this.updateServiceAccountPattern(event),
        this.updateTenantAccess(event),
      ]);

      logger.debug(
        { userId: event.userId, eventType: event.eventType },
        'Updated lateral movement baselines'
      );
    } catch (error) {
      logger.error({ error, userId: event.userId }, 'Failed to update lateral movement baselines');
    }
  }

  /**
   * Reset all learned baselines
   */
  async reset(): Promise<void> {
    try {
      const patterns = [
        `${this.keyPrefix}*`,
        `${HOP_TRACKING_PREFIX}*`,
        `${SERVICE_ACCOUNT_PREFIX}*`,
        `${TENANT_ACCESS_PREFIX}*`,
      ];

      for (const pattern of patterns) {
        await this.deleteKeysByPattern(pattern);
      }

      logger.info('Lateral movement detector baselines reset');
    } catch (error) {
      logger.error({ error }, 'Failed to reset lateral movement detector');
      throw error;
    }
  }

  /**
   * Get baseline for a specific user
   */
  async getBaseline(userId: string): Promise<LateralMovementBaseline> {
    const key = `${this.keyPrefix}${userId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return this.createEmptyBaseline(userId);
    }

    try {
      return JSON.parse(data) as LateralMovementBaseline;
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
   * Check if event is access-related
   */
  private isAccessEvent(event: SecurityEvent): boolean {
    const accessEventTypes = [
      'authentication',
      'login',
      'access',
      'connection',
      'session_start',
      'system_access',
      'service_call',
      'api_call',
      'remote_access',
      'ssh',
      'rdp',
    ];

    return accessEventTypes.includes(event.eventType) ||
           event.eventType.includes('auth') ||
           event.eventType.includes('access') ||
           event.eventType.includes('connect');
  }

  /**
   * Check if user ID matches service account patterns
   */
  private isServiceAccount(userId: string): boolean {
    return this.config.serviceAccountPatterns.some(
      (pattern) => new RegExp(pattern, 'i').test(userId)
    );
  }

  /**
   * Check for access to new systems
   */
  private async checkNewSystemAccess(
    event: SecurityEvent,
    baseline: LateralMovementBaseline
  ): Promise<{ detected: boolean; indicators: Indicator[] }> {
    const indicators: Indicator[] = [];
    const metadata = event.metadata || {};

    const system = metadata['system'] as string ||
                  metadata['target'] as string ||
                  metadata['host'] as string ||
                  event.resource || '';
    const service = metadata['service'] as string || '';

    if (!system) {
      return { detected: false, indicators };
    }

    // Check if this is a new system for the user
    if (baseline.totalEvents >= MIN_EVENTS_FOR_BASELINE &&
        !baseline.normalSystems.includes(system)) {
      const sensitivity = this.getSystemSensitivity(system);

      indicators.push({
        type: 'new_system_access',
        description: `First-time access to system: ${system}`,
        value: system,
        weight: Math.round(30 + sensitivity * 0.3),
      });

      // Check if it's a high-sensitivity system
      if (this.config.highSensitivitySystems.some(
        (hs) => system.toLowerCase().includes(hs.toLowerCase())
      )) {
        indicators.push({
          type: 'sensitive_system_access',
          description: `New access to high-sensitivity system: ${system}`,
          value: system,
          weight: 50,
        });
      }
    }

    // Check for new service access
    if (service && baseline.totalEvents >= MIN_EVENTS_FOR_BASELINE &&
        !baseline.normalServices.includes(service)) {
      indicators.push({
        type: 'new_service_access',
        description: `First-time access to service: ${service}`,
        value: service,
        weight: 25,
      });
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check hop patterns for suspicious behavior
   */
  private checkHopPattern(
    event: SecurityEvent,
    baseline: LateralMovementBaseline,
    sessionHops: SessionHops | null
  ): { detected: boolean; indicators: Indicator[] } {
    const indicators: Indicator[] = [];

    if (!sessionHops || sessionHops.hops.length < 2) {
      return { detected: false, indicators };
    }

    // Check total hops in session
    if (sessionHops.hops.length > this.config.maxHopsPerSession) {
      indicators.push({
        type: 'excessive_session_hops',
        description: `${sessionHops.hops.length} system accesses in current session exceeds threshold of ${this.config.maxHopsPerSession}`,
        value: sessionHops.hops.length,
        weight: Math.min(80, 40 + (sessionHops.hops.length - this.config.maxHopsPerSession) * 5),
      });
    }

    // Check for rapid hops (short time between accesses)
    const recentHops = sessionHops.hops.slice(-5);
    for (let i = 1; i < recentHops.length; i++) {
      const timeBetween = (recentHops[i].timestamp - recentHops[i - 1].timestamp) / 1000;

      if (timeBetween < this.config.minTimeBetweenHopsSeconds &&
          recentHops[i].system !== recentHops[i - 1].system) {
        indicators.push({
          type: 'rapid_system_switching',
          description: `Rapid switch between systems in ${timeBetween.toFixed(1)}s (${recentHops[i - 1].system} -> ${recentHops[i].system})`,
          value: timeBetween,
          weight: 45,
        });
        break; // Only report once
      }
    }

    // Check against baseline hop rate
    if (baseline.totalEvents >= MIN_EVENTS_FOR_BASELINE && baseline.stdDevHopsPerHour > 0) {
      const currentHourlyRate = sessionHops.hops.length; // Simplified: assuming 1-hour window
      const zScore = (currentHourlyRate - baseline.avgHopsPerHour) / baseline.stdDevHopsPerHour;

      if (zScore > 3) {
        indicators.push({
          type: 'hop_rate_deviation',
          description: `System access rate ${zScore.toFixed(1)}x standard deviations above normal`,
          value: zScore,
          weight: Math.min(70, 30 + Math.round(zScore * 10)),
        });
      }
    }

    // Check unique system count
    if (sessionHops.uniqueSystems.size > baseline.avgSystemsPerSession * 2 &&
        sessionHops.uniqueSystems.size > 5) {
      indicators.push({
        type: 'many_unique_systems',
        description: `Accessed ${sessionHops.uniqueSystems.size} unique systems (typical: ${baseline.avgSystemsPerSession.toFixed(1)})`,
        value: sessionHops.uniqueSystems.size,
        weight: 35,
      });
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check for service account anomalies
   */
  private async checkServiceAccountAnomaly(
    event: SecurityEvent
  ): Promise<{ detected: boolean; indicators: Indicator[] }> {
    const indicators: Indicator[] = [];
    const userId = event.userId!;
    const metadata = event.metadata || {};

    const svcPattern = await this.getServiceAccountPattern(userId);

    // Check for new source location
    const sourceIp = event.ipAddress;
    if (svcPattern.totalAccesses >= MIN_EVENTS_FOR_BASELINE &&
        !svcPattern.normalSources.includes(sourceIp)) {
      indicators.push({
        type: 'service_account_new_source',
        description: `Service account ${userId} accessed from new source: ${sourceIp}`,
        value: sourceIp,
        weight: 50,
      });
    }

    // Check for new target
    const target = metadata['target'] as string || metadata['system'] as string || event.resource;
    if (target && svcPattern.totalAccesses >= MIN_EVENTS_FOR_BASELINE &&
        !svcPattern.normalTargets.includes(target)) {
      indicators.push({
        type: 'service_account_new_target',
        description: `Service account ${userId} accessing new target: ${target}`,
        value: target,
        weight: 45,
      });
    }

    // Check for unusual time
    const hour = event.timestamp.getHours();
    if (svcPattern.totalAccesses >= MIN_EVENTS_FOR_BASELINE &&
        svcPattern.normalHours.length > 0 &&
        !svcPattern.normalHours.includes(hour)) {
      indicators.push({
        type: 'service_account_unusual_time',
        description: `Service account ${userId} active at unusual time: ${hour}:00`,
        value: hour,
        weight: 40,
      });
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check for cross-tenant access patterns
   */
  private async checkCrossTenantAccess(
    event: SecurityEvent,
    baseline: LateralMovementBaseline,
    sessionHops: SessionHops | null
  ): Promise<{ detected: boolean; indicators: Indicator[] }> {
    const indicators: Indicator[] = [];
    const tenant = event.tenantId || (event.metadata?.['tenant'] as string);

    if (!tenant || !sessionHops) {
      return { detected: false, indicators };
    }

    // Check for new tenant access
    if (baseline.totalEvents >= MIN_EVENTS_FOR_BASELINE &&
        !baseline.normalTenants.includes(tenant)) {
      indicators.push({
        type: 'new_tenant_access',
        description: `First-time access to tenant: ${tenant}`,
        value: tenant,
        weight: 45,
      });
    }

    // Check for excessive cross-tenant activity
    if (sessionHops.uniqueTenants.size > this.config.maxCrossTenantsPerSession) {
      indicators.push({
        type: 'excessive_cross_tenant',
        description: `Accessed ${sessionHops.uniqueTenants.size} tenants in session (max: ${this.config.maxCrossTenantsPerSession})`,
        value: sessionHops.uniqueTenants.size,
        weight: 60,
      });
    }

    // Check for rapid tenant switching
    if (sessionHops.hops.length >= 3) {
      const recentHops = sessionHops.hops.slice(-3);
      const recentTenants = new Set(recentHops.map((h) => h.tenant).filter(Boolean));

      if (recentTenants.size === 3) {
        indicators.push({
          type: 'rapid_tenant_switching',
          description: 'Rapid switching between multiple tenants',
          value: recentTenants.size,
          weight: 50,
        });
      }
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check destination system sensitivity
   */
  private checkDestinationSensitivity(
    event: SecurityEvent,
    baseline: LateralMovementBaseline
  ): { detected: boolean; indicators: Indicator[] } {
    const indicators: Indicator[] = [];
    const metadata = event.metadata || {};

    const system = metadata['system'] as string ||
                  metadata['target'] as string ||
                  event.resource || '';

    if (!system) {
      return { detected: false, indicators };
    }

    const sensitivity = this.getSystemSensitivity(system);

    // Flag access to very high sensitivity systems
    if (sensitivity >= 90) {
      indicators.push({
        type: 'critical_system_access',
        description: `Access to critical system: ${system} (sensitivity: ${sensitivity})`,
        value: sensitivity,
        weight: 55,
      });
    }

    // Check for sensitivity escalation pattern
    if (baseline.normalSystems.length > 0) {
      const normalMaxSensitivity = Math.max(
        ...baseline.normalSystems.map((s) => this.getSystemSensitivity(s))
      );

      if (sensitivity > normalMaxSensitivity + 20) {
        indicators.push({
          type: 'sensitivity_escalation',
          description: `Accessing system with higher sensitivity (${sensitivity}) than normal range (max: ${normalMaxSensitivity})`,
          value: sensitivity - normalMaxSensitivity,
          weight: 40,
        });
      }
    }

    return { detected: indicators.length > 0, indicators };
  }

  // ===========================================================================
  // Private Baseline Methods
  // ===========================================================================

  /**
   * Update hop tracking for current session
   */
  private async updateHopTracking(event: SecurityEvent): Promise<SessionHops | null> {
    const userId = event.userId!;
    const metadata = event.metadata || {};

    const windowStart = Math.floor(Date.now() / (HOP_WINDOW_SECONDS * 1000)) * HOP_WINDOW_SECONDS * 1000;
    const key = `${HOP_TRACKING_PREFIX}${userId}:${windowStart}`;

    const hop = {
      timestamp: event.timestamp.getTime(),
      system: metadata['system'] as string ||
              metadata['target'] as string ||
              event.resource || 'unknown',
      service: metadata['service'] as string,
      tenant: event.tenantId || (metadata['tenant'] as string),
      ipAddress: event.ipAddress,
    };

    // Store hop
    await this.redis.rpush(key, JSON.stringify(hop));
    await this.redis.expire(key, HOP_WINDOW_SECONDS * 2);

    // Get all hops in window
    const hopsData = await this.redis.lrange(key, 0, -1);
    const hops = hopsData.map((h) => JSON.parse(h) as SessionHops['hops'][0]);

    const uniqueSystems = new Set(hops.map((h) => h.system));
    const uniqueTenants = new Set(hops.map((h) => h.tenant).filter((t): t is string => !!t));

    return {
      userId,
      sessionStart: windowStart,
      hops,
      uniqueSystems,
      uniqueTenants,
    };
  }

  /**
   * Update user's lateral movement baseline
   */
  private async updateUserBaseline(event: SecurityEvent): Promise<void> {
    const userId = event.userId!;
    const baseline = await this.getBaseline(userId);
    const metadata = event.metadata || {};

    const system = metadata['system'] as string ||
                  metadata['target'] as string ||
                  event.resource || '';
    const service = metadata['service'] as string;
    const tenant = event.tenantId || (metadata['tenant'] as string);

    // Update normal systems
    if (system && !baseline.normalSystems.includes(system)) {
      baseline.normalSystems.push(system);
      if (baseline.normalSystems.length > 100) {
        baseline.normalSystems.shift();
      }
    }

    // Update normal services
    if (service && !baseline.normalServices.includes(service)) {
      baseline.normalServices.push(service);
      if (baseline.normalServices.length > 50) {
        baseline.normalServices.shift();
      }
    }

    // Update normal tenants
    if (tenant && !baseline.normalTenants.includes(tenant)) {
      baseline.normalTenants.push(tenant);
      if (baseline.normalTenants.length > 20) {
        baseline.normalTenants.shift();
      }
    }

    // Update statistics using online algorithm
    const n = baseline.totalEvents + 1;
    const hopsDelta = 1 - baseline.avgHopsPerHour;
    const newAvgHops = baseline.avgHopsPerHour + hopsDelta / n;

    let newStdDevHops = baseline.stdDevHopsPerHour;
    if (n >= 2) {
      const hopsDelta2 = 1 - newAvgHops;
      const oldVariance = baseline.stdDevHopsPerHour ** 2 * (n - 1);
      const newVariance = (oldVariance + hopsDelta * hopsDelta2) / n;
      newStdDevHops = Math.sqrt(newVariance);
    }

    baseline.avgHopsPerHour = newAvgHops;
    baseline.stdDevHopsPerHour = newStdDevHops;
    baseline.totalEvents = n;
    baseline.lastUpdated = new Date().toISOString();

    // Periodically update session-based stats
    if (n % 10 === 0) {
      // Simplified: estimate avg systems per session
      baseline.avgSystemsPerSession = Math.min(
        baseline.avgSystemsPerSession * 0.9 + baseline.normalSystems.length * 0.1 / Math.max(1, baseline.sessionCount),
        baseline.normalSystems.length
      );
      baseline.sessionCount++;
    }

    const key = `${this.keyPrefix}${userId}`;
    await this.redis.set(key, JSON.stringify(baseline), 'EX', BASELINE_TTL_SECONDS);
  }

  /**
   * Update service account pattern
   */
  private async updateServiceAccountPattern(event: SecurityEvent): Promise<void> {
    const userId = event.userId!;

    if (!this.isServiceAccount(userId)) {
      return;
    }

    const metadata = event.metadata || {};
    const key = `${SERVICE_ACCOUNT_PREFIX}${userId}`;

    const pattern = await this.getServiceAccountPattern(userId);

    // Update sources
    if (!pattern.normalSources.includes(event.ipAddress)) {
      pattern.normalSources.push(event.ipAddress);
      if (pattern.normalSources.length > 20) {
        pattern.normalSources.shift();
      }
    }

    // Update targets
    const target = metadata['target'] as string || metadata['system'] as string || event.resource;
    if (target && !pattern.normalTargets.includes(target)) {
      pattern.normalTargets.push(target);
      if (pattern.normalTargets.length > 50) {
        pattern.normalTargets.shift();
      }
    }

    // Update normal hours
    const hour = event.timestamp.getHours();
    if (!pattern.normalHours.includes(hour)) {
      pattern.normalHours.push(hour);
      pattern.normalHours.sort((a, b) => a - b);
    }

    pattern.totalAccesses++;
    pattern.lastUpdated = new Date().toISOString();

    await this.redis.set(key, JSON.stringify(pattern), 'EX', BASELINE_TTL_SECONDS);
  }

  /**
   * Update tenant access tracking
   */
  private async updateTenantAccess(event: SecurityEvent): Promise<void> {
    const tenant = event.tenantId || (event.metadata?.['tenant'] as string);
    const userId = event.userId!;

    if (!tenant) {
      return;
    }

    const key = `${TENANT_ACCESS_PREFIX}${userId}`;
    await this.redis.zadd(key, event.timestamp.getTime(), tenant);

    // Trim old entries
    const cutoff = Date.now() - (24 * 60 * 60 * 1000);
    await this.redis.zremrangebyscore(key, '-inf', cutoff);
    await this.redis.expire(key, BASELINE_TTL_SECONDS);
  }

  /**
   * Get service account pattern
   */
  private async getServiceAccountPattern(accountId: string): Promise<ServiceAccountPattern> {
    const key = `${SERVICE_ACCOUNT_PREFIX}${accountId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return {
        accountId,
        normalSources: [],
        normalTargets: [],
        normalHours: [],
        totalAccesses: 0,
        lastUpdated: new Date().toISOString(),
      };
    }

    try {
      return JSON.parse(data) as ServiceAccountPattern;
    } catch {
      return {
        accountId,
        normalSources: [],
        normalTargets: [],
        normalHours: [],
        totalAccesses: 0,
        lastUpdated: new Date().toISOString(),
      };
    }
  }

  /**
   * Get system sensitivity level
   */
  private getSystemSensitivity(system: string): number {
    const lowerSystem = system.toLowerCase();

    for (const [pattern, sensitivity] of Object.entries(this.config.systemSensitivity)) {
      if (pattern !== 'default' && lowerSystem.includes(pattern)) {
        return sensitivity;
      }
    }

    return this.config.systemSensitivity['default'] || 50;
  }

  /**
   * Create empty baseline for new user
   */
  private createEmptyBaseline(userId: string): LateralMovementBaseline {
    return {
      userId,
      normalSystems: [],
      normalServices: [],
      normalTenants: [],
      avgSystemsPerSession: 3,
      avgHopsPerHour: 0,
      stdDevHopsPerHour: 0,
      sessionCount: 0,
      totalEvents: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Calculate combined risk score
   */
  private calculateRiskScore(
    indicators: Indicator[],
    event: SecurityEvent,
    sessionHops: SessionHops | null
  ): { score: number; calculatedSeverity: AnomalySeverity } {
    const totalWeight = indicators.reduce((sum, i) => sum + i.weight, 0);
    const signalCount = indicators.length;
    const correlationBonus = Math.min(20, (signalCount - 1) * 5);

    // Check for high-severity combinations
    const hasNewSensitiveSystem = indicators.some((i) => i.type === 'sensitive_system_access');
    const hasRapidHops = indicators.some((i) => i.type === 'rapid_system_switching');
    const hasServiceAccountAnomaly = indicators.some((i) =>
      i.type.startsWith('service_account_')
    );
    const hasCrossTenant = indicators.some((i) =>
      i.type === 'excessive_cross_tenant' || i.type === 'rapid_tenant_switching'
    );

    let score = Math.min(100, totalWeight + correlationBonus);

    // Boost for critical combinations
    if (hasNewSensitiveSystem && hasRapidHops) {
      score = Math.min(100, score + 15);
    }
    if (hasServiceAccountAnomaly && hasNewSensitiveSystem) {
      score = Math.min(100, score + 20);
    }
    if (hasCrossTenant && hasRapidHops) {
      score = Math.min(100, score + 10);
    }

    // Determine severity
    let calculatedSeverity: AnomalySeverity;
    if (score >= 85 || (hasServiceAccountAnomaly && hasNewSensitiveSystem)) {
      calculatedSeverity = Severity.CRITICAL;
    } else if (score >= 70 || (hasCrossTenant && hasRapidHops)) {
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
    const parts: string[] = ['Potential lateral movement detected:'];

    const newSystemIndicator = indicators.find((i) =>
      i.type === 'new_system_access' || i.type === 'sensitive_system_access'
    );
    if (newSystemIndicator) {
      parts.push(newSystemIndicator.description);
    }

    const hopIndicator = indicators.find((i) =>
      i.type === 'excessive_session_hops' || i.type === 'rapid_system_switching'
    );
    if (hopIndicator) {
      parts.push(hopIndicator.description);
    }

    const svcIndicator = indicators.find((i) => i.type.startsWith('service_account_'));
    if (svcIndicator) {
      parts.push(svcIndicator.description);
    }

    if (parts.length === 1) {
      parts.push(`${indicators.length} suspicious movement indicators found.`);
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
 * Create a new lateral movement detector instance
 */
export function createLateralMovementDetector(
  config?: Partial<LateralMovementDetectorConfig>,
  keyPrefix?: string
): LateralMovementDetector {
  return new LateralMovementDetector(config, keyPrefix);
}
