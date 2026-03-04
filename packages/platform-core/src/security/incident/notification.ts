/**
 * Incident Response System - Notification Service
 *
 * Handles sending notifications across multiple channels
 * including Slack, email, PagerDuty, and custom webhooks.
 */

import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import {
  NotificationChannel,
  NotificationConfig,
  NotificationPayload,
  NotificationResult,
  IncidentSeverity,
  Incident,
  EscalationLevel,
} from './types.js';

const logger = createLogger({ component: 'incident-response' });

// ============================================================================
// Notification Templates
// ============================================================================

const defaultTemplates = {
  slack: {
    incident_created: (payload: NotificationPayload) => ({
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `🚨 ${getSeverityEmoji(payload.severity)} New Incident: ${payload.title}`,
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Severity:*\n${payload.severity}` },
            { type: 'mrkdwn', text: `*Status:*\n${payload.status}` },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Description:*\n${payload.message}`,
          },
        },
        ...(payload.url ? [{
          type: 'actions',
          elements: [{
            type: 'button',
            text: { type: 'plain_text', text: 'View Incident', emoji: true },
            url: payload.url,
            style: 'primary',
          }],
        }] : []),
      ],
    }),
    escalation: (payload: NotificationPayload & { level: number }) => ({
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `⬆️ Escalation Level ${payload.level}: ${payload.title}`,
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `This incident has been escalated. Immediate attention required.`,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Severity:*\n${payload.severity}` },
            { type: 'mrkdwn', text: `*Status:*\n${payload.status}` },
          ],
        },
      ],
    }),
  },
  email: {
    incident_created: (payload: NotificationPayload) => ({
      subject: `[${payload.severity}] Incident: ${payload.title}`,
      html: `
        <h1>New Security Incident</h1>
        <table style="border-collapse: collapse; width: 100%;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>ID</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${payload.incidentId}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Severity</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd; background-color: ${getSeverityColor(payload.severity)}; color: white;">${payload.severity}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Status</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${payload.status}</td>
          </tr>
        </table>
        <h2>Description</h2>
        <p>${payload.message}</p>
        ${payload.url ? `<p><a href="${payload.url}">View Incident Details</a></p>` : ''}
      `,
      text: `
New Security Incident
=====================
ID: ${payload.incidentId}
Title: ${payload.title}
Severity: ${payload.severity}
Status: ${payload.status}

Description:
${payload.message}

${payload.url ? `View details: ${payload.url}` : ''}
      `.trim(),
    }),
  },
  pagerduty: {
    incident_created: (payload: NotificationPayload) => ({
      routing_key: '', // Will be set from config
      event_action: 'trigger',
      dedup_key: payload.incidentId,
      payload: {
        summary: `[${payload.severity}] ${payload.title}`,
        source: 'vorion-incident-response',
        severity: mapSeverityToPagerDuty(payload.severity),
        timestamp: new Date().toISOString(),
        custom_details: {
          incident_id: payload.incidentId,
          description: payload.message,
          status: payload.status,
          ...payload.additionalData,
        },
      },
      links: payload.url ? [{ href: payload.url, text: 'View Incident' }] : [],
    }),
    resolve: (payload: NotificationPayload) => ({
      routing_key: '',
      event_action: 'resolve',
      dedup_key: payload.incidentId,
    }),
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

function getSeverityEmoji(severity: IncidentSeverity): string {
  const emojis: Record<IncidentSeverity, string> = {
    P1: '🔴',
    P2: '🟠',
    P3: '🟡',
    P4: '🟢',
  };
  return emojis[severity];
}

function getSeverityColor(severity: IncidentSeverity): string {
  const colors: Record<IncidentSeverity, string> = {
    P1: '#dc3545',
    P2: '#fd7e14',
    P3: '#ffc107',
    P4: '#28a745',
  };
  return colors[severity];
}

function mapSeverityToPagerDuty(severity: IncidentSeverity): string {
  const mapping: Record<IncidentSeverity, string> = {
    P1: 'critical',
    P2: 'error',
    P3: 'warning',
    P4: 'info',
  };
  return mapping[severity];
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Notification Service Class
// ============================================================================

export interface NotificationServiceConfig {
  slack?: {
    webhookUrl: string;
    defaultChannel?: string;
  };
  email?: {
    host: string;
    port: number;
    secure: boolean;
    auth?: {
      user: string;
      pass: string;
    };
    from: string;
  };
  pagerduty?: {
    routingKey: string;
    apiUrl?: string;
  };
  baseUrl?: string; // Base URL for incident links
}

export class NotificationService {
  private config: NotificationServiceConfig;
  private rateLimiter: Map<string, number> = new Map();
  private readonly rateLimitWindow = 60000; // 1 minute
  private readonly maxNotificationsPerWindow = 100;

  constructor(config: NotificationServiceConfig = {}) {
    this.config = config;
    logger.info('NotificationService initialized', {
      channels: {
        slack: !!config.slack,
        email: !!config.email,
        pagerduty: !!config.pagerduty,
      },
    });
  }

  /**
   * Send notification to a specific channel
   */
  async send(
    channel: NotificationChannel,
    target: string,
    payload: NotificationPayload,
    config: Partial<NotificationConfig> = {}
  ): Promise<NotificationResult> {
    const startTime = Date.now();
    const result: NotificationResult = {
      channel,
      target,
      success: false,
      sentAt: new Date(),
      retryCount: 0,
    };

    // Check rate limit
    if (!this.checkRateLimit(channel, target)) {
      result.error = 'Rate limit exceeded';
      logger.warn('Notification rate limit exceeded', { channel, target });
      return result;
    }

    const maxRetries = config.retryAttempts ?? 3;
    const retryDelay = config.retryDelayMs ?? 5000;

    while (result.retryCount <= maxRetries) {
      try {
        switch (channel) {
          case NotificationChannel.SLACK:
            result.messageId = await this.sendSlack(target, payload);
            break;
          case NotificationChannel.EMAIL:
            result.messageId = await this.sendEmail(target, payload);
            break;
          case NotificationChannel.PAGERDUTY:
            result.messageId = await this.sendPagerDuty(payload);
            break;
          case NotificationChannel.WEBHOOK:
            result.messageId = await this.sendWebhook(target, payload);
            break;
          case NotificationChannel.SMS:
            result.messageId = await this.sendSMS(target, payload);
            break;
          default:
            throw new Error(`Unsupported notification channel: ${channel}`);
        }

        result.success = true;
        logger.info('Notification sent successfully', {
          channel,
          target,
          incidentId: payload.incidentId,
          duration: Date.now() - startTime,
        });
        break;
      } catch (error) {
        result.retryCount++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.error = errorMessage;

        logger.warn('Notification failed', {
          channel,
          target,
          error: errorMessage,
          retryCount: result.retryCount,
          maxRetries,
        });

        if (result.retryCount <= maxRetries) {
          await sleep(retryDelay * result.retryCount);
        }
      }
    }

    return result;
  }

  /**
   * Send notifications based on configuration list
   */
  async sendMultiple(
    configs: NotificationConfig[],
    payload: NotificationPayload
  ): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];

    for (const config of configs) {
      if (!config.enabled) continue;

      // Check severity filter
      if (config.severityFilter && !config.severityFilter.includes(payload.severity)) {
        continue;
      }

      const result = await this.send(config.channel, config.target, payload, config);
      results.push(result);
    }

    return results;
  }

  /**
   * Send escalation notification
   */
  async sendEscalation(
    incident: Incident,
    level: EscalationLevel
  ): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];
    const payload: NotificationPayload & { level: number } = {
      incidentId: incident.id,
      title: incident.title,
      message: level.message || `Incident escalated to level ${level.level}`,
      severity: incident.severity,
      status: incident.status,
      url: this.config.baseUrl ? `${this.config.baseUrl}/incidents/${incident.id}` : undefined,
      level: level.level,
    };

    for (const target of level.targets) {
      for (const channel of level.channels) {
        const result = await this.send(channel, target, payload);
        results.push(result);
      }
    }

    logger.info('Escalation notifications sent', {
      incidentId: incident.id,
      level: level.level,
      targets: level.targets,
      successCount: results.filter(r => r.success).length,
      failureCount: results.filter(r => !r.success).length,
    });

    return results;
  }

  /**
   * Send incident created notification
   */
  async notifyIncidentCreated(
    incident: Incident,
    configs: NotificationConfig[]
  ): Promise<NotificationResult[]> {
    const payload: NotificationPayload = {
      incidentId: incident.id,
      title: incident.title,
      message: incident.description,
      severity: incident.severity,
      status: incident.status,
      url: this.config.baseUrl ? `${this.config.baseUrl}/incidents/${incident.id}` : undefined,
      additionalData: {
        type: incident.type,
        affectedResources: incident.affectedResources,
        detectedAt: incident.detectedAt.toISOString(),
      },
    };

    return this.sendMultiple(configs, payload);
  }

  /**
   * Send incident resolved notification
   */
  async notifyIncidentResolved(
    incident: Incident,
    configs: NotificationConfig[]
  ): Promise<NotificationResult[]> {
    const payload: NotificationPayload = {
      incidentId: incident.id,
      title: `[RESOLVED] ${incident.title}`,
      message: `Incident has been resolved. Duration: ${this.formatDuration(incident.detectedAt, incident.resolvedAt || new Date())}`,
      severity: incident.severity,
      status: incident.status,
      url: this.config.baseUrl ? `${this.config.baseUrl}/incidents/${incident.id}` : undefined,
    };

    // Also resolve PagerDuty incident if configured
    if (this.config.pagerduty) {
      try {
        await this.sendPagerDuty(payload, 'resolve');
      } catch (error) {
        logger.error('Failed to resolve PagerDuty incident', { error, incidentId: incident.id });
      }
    }

    return this.sendMultiple(configs, payload);
  }

  // ============================================================================
  // Channel-specific implementations
  // ============================================================================

  private async sendSlack(target: string, payload: NotificationPayload): Promise<string> {
    if (!this.config.slack) {
      throw new Error('Slack configuration not provided');
    }

    const webhookUrl = target.startsWith('http') ? target : this.config.slack.webhookUrl;
    const body = defaultTemplates.slack.incident_created(payload);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
    }

    return `slack-${Date.now()}`;
  }

  private async sendEmail(target: string, payload: NotificationPayload): Promise<string> {
    if (!this.config.email) {
      throw new Error('Email configuration not provided');
    }

    const template = defaultTemplates.email.incident_created(payload);

    // In a real implementation, use nodemailer or similar
    // This is a placeholder that demonstrates the interface
    logger.info('Sending email notification', {
      to: target,
      subject: template.subject,
      from: this.config.email.from,
    });

    // Simulate email sending
    // In production, replace with actual SMTP implementation:
    // const transporter = nodemailer.createTransport(this.config.email);
    // const info = await transporter.sendMail({
    //   from: this.config.email.from,
    //   to: target,
    //   subject: template.subject,
    //   text: template.text,
    //   html: template.html,
    // });
    // return info.messageId;

    return `email-${Date.now()}`;
  }

  private async sendPagerDuty(
    payload: NotificationPayload,
    action: 'trigger' | 'resolve' = 'trigger'
  ): Promise<string> {
    if (!this.config.pagerduty) {
      throw new Error('PagerDuty configuration not provided');
    }

    const apiUrl = this.config.pagerduty.apiUrl || 'https://events.pagerduty.com/v2/enqueue';

    let body: Record<string, unknown>;
    if (action === 'resolve') {
      body = {
        ...defaultTemplates.pagerduty.resolve(payload),
        routing_key: this.config.pagerduty.routingKey,
      };
    } else {
      body = {
        ...defaultTemplates.pagerduty.incident_created(payload),
        routing_key: this.config.pagerduty.routingKey,
      };
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PagerDuty API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as { dedup_key?: string };
    return result.dedup_key || `pagerduty-${Date.now()}`;
  }

  private async sendWebhook(url: string, payload: NotificationPayload): Promise<string> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Incident-ID': payload.incidentId,
        'X-Severity': payload.severity,
      },
      body: JSON.stringify({
        event: 'incident_notification',
        timestamp: new Date().toISOString(),
        ...payload,
      }),
    });

    if (!response.ok) {
      throw new Error(`Webhook error: ${response.status} ${response.statusText}`);
    }

    return `webhook-${Date.now()}`;
  }

  private async sendSMS(target: string, payload: NotificationPayload): Promise<string> {
    // Placeholder for SMS implementation (e.g., Twilio)
    logger.info('SMS notification requested', {
      to: target,
      message: `[${payload.severity}] ${payload.title}`,
    });

    // In production, implement with Twilio or similar:
    // const client = twilio(accountSid, authToken);
    // const message = await client.messages.create({
    //   body: `[${payload.severity}] ${payload.title}: ${payload.message}`,
    //   to: target,
    //   from: this.config.sms.from,
    // });
    // return message.sid;

    return `sms-${Date.now()}`;
  }

  // ============================================================================
  // Rate Limiting
  // ============================================================================

  private checkRateLimit(channel: NotificationChannel, target: string): boolean {
    const key = `${channel}:${target}`;
    const now = Date.now();
    const count = this.rateLimiter.get(key) || 0;

    // Clean up old entries
    if (count > 0) {
      const lastWindow = Math.floor(now / this.rateLimitWindow);
      const storedWindow = Math.floor(count / this.maxNotificationsPerWindow);

      if (lastWindow !== storedWindow) {
        this.rateLimiter.set(key, 1);
        return true;
      }
    }

    if (count >= this.maxNotificationsPerWindow) {
      return false;
    }

    this.rateLimiter.set(key, count + 1);
    return true;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private formatDuration(start: Date, end: Date): string {
    const durationMs = end.getTime() - start.getTime();
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Test notification configuration
   */
  async testConfiguration(channel: NotificationChannel, target: string): Promise<boolean> {
    const testPayload: NotificationPayload = {
      incidentId: 'test-' + Date.now(),
      title: 'Test Notification',
      message: 'This is a test notification from the Incident Response System.',
      severity: 'P4',
      status: 'detected',
    };

    try {
      const result = await this.send(channel, target, testPayload, { retryAttempts: 0 });
      return result.success;
    } catch (error) {
      logger.error('Notification configuration test failed', { channel, target, error });
      return false;
    }
  }
}

export const createNotificationService = (config: NotificationServiceConfig = {}): NotificationService => {
  return new NotificationService(config);
};
