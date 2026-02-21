/**
 * Email Alert Channel
 *
 * Sends security alerts via email using nodemailer or AWS SES.
 * Supports HTML formatting with severity-based styling.
 *
 * @packageDocumentation
 * @module security/alerting/channels/email
 */

import { createLogger } from '../../../common/logger.js';
import {
  type SecurityAlert,
  type AlertDeliveryResult,
  AlertChannel,
  AlertSeverity,
} from '../types.js';
import { BaseAlertChannel, type BaseChannelConfig } from './base.js';
import type { SendInternalResult } from './base.js';

const logger = createLogger({ component: 'email-alert-channel' });

// =============================================================================
// Types
// =============================================================================

export interface EmailChannelConfig extends BaseChannelConfig {
  /** Email provider: 'smtp' or 'ses' */
  provider: 'smtp' | 'ses';
  /** From address */
  from: string;
  /** Default recipient addresses */
  defaultRecipients: string[];
  /** SMTP configuration (required if provider is 'smtp') */
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    auth?: {
      user: string;
      pass: string;
    };
  };
  /** AWS SES configuration (required if provider is 'ses') */
  ses?: {
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  /** Subject prefix */
  subjectPrefix?: string;
  /** Include raw JSON in email */
  includeRawJson?: boolean;
}

interface EmailMessage {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}

interface EmailTransportResult {
  messageId: string;
}

interface EmailTransporter {
  sendMail(message: EmailMessage): Promise<EmailTransportResult>;
  verify?(): Promise<boolean>;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 3;

const SEVERITY_COLORS: Record<AlertSeverity, { bg: string; text: string; badge: string }> = {
  [AlertSeverity.CRITICAL]: { bg: '#FEE2E2', text: '#991B1B', badge: '#DC2626' },
  [AlertSeverity.HIGH]: { bg: '#FEF3C7', text: '#92400E', badge: '#F59E0B' },
  [AlertSeverity.MEDIUM]: { bg: '#FEF9C3', text: '#854D0E', badge: '#EAB308' },
  [AlertSeverity.LOW]: { bg: '#DCFCE7', text: '#166534', badge: '#22C55E' },
  [AlertSeverity.INFO]: { bg: '#DBEAFE', text: '#1E40AF', badge: '#3B82F6' },
};

// =============================================================================
// EmailAlertChannel Class
// =============================================================================

/**
 * Email alert channel using SMTP or AWS SES
 */
export class EmailAlertChannel extends BaseAlertChannel {
  protected readonly channelType = AlertChannel.EMAIL;
  protected readonly channelName = 'Email';
  protected override readonly logger = logger;

  private readonly provider: 'smtp' | 'ses';
  private readonly from: string;
  private readonly defaultRecipients: string[];
  private readonly smtp?: EmailChannelConfig['smtp'];
  private readonly ses?: EmailChannelConfig['ses'];
  private readonly subjectPrefix: string;
  private readonly includeRawJson: boolean;
  private transporter: EmailTransporter | null = null;

  constructor(config: EmailChannelConfig) {
    super({
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    });

    if (!config.from) {
      throw new Error('From address is required');
    }
    if (!config.defaultRecipients || config.defaultRecipients.length === 0) {
      throw new Error('At least one default recipient is required');
    }

    this.provider = config.provider;
    this.from = config.from;
    this.defaultRecipients = config.defaultRecipients;
    this.smtp = config.smtp;
    this.ses = config.ses;
    this.subjectPrefix = config.subjectPrefix ?? '[Security Alert]';
    this.includeRawJson = config.includeRawJson ?? false;

    logger.info({ provider: config.provider }, 'EmailAlertChannel initialized');
  }

  /**
   * Initialize the email transporter
   */
  private async initTransporter(): Promise<void> {
    if (this.transporter) return;

    try {
      if (this.provider === 'smtp' && this.smtp) {
        // Dynamic import of nodemailer
        const nodemailer = await import('nodemailer');

        const transport = nodemailer.createTransport({
          host: this.smtp.host,
          port: this.smtp.port,
          secure: this.smtp.secure,
          auth: this.smtp.auth,
          connectionTimeout: this.timeout,
        });

        this.transporter = {
          sendMail: async (message: EmailMessage): Promise<EmailTransportResult> => {
            const info = await transport.sendMail(message);
            return { messageId: info.messageId as string };
          },
          verify: async (): Promise<boolean> => {
            await transport.verify();
            return true;
          },
        };
      } else if (this.provider === 'ses' && this.ses) {
        const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');

        const sesClient = new SESClient({
          region: this.ses.region,
          credentials: this.ses.accessKeyId && this.ses.secretAccessKey
            ? {
                accessKeyId: this.ses.accessKeyId,
                secretAccessKey: this.ses.secretAccessKey,
              }
            : undefined,
        });

        // Create a custom SES transporter
        this.transporter = {
          sendMail: async (message: EmailMessage): Promise<EmailTransportResult> => {
            const command = new SendEmailCommand({
              Source: message.from,
              Destination: {
                ToAddresses: message.to,
              },
              Message: {
                Subject: {
                  Data: message.subject,
                  Charset: 'UTF-8',
                },
                Body: {
                  Text: {
                    Data: message.text,
                    Charset: 'UTF-8',
                  },
                  Html: {
                    Data: message.html,
                    Charset: 'UTF-8',
                  },
                },
              },
            });

            const result = await sesClient.send(command);
            return { messageId: result.MessageId ?? `ses-${Date.now()}` };
          },
        };
      } else {
        throw new Error('Invalid email configuration');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to initialize email transporter');
      throw error;
    }
  }

  /**
   * Send an alert via email
   */
  protected async sendInternal(alert: SecurityAlert): Promise<SendInternalResult> {
    await this.initTransporter();

    if (!this.transporter) {
      throw new Error('Email transporter not initialized');
    }

    const message = this.formatMessage(alert, this.defaultRecipients);
    const info = await this.transporter.sendMail(message);

    return { messageId: info.messageId };
  }

  /**
   * Send an alert via email to specific recipients
   */
  async sendToRecipients(
    alert: SecurityAlert,
    recipients: string[]
  ): Promise<AlertDeliveryResult> {
    const startTime = Date.now();
    let retryCount = 0;
    let lastError: Error | null = null;

    const to = recipients.length > 0 ? recipients : this.defaultRecipients;

    while (retryCount <= this.maxRetries) {
      try {
        await this.initTransporter();

        if (!this.transporter) {
          throw new Error('Email transporter not initialized');
        }

        const message = this.formatMessage(alert, to);
        const info = await this.transporter.sendMail(message);

        this.logger.info(
          {
            alertId: alert.id,
            messageId: info.messageId,
            recipients: to.length,
            severity: alert.severity,
            retryCount,
            durationMs: Date.now() - startTime,
          },
          'Alert sent via email'
        );

        return this.createSuccessResult(info.messageId, retryCount);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        retryCount++;

        if (retryCount <= this.maxRetries) {
          const delay = this.calculateBackoff(retryCount);
          await this.sleep(delay);
        }
      }
    }

    return this.createFailureResult(lastError?.message ?? 'Unknown error', retryCount);
  }

  /**
   * Format alert as email message
   */
  private formatMessage(alert: SecurityAlert, to: string[]): EmailMessage {
    const severity = alert.severity as AlertSeverity;
    const colors = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS[AlertSeverity.INFO];
    const subject = `${this.subjectPrefix} [${alert.severity.toUpperCase()}] ${alert.title}`;

    // Plain text version
    const text = this.formatPlainText(alert);

    // HTML version
    const html = this.formatHtml(alert, colors);

    return {
      from: this.from,
      to,
      subject,
      text,
      html,
    };
  }

  /**
   * Format plain text email
   */
  private formatPlainText(alert: SecurityAlert): string {
    const lines = [
      `SECURITY ALERT: ${alert.title}`,
      '='.repeat(60),
      '',
      `Severity: ${alert.severity.toUpperCase()}`,
      `Type: ${alert.type.replace(/_/g, ' ')}`,
      `Time: ${alert.timestamp.toISOString()}`,
      `Source: ${alert.source}`,
      `Alert ID: ${alert.id}`,
      '',
      'Message:',
      alert.message,
      '',
    ];

    // Add context
    if (Object.keys(alert.context).length > 0) {
      lines.push('Context:', '-'.repeat(40));
      if (alert.context.userId) lines.push(`  User ID: ${alert.context.userId}`);
      if (alert.context.ipAddress) lines.push(`  IP Address: ${alert.context.ipAddress}`);
      if (alert.context.tenantId) lines.push(`  Tenant ID: ${alert.context.tenantId}`);
      if (alert.context.resource) lines.push(`  Resource: ${alert.context.resource}`);
      if (alert.context.location) {
        const loc = alert.context.location;
        lines.push(`  Location: ${[loc.city, loc.country].filter(Boolean).join(', ')}`);
      }
      if (alert.context.userAgent) lines.push(`  User Agent: ${alert.context.userAgent}`);
      lines.push('');
    }

    // Add suggested actions
    if (alert.suggestedActions && alert.suggestedActions.length > 0) {
      lines.push('Suggested Actions:', '-'.repeat(40));
      alert.suggestedActions.forEach((action, i) => {
        lines.push(`  ${i + 1}. ${action}`);
      });
      lines.push('');
    }

    // Add tags
    if (alert.tags && alert.tags.length > 0) {
      lines.push(`Tags: ${alert.tags.join(', ')}`);
      lines.push('');
    }

    lines.push('-'.repeat(60));
    lines.push('This is an automated security alert from Vorion Security.');

    return lines.join('\n');
  }

  /**
   * Format HTML email
   */
  private formatHtml(
    alert: SecurityAlert,
    colors: { bg: string; text: string; badge: string }
  ): string {
    const contextRows: string[] = [];

    if (alert.context.userId) {
      contextRows.push(this.htmlTableRow('User ID', alert.context.userId));
    }
    if (alert.context.ipAddress) {
      contextRows.push(this.htmlTableRow('IP Address', alert.context.ipAddress));
    }
    if (alert.context.tenantId) {
      contextRows.push(this.htmlTableRow('Tenant ID', alert.context.tenantId));
    }
    if (alert.context.resource) {
      contextRows.push(this.htmlTableRow('Resource', alert.context.resource));
    }
    if (alert.context.location) {
      const loc = alert.context.location;
      contextRows.push(
        this.htmlTableRow('Location', [loc.city, loc.country].filter(Boolean).join(', '))
      );
    }
    if (alert.context.userAgent) {
      contextRows.push(this.htmlTableRow('User Agent', alert.context.userAgent));
    }
    if (alert.context.requestId) {
      contextRows.push(this.htmlTableRow('Request ID', alert.context.requestId));
    }
    if (alert.context.sessionId) {
      contextRows.push(this.htmlTableRow('Session ID', alert.context.sessionId));
    }

    const suggestedActionsHtml = alert.suggestedActions && alert.suggestedActions.length > 0
      ? `
        <div style="margin-top: 20px;">
          <h3 style="color: #374151; margin-bottom: 10px;">Suggested Actions</h3>
          <ol style="margin: 0; padding-left: 20px; color: #4B5563;">
            ${alert.suggestedActions.map(a => `<li style="margin-bottom: 5px;">${this.escapeHtml(a)}</li>`).join('')}
          </ol>
        </div>
      `
      : '';

    const tagsHtml = alert.tags && alert.tags.length > 0
      ? `
        <div style="margin-top: 20px;">
          ${alert.tags.map(t => `<span style="display: inline-block; background: #E5E7EB; color: #374151; padding: 2px 8px; border-radius: 12px; font-size: 12px; margin-right: 5px;">${this.escapeHtml(t)}</span>`).join('')}
        </div>
      `
      : '';

    const rawJsonHtml = this.includeRawJson
      ? `
        <div style="margin-top: 20px;">
          <details>
            <summary style="cursor: pointer; color: #6B7280;">View Raw JSON</summary>
            <pre style="background: #F3F4F6; padding: 15px; border-radius: 4px; overflow-x: auto; font-size: 11px; margin-top: 10px;">${this.escapeHtml(JSON.stringify(alert, null, 2))}</pre>
          </details>
        </div>
      `
      : '';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Alert: ${this.escapeHtml(alert.title)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1F2937; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: ${colors.bg}; border-left: 4px solid ${colors.badge}; padding: 20px; border-radius: 4px;">
    <div style="display: flex; align-items: center; margin-bottom: 10px;">
      <span style="background: ${colors.badge}; color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
        ${alert.severity}
      </span>
      <span style="margin-left: 10px; color: #6B7280; font-size: 14px;">
        ${alert.type.replace(/_/g, ' ').toUpperCase()}
      </span>
    </div>
    <h1 style="margin: 0; font-size: 20px; color: ${colors.text};">
      ${this.escapeHtml(alert.title)}
    </h1>
  </div>

  <div style="margin-top: 20px; padding: 20px; background: #F9FAFB; border-radius: 4px;">
    <p style="margin: 0; color: #374151;">${this.escapeHtml(alert.message)}</p>
  </div>

  <div style="margin-top: 20px;">
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <tr>
        <td style="padding: 8px 0; color: #6B7280; width: 120px;">Time</td>
        <td style="padding: 8px 0; color: #1F2937;">${alert.timestamp.toISOString()}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6B7280;">Source</td>
        <td style="padding: 8px 0; color: #1F2937;">${this.escapeHtml(alert.source)}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6B7280;">Alert ID</td>
        <td style="padding: 8px 0; color: #1F2937; font-family: monospace; font-size: 12px;">${alert.id}</td>
      </tr>
      ${contextRows.join('')}
    </table>
  </div>

  ${suggestedActionsHtml}
  ${tagsHtml}
  ${rawJsonHtml}

  <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #E5E7EB; font-size: 12px; color: #9CA3AF;">
    <p>This is an automated security alert from Vorion Security.</p>
    <p>Alert fingerprint: <code style="background: #F3F4F6; padding: 2px 4px; border-radius: 2px;">${alert.fingerprint}</code></p>
  </div>
</body>
</html>
    `;
  }

  private htmlTableRow(label: string, value: string): string {
    return `
      <tr>
        <td style="padding: 8px 0; color: #6B7280;">${this.escapeHtml(label)}</td>
        <td style="padding: 8px 0; color: #1F2937;">${this.escapeHtml(value)}</td>
      </tr>
    `;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Test the email connection
   */
  async test(): Promise<boolean> {
    try {
      await this.initTransporter();

      if (this.provider === 'smtp' && this.transporter?.verify) {
        await this.transporter.verify();
      }

      logger.info('Email connection test successful');
      return true;
    } catch (error) {
      logger.error({ error }, 'Email connection test failed');
      return false;
    }
  }
}

/**
 * Create a new email alert channel
 */
export function createEmailChannel(config: EmailChannelConfig): EmailAlertChannel {
  return new EmailAlertChannel(config);
}
