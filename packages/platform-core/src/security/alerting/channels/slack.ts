/**
 * Slack Alert Channel
 *
 * Sends security alerts to Slack via webhooks.
 * Supports rich message formatting with attachments.
 *
 * @packageDocumentation
 * @module security/alerting/channels/slack
 */

import { createLogger } from '../../../common/logger.js';
import {
  type SecurityAlert,
  AlertChannel,
  AlertSeverity,
} from '../types.js';
import { HttpAlertChannel, type HttpChannelConfig } from './http-base.js';
import type { SendInternalResult } from './base.js';

const logger = createLogger({ component: 'slack-alert-channel' });

// =============================================================================
// Types
// =============================================================================

export interface SlackChannelConfig extends HttpChannelConfig {
  /** Slack webhook URL */
  webhookUrl: string;
  /** Default channel to post to (can be overridden by webhook) */
  defaultChannel?: string;
  /** Bot username */
  username?: string;
  /** Bot icon emoji */
  iconEmoji?: string;
  /** Include full context in message */
  includeFullContext?: boolean;
}

interface SlackAttachment {
  color: string;
  title: string;
  title_link?: string;
  text: string;
  fields: Array<{
    title: string;
    value: string;
    short: boolean;
  }>;
  footer: string;
  ts: number;
}

interface SlackMessage {
  channel?: string;
  username?: string;
  icon_emoji?: string;
  text: string;
  attachments: SlackAttachment[];
}

// =============================================================================
// Constants
// =============================================================================

const SEVERITY_COLORS: Record<AlertSeverity, string> = {
  [AlertSeverity.CRITICAL]: '#FF0000', // Red
  [AlertSeverity.HIGH]: '#FF6600',     // Orange
  [AlertSeverity.MEDIUM]: '#FFCC00',   // Yellow
  [AlertSeverity.LOW]: '#00CC00',      // Green
  [AlertSeverity.INFO]: '#0066FF',     // Blue
};

const SEVERITY_EMOJIS: Record<AlertSeverity, string> = {
  [AlertSeverity.CRITICAL]: ':rotating_light:',
  [AlertSeverity.HIGH]: ':warning:',
  [AlertSeverity.MEDIUM]: ':large_yellow_circle:',
  [AlertSeverity.LOW]: ':information_source:',
  [AlertSeverity.INFO]: ':memo:',
};

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_RETRIES = 3;

// =============================================================================
// SlackAlertChannel Class
// =============================================================================

/**
 * Slack webhook integration for security alerts
 */
export class SlackAlertChannel extends HttpAlertChannel {
  protected readonly channelType = AlertChannel.SLACK;
  protected readonly channelName = 'Slack';
  protected override readonly logger = logger;

  private readonly webhookUrl: string;
  private readonly defaultChannel: string;
  private readonly username: string;
  private readonly iconEmoji: string;
  private readonly includeFullContext: boolean;

  constructor(config: SlackChannelConfig) {
    super({
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    });

    if (!config.webhookUrl) {
      throw new Error('Slack webhook URL is required');
    }

    this.webhookUrl = config.webhookUrl;
    this.defaultChannel = config.defaultChannel ?? '';
    this.username = config.username ?? 'Security Alert Bot';
    this.iconEmoji = config.iconEmoji ?? ':shield:';
    this.includeFullContext = config.includeFullContext ?? true;

    logger.info('SlackAlertChannel initialized');
  }

  /**
   * Send an alert to Slack
   */
  protected async sendInternal(alert: SecurityAlert): Promise<SendInternalResult> {
    const message = this.formatMessage(alert);

    await this.httpRequestOrThrow({
      url: this.webhookUrl,
      method: 'POST',
      body: message,
    });

    // Slack webhooks return "ok" on success, not a message ID
    return { messageId: `slack-${Date.now()}` };
  }

  /**
   * Format alert as Slack message
   */
  private formatMessage(alert: SecurityAlert): SlackMessage {
    const severity = alert.severity as AlertSeverity;
    const emoji = SEVERITY_EMOJIS[severity] ?? SEVERITY_EMOJIS[AlertSeverity.INFO];
    const color = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS[AlertSeverity.INFO];

    const fields: SlackAttachment['fields'] = [
      {
        title: 'Severity',
        value: `${emoji} ${alert.severity.toUpperCase()}`,
        short: true,
      },
      {
        title: 'Type',
        value: alert.type.replace(/_/g, ' ').toUpperCase(),
        short: true,
      },
      {
        title: 'Source',
        value: alert.source,
        short: true,
      },
      {
        title: 'Time',
        value: `<!date^${Math.floor(alert.timestamp.getTime() / 1000)}^{date_short_pretty} at {time}|${alert.timestamp.toISOString()}>`,
        short: true,
      },
    ];

    // Add context fields
    if (this.includeFullContext) {
      if (alert.context.userId) {
        fields.push({
          title: 'User ID',
          value: alert.context.userId,
          short: true,
        });
      }
      if (alert.context.ipAddress) {
        fields.push({
          title: 'IP Address',
          value: alert.context.ipAddress,
          short: true,
        });
      }
      if (alert.context.location?.country) {
        fields.push({
          title: 'Location',
          value: `${alert.context.location.city || ''} ${alert.context.location.country}`.trim(),
          short: true,
        });
      }
      if (alert.context.resource) {
        fields.push({
          title: 'Resource',
          value: alert.context.resource,
          short: true,
        });
      }
    }

    // Add suggested actions if present
    if (alert.suggestedActions && alert.suggestedActions.length > 0) {
      fields.push({
        title: 'Suggested Actions',
        value: alert.suggestedActions.map(a => `* ${a}`).join('\n'),
        short: false,
      });
    }

    // Add tags if present
    if (alert.tags && alert.tags.length > 0) {
      fields.push({
        title: 'Tags',
        value: alert.tags.map(t => `\`${t}\``).join(' '),
        short: false,
      });
    }

    const attachment: SlackAttachment = {
      color,
      title: alert.title,
      text: alert.message,
      fields,
      footer: `Alert ID: ${alert.id}`,
      ts: Math.floor(alert.timestamp.getTime() / 1000),
    };

    const message: SlackMessage = {
      username: this.username,
      icon_emoji: this.iconEmoji,
      text: `${emoji} *Security Alert: ${alert.title}*`,
      attachments: [attachment],
    };

    if (this.defaultChannel) {
      message.channel = this.defaultChannel;
    }

    return message;
  }

  /**
   * Test the Slack connection
   */
  async test(): Promise<boolean> {
    try {
      const testMessage: SlackMessage = {
        username: this.username,
        icon_emoji: this.iconEmoji,
        text: ':white_check_mark: Security Alert System - Connection Test',
        attachments: [{
          color: '#00CC00',
          title: 'Test Message',
          text: 'This is a test message from the security alerting system.',
          fields: [
            { title: 'Status', value: 'Connected', short: true },
            { title: 'Time', value: new Date().toISOString(), short: true },
          ],
          footer: 'Security Alert System',
          ts: Math.floor(Date.now() / 1000),
        }],
      };

      if (this.defaultChannel) {
        testMessage.channel = this.defaultChannel;
      }

      await this.httpRequestOrThrow({
        url: this.webhookUrl,
        method: 'POST',
        body: testMessage,
      });

      logger.info('Slack connection test successful');
      return true;
    } catch (error) {
      logger.error({ error }, 'Slack connection test failed');
      return false;
    }
  }
}

/**
 * Create a new Slack alert channel
 */
export function createSlackChannel(config: SlackChannelConfig): SlackAlertChannel {
  return new SlackAlertChannel(config);
}
