/**
 * Privilege Escalation Detector
 *
 * Detects suspicious privilege escalation patterns by analyzing:
 * - Unusual permission grants
 * - Role changes outside normal patterns
 * - Access to resources above user's typical level
 *
 * Uses behavioral baselines to identify deviations from normal patterns
 * including frequency, time of day, and approver patterns.
 *
 * @packageDocumentation
 * @module security/anomaly/detectors/privilege-escalation
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

const logger = createLogger({ component: 'privilege-escalation-detector' });

// =============================================================================
// Constants
// =============================================================================

/** Redis key prefix for privilege baselines */
const PRIVILEGE_BASELINE_PREFIX = 'vorion:anomaly:privilege:baseline:';

/** Redis key prefix for role change history */
const ROLE_HISTORY_PREFIX = 'vorion:anomaly:privilege:role:';

/** Redis key prefix for approver patterns */
const APPROVER_PATTERN_PREFIX = 'vorion:anomaly:privilege:approver:';

/** Redis key prefix for peer group baselines */
const PEER_GROUP_PREFIX = 'vorion:anomaly:privilege:peer:';

/** Time-to-live for baselines in seconds (30 days) */
const BASELINE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Maximum history records to keep per user */
const MAX_HISTORY_RECORDS = 200;

/** Minimum events to establish baseline */
const MIN_EVENTS_FOR_BASELINE = 10;

/** Hours in a day for time-based analysis */
const HOURS_IN_DAY = 24;

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for privilege escalation detection
 */
export interface PrivilegeEscalationDetectorConfig {
  /** Normal business hours start (0-23) */
  normalHoursStart: number;
  /** Normal business hours end (0-23) */
  normalHoursEnd: number;
  /** High-risk permission patterns (regex) */
  highRiskPermissions: string[];
  /** Admin/elevated roles to flag */
  elevatedRoles: string[];
  /** Maximum permission grants per day before alerting */
  maxDailyGrants: number;
  /** Whether to compare against peer group */
  enablePeerGroupComparison: boolean;
  /** Sensitivity levels for different resource types */
  resourceSensitivity: Record<string, number>;
}

export const DEFAULT_PRIVILEGE_ESCALATION_CONFIG: PrivilegeEscalationDetectorConfig = {
  normalHoursStart: 8,
  normalHoursEnd: 18,
  highRiskPermissions: ['admin', 'root', 'sudo', 'superuser', 'owner', 'delete', 'destroy'],
  elevatedRoles: ['admin', 'superadmin', 'root', 'owner', 'security-admin'],
  maxDailyGrants: 5,
  enablePeerGroupComparison: true,
  resourceSensitivity: {
    'user-data': 80,
    'financial': 90,
    'credentials': 100,
    'audit-logs': 85,
    'infrastructure': 95,
    'default': 50,
  },
};

// =============================================================================
// Baseline Types
// =============================================================================

/**
 * User's privilege baseline
 */
interface PrivilegeBaseline {
  userId: string;
  role?: string;
  /** Permission grant frequency histogram by hour */
  grantHourHistogram: number[];
  /** Day of week histogram for grants */
  grantDayHistogram: number[];
  /** Common approvers for this user */
  commonApprovers: Record<string, number>;
  /** Typical resource access levels */
  typicalResourceLevels: Record<string, number>;
  /** Total permission change events */
  totalEvents: number;
  /** Recent grant count (rolling 24h) */
  recentGrantCount: number;
  /** Last updated timestamp */
  lastUpdated: string;
}

/**
 * Role change record
 */
interface RoleChangeRecord {
  timestamp: string;
  previousRole?: string;
  newRole: string;
  approver?: string;
  resource?: string;
  eventId: string;
}

/**
 * Peer group baseline
 */
interface PeerGroupBaseline {
  role: string;
  avgDailyGrants: number;
  avgGrantHour: number;
  stdDevGrantHour: number;
  commonResources: string[];
  memberCount: number;
  lastUpdated: string;
}

// =============================================================================
// Privilege Escalation Detector Implementation
// =============================================================================

/**
 * Privilege escalation anomaly detector
 */
export class PrivilegeEscalationDetector implements Detector {
  public readonly name = 'privilege-escalation';
  public readonly description =
    'Detects unusual permission grants, role changes, and access to elevated resources';

  private readonly config: PrivilegeEscalationDetectorConfig;
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor(
    config: Partial<PrivilegeEscalationDetectorConfig> = {},
    keyPrefix: string = PRIVILEGE_BASELINE_PREFIX
  ) {
    this.config = { ...DEFAULT_PRIVILEGE_ESCALATION_CONFIG, ...config };
    this.redis = getRedis();
    this.keyPrefix = keyPrefix;
  }

  /**
   * Analyze an event for privilege escalation anomalies
   */
  async detect(event: SecurityEvent): Promise<DetectionResult> {
    const startTime = performance.now();
    const indicators: Indicator[] = [];
    const suggestedActions: string[] = [];

    try {
      // Only analyze privilege-related events
      if (!this.isPrivilegeEvent(event)) {
        return this.createResult(false, indicators, suggestedActions, startTime);
      }

      const userId = event.userId;
      if (!userId) {
        return this.createResult(false, indicators, suggestedActions, startTime);
      }

      // Get user's baseline
      const baseline = await this.getBaseline(userId);

      // Check for unusual permission grants
      const grantResult = await this.checkUnusualPermissionGrant(event, baseline);
      if (grantResult.detected) {
        indicators.push(...grantResult.indicators);
        suggestedActions.push(
          'Review the permission grant for legitimacy',
          'Verify the approver is authorized for this type of grant'
        );
      }

      // Check for role changes outside normal patterns
      const roleResult = await this.checkRoleChangePattern(event, baseline);
      if (roleResult.detected) {
        indicators.push(...roleResult.indicators);
        suggestedActions.push(
          'Verify role change was properly authorized',
          'Check if change follows normal approval workflow'
        );
      }

      // Check for access above typical level
      const accessResult = await this.checkElevatedAccess(event, baseline);
      if (accessResult.detected) {
        indicators.push(...accessResult.indicators);
        suggestedActions.push(
          'Review resource access justification',
          'Consider temporary access elevation with expiry'
        );
      }

      // Check time-based anomalies
      const timeResult = this.checkTimeAnomaly(event, baseline);
      if (timeResult.detected) {
        indicators.push(...timeResult.indicators);
        suggestedActions.push(
          'Verify user was authorized to make changes at this time',
          'Check for signs of account compromise'
        );
      }

      // Check approver patterns
      const approverResult = await this.checkApproverAnomaly(event, baseline);
      if (approverResult.detected) {
        indicators.push(...approverResult.indicators);
        suggestedActions.push(
          'Verify approver is authorized for this user/resource',
          'Check for collusion or compromised approver account'
        );
      }

      // Check against peer group if enabled
      if (this.config.enablePeerGroupComparison && baseline.role) {
        const peerResult = await this.checkAgainstPeerGroup(event, baseline);
        if (peerResult.detected) {
          indicators.push(...peerResult.indicators);
          suggestedActions.push(
            'Activity deviates significantly from peer group norms',
            'Review whether user role assignment is correct'
          );
        }
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
      logger.error({ error, eventId: event.eventId }, 'Privilege escalation detection failed');

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
    if (!this.isPrivilegeEvent(event) || !event.userId) {
      return;
    }

    try {
      await Promise.all([
        this.updateUserBaseline(event),
        this.updateRoleHistory(event),
        this.updateApproverPattern(event),
        this.updatePeerGroupBaseline(event),
      ]);

      logger.debug(
        { userId: event.userId, eventType: event.eventType },
        'Updated privilege escalation baselines'
      );
    } catch (error) {
      logger.error({ error, userId: event.userId }, 'Failed to update privilege baselines');
    }
  }

  /**
   * Reset all learned baselines
   */
  async reset(): Promise<void> {
    try {
      const patterns = [
        `${this.keyPrefix}*`,
        `${ROLE_HISTORY_PREFIX}*`,
        `${APPROVER_PATTERN_PREFIX}*`,
        `${PEER_GROUP_PREFIX}*`,
      ];

      for (const pattern of patterns) {
        await this.deleteKeysByPattern(pattern);
      }

      logger.info('Privilege escalation detector baselines reset');
    } catch (error) {
      logger.error({ error }, 'Failed to reset privilege escalation detector');
      throw error;
    }
  }

  /**
   * Get baseline for a specific user
   */
  async getBaseline(userId: string): Promise<PrivilegeBaseline> {
    const key = `${this.keyPrefix}${userId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return this.createEmptyBaseline(userId);
    }

    try {
      return JSON.parse(data) as PrivilegeBaseline;
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
   * Check if event is privilege-related
   */
  private isPrivilegeEvent(event: SecurityEvent): boolean {
    const privilegeEventTypes = [
      'permission_grant',
      'permission_revoke',
      'role_change',
      'role_assignment',
      'access_elevation',
      'privilege_escalation',
      'admin_action',
      'sensitive_access',
    ];

    return privilegeEventTypes.includes(event.eventType) ||
           event.eventType.includes('privilege') ||
           event.eventType.includes('permission') ||
           event.eventType.includes('role');
  }

  /**
   * Check for unusual permission grants
   */
  private async checkUnusualPermissionGrant(
    event: SecurityEvent,
    baseline: PrivilegeBaseline
  ): Promise<{ detected: boolean; indicators: Indicator[] }> {
    const indicators: Indicator[] = [];
    const metadata = event.metadata || {};

    // Check for high-risk permissions
    const permission = metadata['permission'] as string || metadata['action'] as string || '';
    const isHighRisk = this.config.highRiskPermissions.some(
      (pattern) => new RegExp(pattern, 'i').test(permission)
    );

    if (isHighRisk) {
      indicators.push({
        type: 'high_risk_permission',
        description: `High-risk permission granted: ${permission}`,
        value: permission,
        weight: 60,
      });
    }

    // Check frequency
    if (baseline.totalEvents >= MIN_EVENTS_FOR_BASELINE) {
      const dailyCount = await this.getDailyGrantCount(event.userId!);
      if (dailyCount > this.config.maxDailyGrants) {
        indicators.push({
          type: 'excessive_grants',
          description: `${dailyCount} permission grants today exceeds threshold of ${this.config.maxDailyGrants}`,
          value: dailyCount,
          weight: 45,
        });
      }
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check for role changes outside normal patterns
   */
  private async checkRoleChangePattern(
    event: SecurityEvent,
    baseline: PrivilegeBaseline
  ): Promise<{ detected: boolean; indicators: Indicator[] }> {
    const indicators: Indicator[] = [];
    const metadata = event.metadata || {};

    const newRole = metadata['newRole'] as string || metadata['role'] as string;
    const previousRole = metadata['previousRole'] as string || baseline.role;

    if (!newRole) {
      return { detected: false, indicators };
    }

    // Check for elevation to admin/elevated role
    const isElevation = this.config.elevatedRoles.some(
      (role) => newRole.toLowerCase().includes(role.toLowerCase())
    );

    if (isElevation) {
      const wasAlreadyElevated = previousRole && this.config.elevatedRoles.some(
        (role) => previousRole.toLowerCase().includes(role.toLowerCase())
      );

      if (!wasAlreadyElevated) {
        indicators.push({
          type: 'role_elevation',
          description: `User elevated to privileged role: ${newRole} from ${previousRole || 'none'}`,
          value: newRole,
          weight: 70,
        });
      }
    }

    // Check for unusual role change frequency
    const recentChanges = await this.getRecentRoleChanges(event.userId!);
    if (recentChanges.length >= 3) {
      indicators.push({
        type: 'frequent_role_changes',
        description: `${recentChanges.length} role changes in recent period`,
        value: recentChanges.length,
        weight: 40,
      });
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check for access to resources above typical level
   */
  private async checkElevatedAccess(
    event: SecurityEvent,
    baseline: PrivilegeBaseline
  ): Promise<{ detected: boolean; indicators: Indicator[] }> {
    const indicators: Indicator[] = [];
    const resource = event.resource || (event.metadata?.['resource'] as string);

    if (!resource) {
      return { detected: false, indicators };
    }

    // Determine resource sensitivity
    const sensitivity = this.getResourceSensitivity(resource);
    const typicalLevel = baseline.typicalResourceLevels[resource] ||
                         baseline.typicalResourceLevels['default'] ||
                         50;

    // Flag if accessing significantly more sensitive resources
    if (sensitivity > typicalLevel + 20) {
      indicators.push({
        type: 'elevated_resource_access',
        description: `Accessing resource with sensitivity ${sensitivity} (typical level: ${typicalLevel})`,
        value: sensitivity,
        weight: Math.min(100, Math.round((sensitivity - typicalLevel) * 1.5)),
      });
    }

    // Check for first-time access to sensitive resource
    if (baseline.totalEvents >= MIN_EVENTS_FOR_BASELINE &&
        !baseline.typicalResourceLevels[resource] &&
        sensitivity >= 70) {
      indicators.push({
        type: 'new_sensitive_resource',
        description: `First-time access to sensitive resource: ${resource}`,
        value: resource,
        weight: 35,
      });
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check for time-based anomalies
   */
  private checkTimeAnomaly(
    event: SecurityEvent,
    baseline: PrivilegeBaseline
  ): { detected: boolean; indicators: Indicator[] } {
    const indicators: Indicator[] = [];
    const hour = event.timestamp.getHours();
    const day = event.timestamp.getDay();

    // Check outside business hours
    const isOutsideHours = hour < this.config.normalHoursStart ||
                           hour >= this.config.normalHoursEnd;
    const isWeekend = day === 0 || day === 6;

    if (isOutsideHours) {
      indicators.push({
        type: 'outside_business_hours',
        description: `Privilege change at ${hour}:00 outside normal hours (${this.config.normalHoursStart}:00-${this.config.normalHoursEnd}:00)`,
        value: hour,
        weight: 35,
      });
    }

    if (isWeekend) {
      indicators.push({
        type: 'weekend_privilege_change',
        description: `Privilege change on weekend`,
        value: day,
        weight: 30,
      });
    }

    // Check against user's historical pattern
    if (baseline.totalEvents >= MIN_EVENTS_FOR_BASELINE) {
      const hourTotal = baseline.grantHourHistogram.reduce((a, b) => a + b, 0);
      const hourPercentage = hourTotal > 0
        ? (baseline.grantHourHistogram[hour] / hourTotal) * 100
        : 0;

      if (hourPercentage < 5 && baseline.grantHourHistogram[hour] === 0) {
        indicators.push({
          type: 'unusual_time_pattern',
          description: `First privilege change recorded at ${hour}:00 for this user`,
          value: hour,
          weight: 25,
        });
      }
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check for anomalous approver patterns
   */
  private async checkApproverAnomaly(
    event: SecurityEvent,
    baseline: PrivilegeBaseline
  ): Promise<{ detected: boolean; indicators: Indicator[] }> {
    const indicators: Indicator[] = [];
    const metadata = event.metadata || {};
    const approver = metadata['approver'] as string || metadata['approvedBy'] as string;

    if (!approver || baseline.totalEvents < MIN_EVENTS_FOR_BASELINE) {
      return { detected: false, indicators };
    }

    // Check if this is a new approver for this user
    const approverCount = baseline.commonApprovers[approver] || 0;
    const totalApprovals = Object.values(baseline.commonApprovers).reduce((a, b) => a + b, 0);

    if (totalApprovals > 5 && approverCount === 0) {
      indicators.push({
        type: 'new_approver',
        description: `Permission approved by new approver: ${approver}`,
        value: approver,
        weight: 30,
      });
    }

    // Check for self-approval
    if (approver === event.userId) {
      indicators.push({
        type: 'self_approval',
        description: 'User approved their own privilege change',
        value: true,
        weight: 80,
      });
    }

    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Check against peer group baseline
   */
  private async checkAgainstPeerGroup(
    event: SecurityEvent,
    baseline: PrivilegeBaseline
  ): Promise<{ detected: boolean; indicators: Indicator[] }> {
    const indicators: Indicator[] = [];

    if (!baseline.role) {
      return { detected: false, indicators };
    }

    const peerBaseline = await this.getPeerGroupBaseline(baseline.role);
    if (!peerBaseline || peerBaseline.memberCount < 5) {
      return { detected: false, indicators };
    }

    // Check if daily grants significantly exceed peer group average
    const dailyGrants = await this.getDailyGrantCount(event.userId!);
    if (dailyGrants > peerBaseline.avgDailyGrants * 3) {
      indicators.push({
        type: 'exceeds_peer_group',
        description: `Daily grants (${dailyGrants}) significantly exceeds peer group average (${peerBaseline.avgDailyGrants.toFixed(1)})`,
        value: dailyGrants,
        weight: 40,
      });
    }

    // Check time deviation from peer group norm
    const hour = event.timestamp.getHours();
    if (peerBaseline.stdDevGrantHour > 0) {
      const zScore = Math.abs(hour - peerBaseline.avgGrantHour) / peerBaseline.stdDevGrantHour;
      if (zScore > 2.5) {
        indicators.push({
          type: 'unusual_time_vs_peers',
          description: `Grant time (${hour}:00) deviates significantly from peer group norm`,
          value: zScore,
          weight: 30,
        });
      }
    }

    return { detected: indicators.length > 0, indicators };
  }

  // ===========================================================================
  // Private Baseline Methods
  // ===========================================================================

  /**
   * Update user's privilege baseline
   */
  private async updateUserBaseline(event: SecurityEvent): Promise<void> {
    const userId = event.userId!;
    const baseline = await this.getBaseline(userId);
    const hour = event.timestamp.getHours();
    const day = event.timestamp.getDay();
    const metadata = event.metadata || {};

    // Update histograms
    baseline.grantHourHistogram[hour]++;
    baseline.grantDayHistogram[day]++;
    baseline.totalEvents++;

    // Update role if present
    const role = metadata['role'] as string || metadata['newRole'] as string;
    if (role) {
      baseline.role = role;
    }

    // Update approver pattern
    const approver = metadata['approver'] as string || metadata['approvedBy'] as string;
    if (approver) {
      baseline.commonApprovers[approver] = (baseline.commonApprovers[approver] || 0) + 1;
    }

    // Update resource levels
    const resource = event.resource || (metadata['resource'] as string);
    if (resource) {
      const sensitivity = this.getResourceSensitivity(resource);
      baseline.typicalResourceLevels[resource] = sensitivity;
    }

    baseline.lastUpdated = new Date().toISOString();

    // Store updated baseline
    const key = `${this.keyPrefix}${userId}`;
    await this.redis.set(key, JSON.stringify(baseline), 'EX', BASELINE_TTL_SECONDS);

    // Update daily count
    await this.incrementDailyGrantCount(userId);
  }

  /**
   * Update role change history
   */
  private async updateRoleHistory(event: SecurityEvent): Promise<void> {
    const metadata = event.metadata || {};
    const newRole = metadata['newRole'] as string || metadata['role'] as string;

    if (!newRole) {
      return;
    }

    const record: RoleChangeRecord = {
      timestamp: event.timestamp.toISOString(),
      previousRole: metadata['previousRole'] as string,
      newRole,
      approver: metadata['approver'] as string || metadata['approvedBy'] as string,
      resource: event.resource,
      eventId: event.eventId,
    };

    const key = `${ROLE_HISTORY_PREFIX}${event.userId}`;
    await this.redis.zadd(key, event.timestamp.getTime(), JSON.stringify(record));

    // Trim old records
    const count = await this.redis.zcard(key);
    if (count > MAX_HISTORY_RECORDS) {
      await this.redis.zremrangebyrank(key, 0, count - MAX_HISTORY_RECORDS - 1);
    }

    await this.redis.expire(key, BASELINE_TTL_SECONDS);
  }

  /**
   * Update approver patterns
   */
  private async updateApproverPattern(event: SecurityEvent): Promise<void> {
    const metadata = event.metadata || {};
    const approver = metadata['approver'] as string || metadata['approvedBy'] as string;

    if (!approver) {
      return;
    }

    const key = `${APPROVER_PATTERN_PREFIX}${approver}`;
    await this.redis.hincrby(key, 'totalApprovals', 1);
    await this.redis.hincrby(key, `user:${event.userId}`, 1);
    await this.redis.expire(key, BASELINE_TTL_SECONDS);
  }

  /**
   * Update peer group baseline
   */
  private async updatePeerGroupBaseline(event: SecurityEvent): Promise<void> {
    const baseline = await this.getBaseline(event.userId!);
    const role = baseline.role;

    if (!role) {
      return;
    }

    const hour = event.timestamp.getHours();
    const key = `${PEER_GROUP_PREFIX}${role}`;

    // Use Redis hash for aggregate stats
    await this.redis.hincrby(key, 'totalGrants', 1);
    await this.redis.hincrby(key, `hour:${hour}`, 1);
    await this.redis.hincrby(key, 'hourSum', hour);
    await this.redis.sadd(`${key}:members`, event.userId!);
    await this.redis.expire(key, BASELINE_TTL_SECONDS);
    await this.redis.expire(`${key}:members`, BASELINE_TTL_SECONDS);
  }

  /**
   * Get peer group baseline
   */
  private async getPeerGroupBaseline(role: string): Promise<PeerGroupBaseline | null> {
    const key = `${PEER_GROUP_PREFIX}${role}`;
    const data = await this.redis.hgetall(key);

    if (!data || !data['totalGrants']) {
      return null;
    }

    const totalGrants = parseInt(data['totalGrants'], 10);
    const hourSum = parseInt(data['hourSum'] || '0', 10);
    const memberCount = await this.redis.scard(`${key}:members`);

    // Calculate hour statistics
    const hourCounts: number[] = [];
    for (let h = 0; h < HOURS_IN_DAY; h++) {
      hourCounts.push(parseInt(data[`hour:${h}`] || '0', 10));
    }

    const avgGrantHour = totalGrants > 0 ? hourSum / totalGrants : 12;
    const variance = hourCounts.reduce((sum, count, hour) => {
      return sum + count * Math.pow(hour - avgGrantHour, 2);
    }, 0) / Math.max(1, totalGrants);
    const stdDevGrantHour = Math.sqrt(variance);

    // Estimate daily grants (assuming 30-day window)
    const avgDailyGrants = totalGrants / 30 / Math.max(1, memberCount);

    return {
      role,
      avgDailyGrants,
      avgGrantHour,
      stdDevGrantHour,
      commonResources: [],
      memberCount,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Get recent role changes for a user
   */
  private async getRecentRoleChanges(userId: string): Promise<RoleChangeRecord[]> {
    const key = `${ROLE_HISTORY_PREFIX}${userId}`;
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);

    const records = await this.redis.zrangebyscore(key, oneDayAgo, '+inf');
    return records.map((r) => JSON.parse(r) as RoleChangeRecord);
  }

  /**
   * Get daily grant count for a user
   */
  private async getDailyGrantCount(userId: string): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const key = `${this.keyPrefix}daily:${userId}:${today}`;
    const count = await this.redis.get(key);
    return count ? parseInt(count, 10) : 0;
  }

  /**
   * Increment daily grant count
   */
  private async incrementDailyGrantCount(userId: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const key = `${this.keyPrefix}daily:${userId}:${today}`;
    await this.redis.incr(key);
    await this.redis.expire(key, 24 * 60 * 60); // 24 hours
  }

  /**
   * Get resource sensitivity level
   */
  private getResourceSensitivity(resource: string): number {
    const lowerResource = resource.toLowerCase();

    for (const [pattern, sensitivity] of Object.entries(this.config.resourceSensitivity)) {
      if (pattern !== 'default' && lowerResource.includes(pattern)) {
        return sensitivity;
      }
    }

    return this.config.resourceSensitivity['default'] || 50;
  }

  /**
   * Create empty baseline for new user
   */
  private createEmptyBaseline(userId: string): PrivilegeBaseline {
    return {
      userId,
      grantHourHistogram: new Array(HOURS_IN_DAY).fill(0),
      grantDayHistogram: new Array(7).fill(0),
      commonApprovers: {},
      typicalResourceLevels: {},
      totalEvents: 0,
      recentGrantCount: 0,
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
    // Weight-based scoring with signal correlation
    const totalWeight = indicators.reduce((sum, i) => sum + i.weight, 0);

    // Apply correlation bonus for multiple signals
    const signalCount = indicators.length;
    const correlationBonus = Math.min(20, (signalCount - 1) * 5);

    // Check for high-severity combinations
    const hasElevation = indicators.some((i) => i.type === 'role_elevation');
    const hasSelfApproval = indicators.some((i) => i.type === 'self_approval');
    const hasHighRisk = indicators.some((i) => i.type === 'high_risk_permission');
    const hasUnusualTime = indicators.some((i) =>
      i.type === 'outside_business_hours' || i.type === 'weekend_privilege_change'
    );

    let score = Math.min(100, totalWeight + correlationBonus);

    // Boost for critical combinations
    if (hasSelfApproval && hasElevation) {
      score = Math.min(100, score + 15);
    }
    if (hasHighRisk && hasUnusualTime) {
      score = Math.min(100, score + 10);
    }

    // Determine severity
    let calculatedSeverity: AnomalySeverity;
    if (score >= 85 || hasSelfApproval) {
      calculatedSeverity = Severity.CRITICAL;
    } else if (score >= 70 || (hasElevation && hasUnusualTime)) {
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
    const parts: string[] = ['Potential privilege escalation detected:'];

    const elevationIndicator = indicators.find((i) => i.type === 'role_elevation');
    if (elevationIndicator) {
      parts.push(elevationIndicator.description);
    }

    const selfApproval = indicators.find((i) => i.type === 'self_approval');
    if (selfApproval) {
      parts.push('Self-approval of privilege change detected.');
    }

    const highRisk = indicators.find((i) => i.type === 'high_risk_permission');
    if (highRisk) {
      parts.push(highRisk.description);
    }

    if (parts.length === 1) {
      parts.push(`${indicators.length} suspicious indicators found.`);
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
 * Create a new privilege escalation detector instance
 */
export function createPrivilegeEscalationDetector(
  config?: Partial<PrivilegeEscalationDetectorConfig>,
  keyPrefix?: string
): PrivilegeEscalationDetector {
  return new PrivilegeEscalationDetector(config, keyPrefix);
}
