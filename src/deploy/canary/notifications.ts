/**
 * Vorion Security Platform - Canary Deployment Notifications
 * Handles notifications for deployment events across multiple channels
 */

import {
  NotificationConfig,
  NotificationChannel,
  NotificationEvent,
  Notification,
  SlackConfig,
  TeamsConfig,
  EmailConfig,
  PagerDutyConfig,
  WebhookConfig,
  ThrottleConfig,
  CanaryDeployment,
  CanaryStatus,
  Logger,
} from './types';

// ============================================================================
// Types
// ============================================================================

export interface NotificationManagerConfig {
  /** Notification configuration */
  config: NotificationConfig;
  /** Default timeout for HTTP requests (ms) */
  defaultTimeout?: number;
  /** Enable dry run mode (no actual notifications) */
  dryRun?: boolean;
  /** Logger instance */
  logger?: Logger;
}

export interface NotificationPayload {
  /** Event type */
  event: NotificationEvent;
  /** Deployment information */
  deployment: {
    id: string;
    name: string;
    service: string;
    namespace: string;
    status: CanaryStatus;
    stage: number;
    percentage: number;
  };
  /** Event-specific data */
  data?: Record<string, unknown>;
  /** Timestamp */
  timestamp: Date;
}

export interface NotificationResult {
  /** Channel type */
  channel: string;
  /** Whether notification was sent */
  sent: boolean;
  /** Error if failed */
  error?: string;
  /** Throttled */
  throttled?: boolean;
}

export interface DeploymentTimelineEvent {
  /** Event ID */
  id: string;
  /** Event type */
  type: NotificationEvent;
  /** Timestamp */
  timestamp: Date;
  /** Event description */
  description: string;
  /** Actor (user or system) */
  actor?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Throttle Manager
// ============================================================================

class ThrottleManager {
  private readonly config: ThrottleConfig;
  private eventCounts: Map<string, { count: number; windowStart: number }> = new Map();
  private pendingNotifications: Map<string, Notification[]> = new Map();

  constructor(config: ThrottleConfig) {
    this.config = config;
  }

  /**
   * Check if notification should be throttled
   */
  shouldThrottle(notification: Notification): boolean {
    const key = this.getThrottleKey(notification);
    const now = Date.now();
    const windowMs = this.config.interval * 1000;

    let entry = this.eventCounts.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {
      // New window
      entry = { count: 0, windowStart: now };
      this.eventCounts.set(key, entry);
    }

    if (entry.count >= this.config.maxPerInterval) {
      // Add to pending if grouping
      if (this.config.groupSimilar) {
        if (!this.pendingNotifications.has(key)) {
          this.pendingNotifications.set(key, []);
        }
        this.pendingNotifications.get(key)!.push(notification);
      }
      return true;
    }

    entry.count++;
    return false;
  }

  /**
   * Get pending notifications for a key and clear them
   */
  getPendingNotifications(key: string): Notification[] {
    const pending = this.pendingNotifications.get(key) || [];
    this.pendingNotifications.delete(key);
    return pending;
  }

  /**
   * Get throttle key for notification
   */
  private getThrottleKey(notification: Notification): string {
    if (this.config.groupSimilar) {
      return `${notification.event}_${notification.deploymentId}`;
    }
    return notification.id;
  }

  /**
   * Reset throttle state
   */
  reset(): void {
    this.eventCounts.clear();
    this.pendingNotifications.clear();
  }
}

// ============================================================================
// Channel Senders
// ============================================================================

interface ChannelSender {
  send(notification: Notification): Promise<NotificationResult>;
}

/**
 * Slack channel sender
 */
class SlackSender implements ChannelSender {
  private readonly config: SlackConfig;
  private readonly timeout: number;
  private readonly logger?: Logger;

  constructor(config: SlackConfig, timeout: number, logger?: Logger) {
    this.config = config;
    this.timeout = timeout;
    this.logger = logger;
  }

  async send(notification: Notification): Promise<NotificationResult> {
    const color = this.getColorForSeverity(notification.severity);
    const emoji = this.getEmojiForEvent(notification.event);

    const payload = {
      channel: this.config.channel,
      username: this.config.username || 'Vorion Canary',
      icon_emoji: this.config.iconEmoji || ':rocket:',
      attachments: [
        {
          color,
          title: `${emoji} ${notification.title}`,
          text: notification.message,
          fields: this.buildFields(notification),
          footer: 'Vorion Canary Deployment',
          ts: Math.floor(notification.timestamp.getTime() / 1000),
        },
      ],
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.status}`);
      }

      return { channel: 'slack', sent: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger?.error(`Slack notification failed: ${errorMessage}`);
      return { channel: 'slack', sent: false, error: errorMessage };
    }
  }

  private getColorForSeverity(severity: string): string {
    switch (severity) {
      case 'critical': return '#dc3545';
      case 'error': return '#fd7e14';
      case 'warning': return '#ffc107';
      case 'info': return '#17a2b8';
      default: return '#6c757d';
    }
  }

  private getEmojiForEvent(event: NotificationEvent): string {
    switch (event) {
      case 'deployment_started': return ':rocket:';
      case 'stage_promoted': return ':arrow_up:';
      case 'stage_failed': return ':warning:';
      case 'deployment_succeeded': return ':white_check_mark:';
      case 'deployment_failed': return ':x:';
      case 'rollback_initiated': return ':rewind:';
      case 'rollback_completed': return ':leftwards_arrow_with_hook:';
      case 'paused': return ':pause_button:';
      case 'resumed': return ':arrow_forward:';
      case 'anomaly_detected': return ':mag:';
      case 'threshold_exceeded': return ':chart_with_upwards_trend:';
      default: return ':information_source:';
    }
  }

  private buildFields(notification: Notification): Array<{ title: string; value: string; short: boolean }> {
    const fields: Array<{ title: string; value: string; short: boolean }> = [];
    const data = notification.data || {};

    if (data.stage !== undefined) {
      fields.push({ title: 'Stage', value: String(data.stage), short: true });
    }
    if (data.percentage !== undefined) {
      fields.push({ title: 'Traffic', value: `${data.percentage}%`, short: true });
    }
    if (data.healthScore !== undefined) {
      fields.push({ title: 'Health Score', value: String(data.healthScore), short: true });
    }
    if (data.errorRate !== undefined) {
      fields.push({ title: 'Error Rate', value: `${(data.errorRate as number).toFixed(2)}%`, short: true });
    }

    return fields;
  }
}

/**
 * Microsoft Teams channel sender
 */
class TeamsSender implements ChannelSender {
  private readonly config: TeamsConfig;
  private readonly timeout: number;
  private readonly logger?: Logger;

  constructor(config: TeamsConfig, timeout: number, logger?: Logger) {
    this.config = config;
    this.timeout = timeout;
    this.logger = logger;
  }

  async send(notification: Notification): Promise<NotificationResult> {
    const themeColor = this.getColorForSeverity(notification.severity);

    const payload = {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor,
      summary: notification.title,
      sections: [
        {
          activityTitle: notification.title,
          activitySubtitle: `Deployment: ${notification.deploymentId}`,
          facts: this.buildFacts(notification),
          text: notification.message,
        },
      ],
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Teams API error: ${response.status}`);
      }

      return { channel: 'teams', sent: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger?.error(`Teams notification failed: ${errorMessage}`);
      return { channel: 'teams', sent: false, error: errorMessage };
    }
  }

  private getColorForSeverity(severity: string): string {
    switch (severity) {
      case 'critical': return 'dc3545';
      case 'error': return 'fd7e14';
      case 'warning': return 'ffc107';
      case 'info': return '17a2b8';
      default: return '6c757d';
    }
  }

  private buildFacts(notification: Notification): Array<{ name: string; value: string }> {
    const facts: Array<{ name: string; value: string }> = [];
    const data = notification.data || {};

    facts.push({ name: 'Event', value: notification.event });
    facts.push({ name: 'Severity', value: notification.severity });

    if (data.stage !== undefined) {
      facts.push({ name: 'Stage', value: String(data.stage) });
    }
    if (data.percentage !== undefined) {
      facts.push({ name: 'Traffic', value: `${data.percentage}%` });
    }

    return facts;
  }
}

/**
 * Email channel sender
 */
class EmailSender implements ChannelSender {
  private readonly config: EmailConfig;
  private readonly timeout: number;
  private readonly logger?: Logger;

  constructor(config: EmailConfig, timeout: number, logger?: Logger) {
    this.config = config;
    this.timeout = timeout;
    this.logger = logger;
  }

  async send(notification: Notification): Promise<NotificationResult> {
    // In production, use nodemailer or similar
    // For now, simulate email sending

    const emailContent = this.buildEmailContent(notification);

    this.logger?.info(`Sending email notification to ${this.config.to.join(', ')}`);
    this.logger?.debug(`Email content: ${emailContent.subject}`);

    // Simulate sending
    await new Promise(resolve => setTimeout(resolve, 100));

    return { channel: 'email', sent: true };
  }

  private buildEmailContent(notification: Notification): { subject: string; html: string; text: string } {
    const subject = `[Vorion Canary] ${notification.title}`;

    const html = `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: ${this.getColorForSeverity(notification.severity)}; color: white; padding: 20px;">
            <h1 style="margin: 0;">${notification.title}</h1>
          </div>
          <div style="padding: 20px;">
            <p>${notification.message}</p>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Deployment ID:</strong></td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${notification.deploymentId}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Event:</strong></td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${notification.event}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Severity:</strong></td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${notification.severity}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Time:</strong></td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${notification.timestamp.toISOString()}</td>
              </tr>
            </table>
          </div>
          <div style="background-color: #f5f5f5; padding: 10px; text-align: center; font-size: 12px;">
            Vorion Security Platform - Canary Deployment System
          </div>
        </body>
      </html>
    `;

    const text = `
${notification.title}

${notification.message}

Deployment ID: ${notification.deploymentId}
Event: ${notification.event}
Severity: ${notification.severity}
Time: ${notification.timestamp.toISOString()}

---
Vorion Security Platform - Canary Deployment System
    `.trim();

    return { subject, html, text };
  }

  private getColorForSeverity(severity: string): string {
    switch (severity) {
      case 'critical': return '#dc3545';
      case 'error': return '#fd7e14';
      case 'warning': return '#ffc107';
      case 'info': return '#17a2b8';
      default: return '#6c757d';
    }
  }
}

/**
 * PagerDuty channel sender
 */
class PagerDutySender implements ChannelSender {
  private readonly config: PagerDutyConfig;
  private readonly timeout: number;
  private readonly logger?: Logger;

  constructor(config: PagerDutyConfig, timeout: number, logger?: Logger) {
    this.config = config;
    this.timeout = timeout;
    this.logger = logger;
  }

  async send(notification: Notification): Promise<NotificationResult> {
    const severity = this.mapSeverity(notification.severity);

    const payload = {
      routing_key: this.config.routingKey,
      event_action: notification.severity === 'info' ? 'resolve' : 'trigger',
      dedup_key: `vorion-canary-${notification.deploymentId}-${notification.event}`,
      payload: {
        summary: notification.title,
        source: 'vorion-canary',
        severity,
        timestamp: notification.timestamp.toISOString(),
        custom_details: {
          deployment_id: notification.deploymentId,
          event: notification.event,
          message: notification.message,
          ...notification.data,
        },
      },
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`PagerDuty API error: ${response.status}`);
      }

      return { channel: 'pagerduty', sent: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger?.error(`PagerDuty notification failed: ${errorMessage}`);
      return { channel: 'pagerduty', sent: false, error: errorMessage };
    }
  }

  private mapSeverity(severity: string): 'critical' | 'error' | 'warning' | 'info' {
    switch (severity) {
      case 'critical': return 'critical';
      case 'error': return 'error';
      case 'warning': return 'warning';
      default: return 'info';
    }
  }
}

/**
 * Generic webhook sender
 */
class WebhookSender implements ChannelSender {
  private readonly config: WebhookConfig;
  private readonly timeout: number;
  private readonly logger?: Logger;

  constructor(config: WebhookConfig, timeout: number, logger?: Logger) {
    this.config = config;
    this.timeout = timeout;
    this.logger = logger;
  }

  async send(notification: Notification): Promise<NotificationResult> {
    const payload = {
      id: notification.id,
      event: notification.event,
      deploymentId: notification.deploymentId,
      timestamp: notification.timestamp.toISOString(),
      title: notification.title,
      message: notification.message,
      severity: notification.severity,
      data: notification.data,
    };

    try {
      const controller = new AbortController();
      const actualTimeout = this.config.timeout || this.timeout;
      const timeoutId = setTimeout(() => controller.abort(), actualTimeout);

      const response = await fetch(this.config.url, {
        method: this.config.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Webhook error: ${response.status}`);
      }

      return { channel: 'webhook', sent: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger?.error(`Webhook notification failed: ${errorMessage}`);
      return { channel: 'webhook', sent: false, error: errorMessage };
    }
  }
}

// ============================================================================
// Notification Manager Class
// ============================================================================

export class NotificationManager {
  private readonly config: NotificationConfig;
  private readonly defaultTimeout: number;
  private readonly dryRun: boolean;
  private readonly logger?: Logger;
  private readonly throttleManager?: ThrottleManager;
  private readonly senders: Map<NotificationChannel, ChannelSender> = new Map();
  private readonly timeline: Map<string, DeploymentTimelineEvent[]> = new Map();

  constructor(managerConfig: NotificationManagerConfig) {
    this.config = managerConfig.config;
    this.defaultTimeout = managerConfig.defaultTimeout ?? 10000;
    this.dryRun = managerConfig.dryRun ?? false;
    this.logger = managerConfig.logger;

    if (this.config.throttle) {
      this.throttleManager = new ThrottleManager(this.config.throttle);
    }

    // Initialize senders
    this.initializeSenders();
  }

  /**
   * Initialize channel senders
   */
  private initializeSenders(): void {
    for (const channel of this.config.channels) {
      const sender = this.createSender(channel);
      if (sender) {
        this.senders.set(channel, sender);
      }
    }
  }

  /**
   * Create sender for channel
   */
  private createSender(channel: NotificationChannel): ChannelSender | null {
    switch (channel.type) {
      case 'slack':
        return new SlackSender(channel.config as SlackConfig, this.defaultTimeout, this.logger);
      case 'teams':
        return new TeamsSender(channel.config as TeamsConfig, this.defaultTimeout, this.logger);
      case 'email':
        return new EmailSender(channel.config as EmailConfig, this.defaultTimeout, this.logger);
      case 'pagerduty':
        return new PagerDutySender(channel.config as PagerDutyConfig, this.defaultTimeout, this.logger);
      case 'webhook':
        return new WebhookSender(channel.config as WebhookConfig, this.defaultTimeout, this.logger);
      default:
        this.logger?.warn(`Unknown channel type: ${channel.type}`);
        return null;
    }
  }

  /**
   * Send notification for deployment event
   */
  async notify(payload: NotificationPayload): Promise<NotificationResult[]> {
    const notification = this.createNotification(payload);

    // Add to timeline
    this.addTimelineEvent(payload.deployment.id, {
      id: notification.id,
      type: payload.event,
      timestamp: payload.timestamp,
      description: notification.message,
      metadata: payload.data,
    });

    // Check throttle
    if (this.throttleManager?.shouldThrottle(notification)) {
      this.logger?.debug(`Notification throttled: ${notification.event}`);
      return [{ channel: 'all', sent: false, throttled: true }];
    }

    // Dry run mode
    if (this.dryRun) {
      this.logger?.info(`[DRY RUN] Would send notification: ${notification.title}`);
      return [{ channel: 'all', sent: true }];
    }

    // Send to all applicable channels
    const results: NotificationResult[] = [];
    const applicableChannels = this.getApplicableChannels(payload.event);

    const sendPromises = applicableChannels.map(async (channel) => {
      const sender = this.senders.get(channel);
      if (sender) {
        return sender.send(notification);
      }
      return { channel: channel.type, sent: false, error: 'No sender configured' };
    });

    const channelResults = await Promise.all(sendPromises);
    results.push(...channelResults);

    // Log results
    const successCount = results.filter(r => r.sent).length;
    this.logger?.info(`Notification sent to ${successCount}/${results.length} channels`);

    return results;
  }

  /**
   * Send deployment started notification
   */
  async notifyDeploymentStarted(deployment: CanaryDeployment): Promise<NotificationResult[]> {
    return this.notify({
      event: 'deployment_started',
      deployment: this.extractDeploymentInfo(deployment),
      timestamp: new Date(),
      data: {
        targetVersion: deployment.config.canaryVersion,
        baselineVersion: deployment.config.baselineVersion,
        stages: deployment.config.stages.length,
      },
    });
  }

  /**
   * Send stage promoted notification
   */
  async notifyStagePromoted(
    deployment: CanaryDeployment,
    fromStage: number,
    toStage: number,
    healthScore?: number
  ): Promise<NotificationResult[]> {
    return this.notify({
      event: 'stage_promoted',
      deployment: this.extractDeploymentInfo(deployment),
      timestamp: new Date(),
      data: {
        fromStage,
        toStage,
        fromPercentage: deployment.config.stages[fromStage]?.percentage || 0,
        toPercentage: deployment.config.stages[toStage]?.percentage || 0,
        healthScore,
      },
    });
  }

  /**
   * Send stage failed notification
   */
  async notifyStageFailed(
    deployment: CanaryDeployment,
    stage: number,
    reason: string
  ): Promise<NotificationResult[]> {
    return this.notify({
      event: 'stage_failed',
      deployment: this.extractDeploymentInfo(deployment),
      timestamp: new Date(),
      data: {
        stage,
        percentage: deployment.config.stages[stage]?.percentage || 0,
        reason,
      },
    });
  }

  /**
   * Send deployment succeeded notification
   */
  async notifyDeploymentSucceeded(deployment: CanaryDeployment): Promise<NotificationResult[]> {
    return this.notify({
      event: 'deployment_succeeded',
      deployment: this.extractDeploymentInfo(deployment),
      timestamp: new Date(),
      data: {
        duration: this.calculateDuration(deployment),
        totalStages: deployment.config.stages.length,
      },
    });
  }

  /**
   * Send deployment failed notification
   */
  async notifyDeploymentFailed(deployment: CanaryDeployment, error: string): Promise<NotificationResult[]> {
    return this.notify({
      event: 'deployment_failed',
      deployment: this.extractDeploymentInfo(deployment),
      timestamp: new Date(),
      data: {
        error,
        stage: deployment.currentStage,
        percentage: deployment.currentPercentage,
      },
    });
  }

  /**
   * Send rollback notification
   */
  async notifyRollback(
    deployment: CanaryDeployment,
    reason: string,
    automatic: boolean
  ): Promise<NotificationResult[]> {
    return this.notify({
      event: 'rollback_initiated',
      deployment: this.extractDeploymentInfo(deployment),
      timestamp: new Date(),
      data: {
        reason,
        automatic,
        fromStage: deployment.currentStage,
        fromPercentage: deployment.currentPercentage,
      },
    });
  }

  /**
   * Send anomaly detected notification
   */
  async notifyAnomalyDetected(
    deployment: CanaryDeployment,
    anomalyType: string,
    severity: string,
    description: string
  ): Promise<NotificationResult[]> {
    return this.notify({
      event: 'anomaly_detected',
      deployment: this.extractDeploymentInfo(deployment),
      timestamp: new Date(),
      data: {
        anomalyType,
        severity,
        description,
      },
    });
  }

  /**
   * Get timeline for deployment
   */
  getTimeline(deploymentId: string): DeploymentTimelineEvent[] {
    return this.timeline.get(deploymentId) || [];
  }

  /**
   * Clear timeline for deployment
   */
  clearTimeline(deploymentId: string): void {
    this.timeline.delete(deploymentId);
  }

  /**
   * Get all timelines
   */
  getAllTimelines(): Map<string, DeploymentTimelineEvent[]> {
    return new Map(this.timeline);
  }

  /**
   * Reset throttle state
   */
  resetThrottle(): void {
    this.throttleManager?.reset();
  }

  /**
   * Create notification object
   */
  private createNotification(payload: NotificationPayload): Notification {
    return {
      id: this.generateId(),
      event: payload.event,
      deploymentId: payload.deployment.id,
      timestamp: payload.timestamp,
      title: this.getTitle(payload),
      message: this.getMessage(payload),
      severity: this.getSeverity(payload.event),
      data: payload.data,
    };
  }

  /**
   * Get applicable channels for event
   */
  private getApplicableChannels(event: NotificationEvent): NotificationChannel[] {
    if (!this.config.events.includes(event)) {
      return [];
    }

    return this.config.channels.filter(channel => {
      if (channel.events && channel.events.length > 0) {
        return channel.events.includes(event);
      }
      return true;
    });
  }

  /**
   * Extract deployment info for notification
   */
  private extractDeploymentInfo(deployment: CanaryDeployment): NotificationPayload['deployment'] {
    return {
      id: deployment.id,
      name: deployment.config.name,
      service: deployment.config.targetService,
      namespace: deployment.config.namespace,
      status: deployment.status,
      stage: deployment.currentStage,
      percentage: deployment.currentPercentage,
    };
  }

  /**
   * Get notification title
   */
  private getTitle(payload: NotificationPayload): string {
    const { event, deployment } = payload;

    switch (event) {
      case 'deployment_started':
        return `Canary deployment started: ${deployment.name}`;
      case 'stage_promoted':
        return `Stage promoted: ${deployment.name} (${payload.data?.toPercentage}%)`;
      case 'stage_failed':
        return `Stage failed: ${deployment.name}`;
      case 'deployment_succeeded':
        return `Deployment succeeded: ${deployment.name}`;
      case 'deployment_failed':
        return `Deployment failed: ${deployment.name}`;
      case 'rollback_initiated':
        return `Rollback initiated: ${deployment.name}`;
      case 'rollback_completed':
        return `Rollback completed: ${deployment.name}`;
      case 'paused':
        return `Deployment paused: ${deployment.name}`;
      case 'resumed':
        return `Deployment resumed: ${deployment.name}`;
      case 'anomaly_detected':
        return `Anomaly detected: ${deployment.name}`;
      case 'threshold_exceeded':
        return `Threshold exceeded: ${deployment.name}`;
      default:
        return `Deployment event: ${deployment.name}`;
    }
  }

  /**
   * Get notification message
   */
  private getMessage(payload: NotificationPayload): string {
    const { event, deployment, data } = payload;

    switch (event) {
      case 'deployment_started':
        return `Starting canary deployment for ${deployment.service} in ${deployment.namespace}. Target: ${data?.targetVersion || 'unknown'}`;
      case 'stage_promoted':
        return `Promoted from stage ${data?.fromStage} (${data?.fromPercentage}%) to stage ${data?.toStage} (${data?.toPercentage}%)`;
      case 'stage_failed':
        return `Stage ${data?.stage} failed at ${data?.percentage}% traffic. Reason: ${data?.reason}`;
      case 'deployment_succeeded':
        return `Canary deployment completed successfully after ${data?.duration || 'unknown'} seconds`;
      case 'deployment_failed':
        return `Deployment failed at stage ${data?.stage} (${data?.percentage}%). Error: ${data?.error}`;
      case 'rollback_initiated':
        return `${data?.automatic ? 'Automatic' : 'Manual'} rollback initiated. Reason: ${data?.reason}`;
      case 'rollback_completed':
        return `Rollback completed. Traffic restored to baseline.`;
      case 'paused':
        return `Deployment paused at stage ${deployment.stage} (${deployment.percentage}%)`;
      case 'resumed':
        return `Deployment resumed from stage ${deployment.stage}`;
      case 'anomaly_detected':
        return `${data?.severity} severity anomaly detected: ${data?.description}`;
      case 'threshold_exceeded':
        return `Metric threshold exceeded: ${data?.metric} is ${data?.value} (threshold: ${data?.threshold})`;
      default:
        return `Event ${event} occurred for deployment ${deployment.name}`;
    }
  }

  /**
   * Get severity for event
   */
  private getSeverity(event: NotificationEvent): 'info' | 'warning' | 'error' | 'critical' {
    switch (event) {
      case 'deployment_started':
      case 'stage_promoted':
      case 'deployment_succeeded':
      case 'paused':
      case 'resumed':
        return 'info';
      case 'stage_failed':
      case 'threshold_exceeded':
      case 'anomaly_detected':
        return 'warning';
      case 'deployment_failed':
      case 'rollback_initiated':
        return 'error';
      case 'rollback_completed':
        return 'info';
      default:
        return 'info';
    }
  }

  /**
   * Calculate deployment duration
   */
  private calculateDuration(deployment: CanaryDeployment): number {
    return Math.floor((Date.now() - deployment.startTime.getTime()) / 1000);
  }

  /**
   * Add event to timeline
   */
  private addTimelineEvent(deploymentId: string, event: DeploymentTimelineEvent): void {
    if (!this.timeline.has(deploymentId)) {
      this.timeline.set(deploymentId, []);
    }
    this.timeline.get(deploymentId)!.push(event);
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new notification manager
 */
export function createNotificationManager(config: NotificationManagerConfig): NotificationManager {
  return new NotificationManager(config);
}

/**
 * Create default notification config
 */
export function createDefaultNotificationConfig(overrides?: Partial<NotificationConfig>): NotificationConfig {
  return {
    channels: [],
    events: [
      'deployment_started',
      'stage_promoted',
      'stage_failed',
      'deployment_succeeded',
      'deployment_failed',
      'rollback_initiated',
      'rollback_completed',
    ],
    throttle: {
      interval: 60,
      maxPerInterval: 10,
      groupSimilar: true,
    },
    ...overrides,
  };
}

/**
 * Create Slack channel configuration
 */
export function createSlackChannel(webhookUrl: string, options?: Partial<SlackConfig>): NotificationChannel {
  return {
    type: 'slack',
    config: {
      webhookUrl,
      channel: options?.channel,
      username: options?.username || 'Vorion Canary',
      iconEmoji: options?.iconEmoji || ':rocket:',
    },
  };
}

/**
 * Create PagerDuty channel configuration
 */
export function createPagerDutyChannel(
  routingKey: string,
  events?: NotificationEvent[]
): NotificationChannel {
  return {
    type: 'pagerduty',
    config: {
      routingKey,
      severity: 'critical',
    },
    events: events || ['deployment_failed', 'rollback_initiated'],
  };
}

/**
 * Create email channel configuration
 */
export function createEmailChannel(
  smtpConfig: Omit<EmailConfig, 'useTls'>,
  events?: NotificationEvent[]
): NotificationChannel {
  return {
    type: 'email',
    config: {
      ...smtpConfig,
      useTls: true,
    },
    events,
  };
}
