/**
 * Security Alert Service
 *
 * Main service for security alerting that coordinates:
 * - Alert detection and creation
 * - Deduplication
 * - Channel routing
 * - Escalation management
 * - Maintenance window suppression
 * - Integration with incident response
 *
 * @packageDocumentation
 * @module security/alerting/service
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../../common/logger.js';
import { getRedis } from '../../common/redis.js';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { z } from 'zod';
import {
  type SecurityAlert,
  type CreateAlertInput,
  type AlertConfig,
  type AlertRule,
  type ChannelConfig,
  type MaintenanceWindow,
  type EscalationPolicy,
  type AlertDeliveryResult,
  type AlertEvent,
  type AlertEventCallback,
  AlertChannel,
  AlertSeverity,
  SecurityEventType,
  DEFAULT_ALERT_CONFIG,
} from './types.js';
import {
  SecurityAlertDetector,
  type DetectorSecurityEvent,
  createSecurityAlertDetector,
} from './detector.js';
import {
  SlackAlertChannel,
  PagerDutyAlertChannel,
  EmailAlertChannel,
  WebhookAlertChannel,
  SNSAlertChannel,
} from './channels/index.js';

const logger = createLogger({ component: 'security-alert-service' });

// =============================================================================
// Constants
// =============================================================================

const ALERT_PREFIX = 'vorion:alerting:alert:';
const DEDUP_PREFIX = 'vorion:alerting:dedup:';
const ESCALATION_PREFIX = 'vorion:alerting:escalation:';
const RATE_LIMIT_PREFIX = 'vorion:alerting:rate:';

// =============================================================================
// Zod Schemas for Alert Data Validation
// =============================================================================

/**
 * Schema for validating stored alert data from Redis
 */
const storedAlertSchema = z.object({
  id: z.string().uuid(),
  type: z.nativeEnum(SecurityEventType),
  severity: z.nativeEnum(AlertSeverity),
  title: z.string(),
  description: z.string(),
  timestamp: z.string().datetime(),
  fingerprint: z.string(),
  acknowledged: z.boolean(),
  acknowledgedBy: z.string().optional(),
  acknowledgedAt: z.string().datetime().optional(),
  resolved: z.boolean(),
  resolutionNotes: z.string().optional(),
  context: z.object({
    tenantId: z.string().optional(),
    userId: z.string().optional(),
    ipAddress: z.string().optional(),
    resource: z.string().optional(),
  }).passthrough(),
});

// =============================================================================
// Types
// =============================================================================

export interface SecurityAlertServiceOptions {
  /** Alert configuration */
  config?: Partial<AlertConfig>;
  /** Redis instance */
  redis?: Redis;
  /** Alert detector instance */
  detector?: SecurityAlertDetector;
  /** Incident manager integration */
  incidentManager?: {
    createIncident: (alert: SecurityAlert) => Promise<string>;
    linkAlert: (alertId: string, incidentId: string) => Promise<void>;
  };
}

// =============================================================================
// SecurityAlertService Class
// =============================================================================

/**
 * Main security alerting service
 */
export class SecurityAlertService {
  private readonly redis: Redis;
  private readonly config: AlertConfig;
  private readonly detector: SecurityAlertDetector;
  private readonly eventCallbacks: AlertEventCallback[] = [];

  // Channel instances
  private slackChannel?: SlackAlertChannel;
  private pagerDutyChannel?: PagerDutyAlertChannel;
  private emailChannel?: EmailAlertChannel;
  private webhookChannels: Map<string, WebhookAlertChannel> = new Map();
  private snsChannel?: SNSAlertChannel;

  // Incident manager integration
  private incidentManager?: SecurityAlertServiceOptions['incidentManager'];

  // Escalation timers
  private escalationTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(options: SecurityAlertServiceOptions = {}) {
    this.redis = options.redis ?? getRedis();
    this.config = {
      ...DEFAULT_ALERT_CONFIG,
      ...options.config,
    } as AlertConfig;
    this.detector = options.detector ?? createSecurityAlertDetector();
    this.incidentManager = options.incidentManager;

    // Initialize channels from config
    this.initializeChannels();

    logger.info(
      {
        enabled: this.config.enabled,
        rulesCount: this.config.rules.length,
        defaultChannelsCount: this.config.defaultChannels.length,
      },
      'SecurityAlertService initialized'
    );
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Process a security event and potentially create alerts
   */
  async processSecurityEvent(event: DetectorSecurityEvent): Promise<SecurityAlert[]> {
    if (!this.config.enabled) {
      return [];
    }

    const alerts: SecurityAlert[] = [];

    // Run detection
    const detectionResults = await this.detector.detect(event);

    for (const result of detectionResults) {
      if (!result.shouldAlert || !result.alert) {
        continue;
      }

      // Create alert
      const alert = await this.createAlert(result.alert);

      if (alert) {
        alerts.push(alert);

        // Send to channels
        await this.sendAlert(alert, result.triggeredRule?.channels);
      }
    }

    return alerts;
  }

  /**
   * Create and process an alert directly
   */
  async createAlert(input: CreateAlertInput): Promise<SecurityAlert | null> {
    // Generate fingerprint for deduplication
    const fingerprint = this.generateFingerprint(input);

    // Check deduplication
    if (await this.isDuplicate(fingerprint)) {
      logger.debug(
        { fingerprint, type: input.type },
        'Alert deduplicated'
      );
      await this.emitEvent({
        type: 'deduplicated',
        alert: { ...input, fingerprint } as any,
        timestamp: new Date(),
      });
      return null;
    }

    // Check maintenance window
    if (this.isInMaintenanceWindow(input)) {
      logger.debug(
        { type: input.type, severity: input.severity },
        'Alert suppressed during maintenance window'
      );
      await this.emitEvent({
        type: 'suppressed',
        alert: { ...input, fingerprint } as any,
        timestamp: new Date(),
        metadata: { reason: 'maintenance_window' },
      });
      return null;
    }

    // Create the alert
    const alert: SecurityAlert = {
      id: uuidv4(),
      ...input,
      timestamp: new Date(),
      fingerprint,
      acknowledged: false,
      resolved: false,
    };

    // Store alert
    await this.storeAlert(alert);

    // Mark as seen for deduplication
    await this.markAsSeen(fingerprint);

    // Emit created event
    await this.emitEvent({
      type: 'created',
      alert,
      timestamp: new Date(),
    });

    logger.info(
      {
        alertId: alert.id,
        severity: alert.severity,
        type: alert.type,
        fingerprint,
      },
      'Alert created'
    );

    return alert;
  }

  /**
   * Send an alert to configured channels
   */
  async sendAlert(
    alert: SecurityAlert,
    channelConfigs?: ChannelConfig[]
  ): Promise<AlertDeliveryResult[]> {
    const channels = channelConfigs && channelConfigs.length > 0
      ? channelConfigs
      : this.config.defaultChannels;

    // Filter channels based on severity, active hours, and rate limits
    const eligibleChannels: ChannelConfig[] = [];
    for (const channelConfig of channels) {
      // Check severity filter
      if (channelConfig.severityFilter &&
          !channelConfig.severityFilter.includes(alert.severity)) {
        continue;
      }

      // Check active hours
      if (channelConfig.activeHours && !this.isWithinActiveHours(channelConfig.activeHours)) {
        continue;
      }

      // Check rate limit
      if (channelConfig.rateLimit) {
        const rateLimitKey = `${channelConfig.channel}:${alert.context.tenantId || 'global'}`;
        if (await this.isRateLimited(rateLimitKey, channelConfig.rateLimit)) {
          logger.warn(
            { channel: channelConfig.channel, alertId: alert.id },
            'Alert rate limited for channel'
          );
          continue;
        }
      }

      eligibleChannels.push(channelConfig);
    }

    // Send to all eligible channels in parallel using Promise.allSettled
    const deliveryPromises = eligibleChannels.map((channelConfig) =>
      this.sendToChannel(alert, channelConfig).then((result) => ({
        result,
        channelConfig,
      }))
    );

    const settledResults = await Promise.allSettled(deliveryPromises);

    const results: AlertDeliveryResult[] = [];

    // Process settled results
    for (let i = 0; i < settledResults.length; i++) {
      const settled = settledResults[i];
      const channelConfig = eligibleChannels[i];

      if (settled.status === 'fulfilled') {
        const { result } = settled.value;
        results.push(result);

        // Emit sent event for successful deliveries
        if (result.success) {
          await this.emitEvent({
            type: 'sent',
            alert,
            timestamp: new Date(),
            channel: channelConfig.channel,
          });
        }
      } else {
        // Log rejected promises with context
        logger.error(
          {
            error: settled.reason,
            channel: channelConfig.channel,
            alertId: alert.id,
            operation: 'sendAlert',
          },
          'Channel delivery promise rejected'
        );

        // Create a failed result for the rejected promise
        results.push(this.createFailedResult(
          channelConfig.channel,
          settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
        ));
      }
    }

    // Start escalation timer if needed
    await this.startEscalationTimer(alert);

    // Create incident for critical alerts
    if (alert.severity === AlertSeverity.CRITICAL && this.incidentManager) {
      try {
        const incidentId = await this.incidentManager.createIncident(alert);
        await this.incidentManager.linkAlert(alert.id, incidentId);
        logger.info(
          { alertId: alert.id, incidentId },
          'Incident created from critical alert'
        );
      } catch (error) {
        logger.error(
          { error, alertId: alert.id },
          'Failed to create incident from alert'
        );
      }
    }

    return results;
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(
    alertId: string,
    acknowledgedBy: string
  ): Promise<SecurityAlert | null> {
    const alert = await this.getAlert(alertId);
    if (!alert) {
      return null;
    }

    alert.acknowledged = true;
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = new Date();

    await this.storeAlert(alert);

    // Cancel escalation timer
    this.cancelEscalationTimer(alertId);

    // Update in PagerDuty if sent there
    if (this.pagerDutyChannel) {
      await this.pagerDutyChannel.acknowledge(alert);
    }

    await this.emitEvent({
      type: 'acknowledged',
      alert,
      timestamp: new Date(),
      metadata: { acknowledgedBy },
    });

    logger.info(
      { alertId, acknowledgedBy },
      'Alert acknowledged'
    );

    return alert;
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(
    alertId: string,
    resolutionNotes?: string
  ): Promise<SecurityAlert | null> {
    const alert = await this.getAlert(alertId);
    if (!alert) {
      return null;
    }

    alert.resolved = true;
    alert.resolutionNotes = resolutionNotes;

    await this.storeAlert(alert);

    // Cancel escalation timer
    this.cancelEscalationTimer(alertId);

    // Resolve in PagerDuty if sent there
    if (this.pagerDutyChannel) {
      await this.pagerDutyChannel.resolve(alert);
    }

    await this.emitEvent({
      type: 'resolved',
      alert,
      timestamp: new Date(),
      metadata: { resolutionNotes },
    });

    logger.info(
      { alertId, resolutionNotes },
      'Alert resolved'
    );

    return alert;
  }

  /**
   * Get an alert by ID
   */
  async getAlert(alertId: string): Promise<SecurityAlert | null> {
    const key = `${ALERT_PREFIX}${alertId}`;
    const data = await this.redis.get(key);
    if (!data) return null;

    try {
      const parsed = JSON.parse(data);
      const validated = storedAlertSchema.safeParse(parsed);

      if (!validated.success) {
        logger.warn(
          {
            alertId,
            errors: validated.error.errors,
            operation: 'getAlert',
          },
          'Alert data validation failed'
        );
        return null;
      }

      const alert = validated.data as unknown as SecurityAlert;
      alert.timestamp = new Date(validated.data.timestamp);
      if (validated.data.acknowledgedAt) {
        alert.acknowledgedAt = new Date(validated.data.acknowledgedAt);
      }
      return alert;
    } catch (error) {
      logger.error(
        {
          alertId,
          error: error instanceof Error ? error.message : String(error),
          operation: 'getAlert',
        },
        'Failed to parse alert data'
      );
      return null;
    }
  }

  /**
   * Get recent alerts
   */
  async getRecentAlerts(
    options: {
      limit?: number;
      severity?: AlertSeverity[];
      type?: SecurityEventType[];
      acknowledged?: boolean;
      resolved?: boolean;
    } = {}
  ): Promise<SecurityAlert[]> {
    const { limit = 100 } = options;

    // Get alert IDs from sorted set
    const alertIds = await this.redis.zrevrange(
      `${this.config.redisKeyPrefix}alert_index`,
      0,
      limit - 1
    );

    const alerts: SecurityAlert[] = [];
    for (const alertId of alertIds) {
      const alert = await this.getAlert(alertId);
      if (!alert) continue;

      // Apply filters
      if (options.severity && !options.severity.includes(alert.severity)) continue;
      if (options.type && !options.type.includes(alert.type)) continue;
      if (options.acknowledged !== undefined && alert.acknowledged !== options.acknowledged) continue;
      if (options.resolved !== undefined && alert.resolved !== options.resolved) continue;

      alerts.push(alert);
    }

    return alerts;
  }

  /**
   * Add a maintenance window
   */
  addMaintenanceWindow(window: MaintenanceWindow): void {
    this.config.maintenanceWindows.push(window);
    logger.info(
      { windowId: window.id, name: window.name, endTime: window.endTime },
      'Maintenance window added'
    );
  }

  /**
   * Remove a maintenance window
   */
  removeMaintenanceWindow(windowId: string): boolean {
    const index = this.config.maintenanceWindows.findIndex(w => w.id === windowId);
    if (index >= 0) {
      this.config.maintenanceWindows.splice(index, 1);
      logger.info({ windowId }, 'Maintenance window removed');
      return true;
    }
    return false;
  }

  /**
   * Get active maintenance windows
   */
  getActiveMaintenanceWindows(): MaintenanceWindow[] {
    const now = new Date();
    return this.config.maintenanceWindows.filter(
      w => w.startTime <= now && w.endTime > now
    );
  }

  /**
   * Register an event callback
   */
  onEvent(callback: AlertEventCallback): void {
    this.eventCallbacks.push(callback);
  }

  /**
   * Add a custom alert rule
   */
  addRule(rule: AlertRule): void {
    this.config.rules.push(rule);
    this.detector.addRule(rule);
  }

  /**
   * Remove a custom alert rule
   */
  removeRule(ruleId: string): boolean {
    const index = this.config.rules.findIndex(r => r.id === ruleId);
    if (index >= 0) {
      this.config.rules.splice(index, 1);
      this.detector.removeRule(ruleId);
      return true;
    }
    return false;
  }

  /**
   * Test all configured channels
   */
  async testChannels(): Promise<Record<AlertChannel, boolean>> {
    const results: Partial<Record<AlertChannel, boolean>> = {};

    if (this.slackChannel) {
      results[AlertChannel.SLACK] = await this.slackChannel.test();
    }
    if (this.pagerDutyChannel) {
      results[AlertChannel.PAGERDUTY] = await this.pagerDutyChannel.test();
    }
    if (this.emailChannel) {
      results[AlertChannel.EMAIL] = await this.emailChannel.test();
    }
    if (this.snsChannel) {
      results[AlertChannel.SNS] = await this.snsChannel.test();
    }
    const webhookEntries = Array.from(this.webhookChannels.entries());
    if (webhookEntries.length > 0) {
      const [, channel] = webhookEntries[0];
      results[AlertChannel.WEBHOOK] = await channel.test();
    }

    return results as Record<AlertChannel, boolean>;
  }

  /**
   * Get alert statistics
   */
  async getStats(periodHours: number = 24): Promise<{
    total: number;
    bySeverity: Record<AlertSeverity, number>;
    byType: Record<string, number>;
    acknowledged: number;
    resolved: number;
    avgResponseTimeMs?: number;
  }> {
    const alerts = await this.getRecentAlerts({ limit: 1000 });
    const cutoff = new Date(Date.now() - periodHours * 60 * 60 * 1000);

    const recentAlerts = alerts.filter(a => a.timestamp >= cutoff);

    const stats = {
      total: recentAlerts.length,
      bySeverity: {} as Record<AlertSeverity, number>,
      byType: {} as Record<string, number>,
      acknowledged: 0,
      resolved: 0,
      avgResponseTimeMs: undefined as number | undefined,
    };

    let totalResponseTime = 0;
    let responseTimeCount = 0;

    for (const alert of recentAlerts) {
      // By severity
      stats.bySeverity[alert.severity] = (stats.bySeverity[alert.severity] || 0) + 1;

      // By type
      stats.byType[alert.type] = (stats.byType[alert.type] || 0) + 1;

      // Acknowledged
      if (alert.acknowledged) {
        stats.acknowledged++;
        if (alert.acknowledgedAt) {
          totalResponseTime += alert.acknowledgedAt.getTime() - alert.timestamp.getTime();
          responseTimeCount++;
        }
      }

      // Resolved
      if (alert.resolved) {
        stats.resolved++;
      }
    }

    if (responseTimeCount > 0) {
      stats.avgResponseTimeMs = Math.round(totalResponseTime / responseTimeCount);
    }

    return stats;
  }

  /**
   * Shutdown the service
   */
  shutdown(): void {
    // Cancel all escalation timers
    const timers = Array.from(this.escalationTimers.values());
    for (const timer of timers) {
      clearTimeout(timer);
    }
    this.escalationTimers.clear();

    logger.info('SecurityAlertService shutdown');
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Initialize channel instances from config
   */
  private initializeChannels(): void {
    const { channelSettings } = this.config;

    if (channelSettings.slack?.webhookUrl) {
      this.slackChannel = new SlackAlertChannel({
        webhookUrl: channelSettings.slack.webhookUrl,
        defaultChannel: channelSettings.slack.defaultChannel,
        username: channelSettings.slack.username,
        iconEmoji: channelSettings.slack.iconEmoji,
      });
    }

    if (channelSettings.pagerduty?.routingKey) {
      this.pagerDutyChannel = new PagerDutyAlertChannel({
        routingKey: channelSettings.pagerduty.routingKey,
        apiUrl: channelSettings.pagerduty.apiUrl,
      });
    }

    if (channelSettings.email?.host) {
      this.emailChannel = new EmailAlertChannel({
        provider: 'smtp',
        from: channelSettings.email.from,
        defaultRecipients: channelSettings.email.defaultRecipients || [],
        smtp: {
          host: channelSettings.email.host,
          port: channelSettings.email.port,
          secure: channelSettings.email.secure,
          auth: channelSettings.email.auth,
        },
      });
    }

    if (channelSettings.webhook?.defaultUrl) {
      this.webhookChannels.set(
        channelSettings.webhook.defaultUrl,
        new WebhookAlertChannel({
          url: channelSettings.webhook.defaultUrl,
          headers: channelSettings.webhook.headers,
          timeout: channelSettings.webhook.timeout,
        })
      );
    }

    if (channelSettings.sns?.topicArn) {
      this.snsChannel = new SNSAlertChannel({
        region: channelSettings.sns.region,
        topicArn: channelSettings.sns.topicArn,
        credentials: channelSettings.sns.accessKeyId && channelSettings.sns.secretAccessKey
          ? {
              accessKeyId: channelSettings.sns.accessKeyId,
              secretAccessKey: channelSettings.sns.secretAccessKey,
            }
          : undefined,
      });
    }
  }

  /**
   * Send alert to a specific channel
   */
  private async sendToChannel(
    alert: SecurityAlert,
    channelConfig: ChannelConfig
  ): Promise<AlertDeliveryResult> {
    try {
      switch (channelConfig.channel) {
        case AlertChannel.SLACK:
          if (!this.slackChannel) {
            return this.createFailedResult(AlertChannel.SLACK, 'Slack not configured');
          }
          return await this.slackChannel.send(alert);

        case AlertChannel.PAGERDUTY:
          if (!this.pagerDutyChannel) {
            return this.createFailedResult(AlertChannel.PAGERDUTY, 'PagerDuty not configured');
          }
          return await this.pagerDutyChannel.send(alert);

        case AlertChannel.EMAIL:
          if (!this.emailChannel) {
            return this.createFailedResult(AlertChannel.EMAIL, 'Email not configured');
          }
          const recipients = channelConfig.config?.recipients as string[] | undefined;
          if (recipients && recipients.length > 0) {
            return await this.emailChannel.sendToRecipients(alert, recipients);
          }
          return await this.emailChannel.send(alert);

        case AlertChannel.WEBHOOK:
          const webhookUrl = channelConfig.config?.url as string;
          let webhookChannel = this.webhookChannels.get(webhookUrl);
          if (!webhookChannel && webhookUrl) {
            webhookChannel = new WebhookAlertChannel({
              url: webhookUrl,
              headers: channelConfig.config?.headers as Record<string, string>,
            });
            this.webhookChannels.set(webhookUrl, webhookChannel);
          }
          if (!webhookChannel) {
            return this.createFailedResult(AlertChannel.WEBHOOK, 'Webhook not configured');
          }
          return await webhookChannel.send(alert);

        case AlertChannel.SNS:
          if (!this.snsChannel) {
            return this.createFailedResult(AlertChannel.SNS, 'SNS not configured');
          }
          return await this.snsChannel.send(alert);

        default:
          return this.createFailedResult(
            channelConfig.channel,
            `Unknown channel: ${channelConfig.channel}`
          );
      }
    } catch (error) {
      logger.error(
        { error, channel: channelConfig.channel, alertId: alert.id },
        'Failed to send alert to channel'
      );
      return this.createFailedResult(
        channelConfig.channel,
        (error as Error).message
      );
    }
  }

  private createFailedResult(channel: AlertChannel, error: string): AlertDeliveryResult {
    return {
      channel,
      success: false,
      error,
      timestamp: new Date(),
      retryCount: 0,
    };
  }

  /**
   * Generate fingerprint for deduplication
   */
  private generateFingerprint(input: CreateAlertInput): string {
    const data = [
      input.type,
      input.severity,
      input.context.userId || '',
      input.context.ipAddress || '',
      input.context.resource || '',
    ].join(':');

    return createHash('sha256').update(data).digest('hex').slice(0, 32);
  }

  /**
   * Check if alert is duplicate
   */
  private async isDuplicate(fingerprint: string): Promise<boolean> {
    const key = `${DEDUP_PREFIX}${fingerprint}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  /**
   * Mark fingerprint as seen
   */
  private async markAsSeen(fingerprint: string): Promise<void> {
    const key = `${DEDUP_PREFIX}${fingerprint}`;
    await this.redis.setex(key, this.config.deduplicationWindowSeconds, '1');
  }

  /**
   * Check if in maintenance window
   */
  private isInMaintenanceWindow(input: CreateAlertInput): boolean {
    const now = new Date();

    for (const window of this.config.maintenanceWindows) {
      if (window.startTime > now || window.endTime <= now) {
        continue;
      }

      // Check if suppress all
      if (window.suppressAll) {
        return true;
      }

      // Check severity filter
      if (window.suppressedSeverities &&
          window.suppressedSeverities.includes(input.severity)) {
        return true;
      }

      // Check event type filter
      if (window.suppressedEventTypes &&
          window.suppressedEventTypes.includes(input.type)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if within active hours
   */
  private isWithinActiveHours(activeHours: { start: number; end: number }): boolean {
    const hour = new Date().getHours();
    const { start, end } = activeHours;

    if (start <= end) {
      return hour >= start && hour < end;
    } else {
      // Wraps around midnight
      return hour >= start || hour < end;
    }
  }

  /**
   * Check rate limit
   */
  private async isRateLimited(key: string, limitPerMinute: number): Promise<boolean> {
    const fullKey = `${RATE_LIMIT_PREFIX}${key}`;
    const count = await this.redis.incr(fullKey);

    if (count === 1) {
      await this.redis.expire(fullKey, 60);
    }

    return count > limitPerMinute;
  }

  /**
   * Store alert in Redis
   */
  private async storeAlert(alert: SecurityAlert): Promise<void> {
    const key = `${ALERT_PREFIX}${alert.id}`;
    await this.redis.setex(key, 7 * 24 * 60 * 60, JSON.stringify(alert)); // 7 days

    // Add to index
    await this.redis.zadd(
      `${this.config.redisKeyPrefix}alert_index`,
      alert.timestamp.getTime(),
      alert.id
    );
  }

  /**
   * Start escalation timer for alert
   */
  private async startEscalationTimer(alert: SecurityAlert): Promise<void> {
    // Find applicable escalation policy
    const policy = this.config.escalationPolicies.find(
      p => p.severities.includes(alert.severity)
    );

    if (!policy || policy.levels.length === 0) {
      return;
    }

    // Store escalation state
    const escalationKey = `${ESCALATION_PREFIX}${alert.id}`;
    await this.redis.hset(escalationKey, {
      alertId: alert.id,
      policyId: policy.id,
      currentLevel: 0,
      startedAt: new Date().toISOString(),
    });
    await this.redis.expire(escalationKey, 24 * 60 * 60); // 24 hours

    // Set timer for first escalation level
    const firstLevel = policy.levels[0];
    const timer = setTimeout(
      () => this.escalateAlert(alert.id, policy, 1),
      firstLevel.afterMinutes * 60 * 1000
    );

    this.escalationTimers.set(alert.id, timer);
  }

  /**
   * Escalate an alert to the next level
   */
  private async escalateAlert(
    alertId: string,
    policy: EscalationPolicy,
    level: number
  ): Promise<void> {
    const alert = await this.getAlert(alertId);
    if (!alert) return;

    // Check if already acknowledged/resolved
    if ((policy.escalateOnNoAcknowledge && alert.acknowledged) ||
        (policy.escalateOnNoResolve && alert.resolved)) {
      this.cancelEscalationTimer(alertId);
      return;
    }

    // Get escalation level config
    const levelConfig = policy.levels[level - 1];
    if (!levelConfig) {
      return;
    }

    logger.info(
      { alertId, policyId: policy.id, level },
      'Escalating alert'
    );

    // Send to escalation channels
    for (const channelConfig of levelConfig.channels) {
      await this.sendToChannel(alert, channelConfig);
    }

    // Emit escalation event
    await this.emitEvent({
      type: 'escalated',
      alert,
      timestamp: new Date(),
      metadata: { policyId: policy.id, level, message: levelConfig.message },
    });

    // Update escalation state
    const escalationKey = `${ESCALATION_PREFIX}${alertId}`;
    await this.redis.hset(escalationKey, 'currentLevel', level);

    // Set timer for next level if exists
    const nextLevel = policy.levels[level];
    if (nextLevel) {
      const timer = setTimeout(
        () => this.escalateAlert(alertId, policy, level + 1),
        (nextLevel.afterMinutes - levelConfig.afterMinutes) * 60 * 1000
      );
      this.escalationTimers.set(alertId, timer);
    }
  }

  /**
   * Cancel escalation timer
   */
  private cancelEscalationTimer(alertId: string): void {
    const timer = this.escalationTimers.get(alertId);
    if (timer) {
      clearTimeout(timer);
      this.escalationTimers.delete(alertId);
    }
  }

  /**
   * Emit an alert event
   */
  private async emitEvent(event: AlertEvent): Promise<void> {
    for (const callback of this.eventCallbacks) {
      try {
        await callback(event);
      } catch (error) {
        logger.error({ error, eventType: event.type }, 'Error in alert event callback');
      }
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let serviceInstance: SecurityAlertService | null = null;

/**
 * Get or create the singleton SecurityAlertService instance
 */
export function getSecurityAlertService(
  options?: SecurityAlertServiceOptions
): SecurityAlertService {
  if (!serviceInstance) {
    serviceInstance = new SecurityAlertService(options);
  }
  return serviceInstance;
}

/**
 * Reset the singleton instance (primarily for testing)
 */
export function resetSecurityAlertService(): void {
  if (serviceInstance) {
    serviceInstance.shutdown();
    serviceInstance = null;
  }
}

/**
 * Create a new SecurityAlertService instance
 */
export function createSecurityAlertService(
  options?: SecurityAlertServiceOptions
): SecurityAlertService {
  return new SecurityAlertService(options);
}
