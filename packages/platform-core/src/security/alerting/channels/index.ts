/**
 * Alert Channel Exports
 *
 * Centralizes all alert channel implementations and base classes.
 *
 * @packageDocumentation
 * @module security/alerting/channels
 */

// Base classes
export {
  BaseAlertChannel,
  type BaseChannelConfig,
  type SendInternalResult,
} from './base.js';

export {
  HttpAlertChannel,
  type HttpChannelConfig,
  type HttpRequestOptions,
  type HttpResponse,
} from './http-base.js';

// Slack
export {
  SlackAlertChannel,
  createSlackChannel,
  type SlackChannelConfig,
} from './slack.js';

// PagerDuty
export {
  PagerDutyAlertChannel,
  createPagerDutyChannel,
  type PagerDutyChannelConfig,
} from './pagerduty.js';

// Email
export {
  EmailAlertChannel,
  createEmailChannel,
  type EmailChannelConfig,
} from './email.js';

// Webhook
export {
  WebhookAlertChannel,
  createWebhookChannel,
  createSignedWebhookChannel,
  type WebhookChannelConfig,
} from './webhook.js';

// SNS
export {
  SNSAlertChannel,
  createSNSChannel,
  type SNSChannelConfig,
} from './sns.js';

// Re-export types for convenience
import type { SecurityAlert, AlertDeliveryResult } from '../types.js';

/**
 * Common interface for all alert channels
 */
export interface AlertChannelInterface {
  /**
   * Send an alert through this channel
   */
  send(alert: SecurityAlert): Promise<AlertDeliveryResult>;

  /**
   * Test the channel connection
   */
  test(): Promise<boolean>;
}
