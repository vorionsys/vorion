/**
 * PagerDuty Alert Channel
 *
 * Sends security alerts to PagerDuty via Events API v2.
 * Supports incident creation, acknowledgment, and resolution.
 *
 * @packageDocumentation
 * @module security/alerting/channels/pagerduty
 */

import { createLogger } from '../../../common/logger.js';
import {
  type SecurityAlert,
  type AlertDeliveryResult,
  AlertChannel,
  AlertSeverity,
} from '../types.js';
import { HttpAlertChannel, type HttpChannelConfig } from './http-base.js';
import type { SendInternalResult } from './base.js';

const logger = createLogger({ component: 'pagerduty-alert-channel' });

// =============================================================================
// Types
// =============================================================================

export interface PagerDutyChannelConfig extends HttpChannelConfig {
  /** PagerDuty Events API v2 routing key (integration key) */
  routingKey: string;
  /** PagerDuty Events API URL (default: https://events.pagerduty.com/v2/enqueue) */
  apiUrl?: string;
  /** Service name for events */
  serviceName?: string;
  /** Custom component name */
  component?: string;
  /** Custom group name */
  group?: string;
  /** Custom class name */
  class?: string;
}

/** PagerDuty severity values */
type PagerDutySeverity = 'critical' | 'error' | 'warning' | 'info';

/** PagerDuty event action types */
type PagerDutyEventAction = 'trigger' | 'acknowledge' | 'resolve';

/**
 * PagerDuty Events API v2 payload
 */
interface PagerDutyPayload {
  routing_key: string;
  event_action: PagerDutyEventAction;
  dedup_key: string;
  payload?: {
    summary: string;
    source: string;
    severity: PagerDutySeverity;
    timestamp?: string;
    component?: string;
    group?: string;
    class?: string;
    custom_details?: Record<string, unknown>;
  };
  links?: Array<{
    href: string;
    text: string;
  }>;
  images?: Array<{
    src: string;
    href?: string;
    alt?: string;
  }>;
}

interface PagerDutyResponse {
  status: string;
  message: string;
  dedup_key: string;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_API_URL = 'https://events.pagerduty.com/v2/enqueue';
const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Map our severity levels to PagerDuty severity
 */
const SEVERITY_MAPPING: Record<AlertSeverity, PagerDutySeverity> = {
  [AlertSeverity.CRITICAL]: 'critical',
  [AlertSeverity.HIGH]: 'error',
  [AlertSeverity.MEDIUM]: 'warning',
  [AlertSeverity.LOW]: 'info',
  [AlertSeverity.INFO]: 'info',
};

// =============================================================================
// PagerDutyAlertChannel Class
// =============================================================================

/**
 * PagerDuty Events API integration for security alerts
 */
export class PagerDutyAlertChannel extends HttpAlertChannel {
  protected readonly channelType = AlertChannel.PAGERDUTY;
  protected readonly channelName = 'PagerDuty';
  protected override readonly logger = logger;

  private readonly routingKey: string;
  private readonly apiUrl: string;
  private readonly serviceName: string;
  private readonly component: string;
  private readonly group: string;
  private readonly classValue: string;

  constructor(config: PagerDutyChannelConfig) {
    super({
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    });

    if (!config.routingKey) {
      throw new Error('PagerDuty routing key is required');
    }

    this.routingKey = config.routingKey;
    this.apiUrl = config.apiUrl ?? DEFAULT_API_URL;
    this.serviceName = config.serviceName ?? 'Security Alert System';
    this.component = config.component ?? 'security';
    this.group = config.group ?? 'security-alerts';
    this.classValue = config.class ?? 'security-incident';

    logger.info('PagerDutyAlertChannel initialized');
  }

  /**
   * Send an alert to PagerDuty (trigger an incident)
   */
  protected async sendInternal(alert: SecurityAlert): Promise<SendInternalResult> {
    return this.sendEvent(alert, 'trigger');
  }

  /**
   * Acknowledge an alert in PagerDuty
   */
  async acknowledge(alert: SecurityAlert): Promise<AlertDeliveryResult> {
    const startTime = Date.now();
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount <= this.maxRetries) {
      try {
        const result = await this.sendEvent(alert, 'acknowledge');

        this.logger.info(
          {
            alertId: alert.id,
            messageId: result.messageId,
            action: 'acknowledge',
            retryCount,
            durationMs: Date.now() - startTime,
          },
          'Alert acknowledged in PagerDuty'
        );

        return this.createSuccessResult(result.messageId, retryCount);
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
   * Resolve an alert in PagerDuty
   */
  async resolve(alert: SecurityAlert): Promise<AlertDeliveryResult> {
    const startTime = Date.now();
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount <= this.maxRetries) {
      try {
        const result = await this.sendEvent(alert, 'resolve');

        this.logger.info(
          {
            alertId: alert.id,
            messageId: result.messageId,
            action: 'resolve',
            retryCount,
            durationMs: Date.now() - startTime,
          },
          'Alert resolved in PagerDuty'
        );

        return this.createSuccessResult(result.messageId, retryCount);
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
   * Send an event to PagerDuty
   */
  private async sendEvent(
    alert: SecurityAlert,
    action: PagerDutyEventAction
  ): Promise<SendInternalResult> {
    const payload = this.formatPayload(alert, action);

    const response = await this.httpRequestOrThrow<PagerDutyResponse>({
      url: this.apiUrl,
      method: 'POST',
      body: payload,
    });

    return { messageId: response.data.dedup_key };
  }

  /**
   * Format alert as PagerDuty payload
   */
  private formatPayload(
    alert: SecurityAlert,
    action: PagerDutyEventAction
  ): PagerDutyPayload {
    const payload: PagerDutyPayload = {
      routing_key: this.routingKey,
      event_action: action,
      dedup_key: alert.fingerprint, // Use fingerprint for deduplication
    };

    // Only include full payload for trigger action
    if (action === 'trigger') {
      const customDetails: Record<string, unknown> = {
        alert_id: alert.id,
        alert_type: alert.type,
        source: alert.source,
        fingerprint: alert.fingerprint,
      };

      // Add context details
      if (alert.context.userId) {
        customDetails.user_id = alert.context.userId;
      }
      if (alert.context.ipAddress) {
        customDetails.ip_address = alert.context.ipAddress;
      }
      if (alert.context.tenantId) {
        customDetails.tenant_id = alert.context.tenantId;
      }
      if (alert.context.resource) {
        customDetails.resource = alert.context.resource;
      }
      if (alert.context.location) {
        customDetails.location = alert.context.location;
      }
      if (alert.context.userAgent) {
        customDetails.user_agent = alert.context.userAgent;
      }
      if (alert.context.requestId) {
        customDetails.request_id = alert.context.requestId;
      }
      if (alert.context.sessionId) {
        customDetails.session_id = alert.context.sessionId;
      }

      // Add suggested actions
      if (alert.suggestedActions && alert.suggestedActions.length > 0) {
        customDetails.suggested_actions = alert.suggestedActions;
      }

      // Add tags
      if (alert.tags && alert.tags.length > 0) {
        customDetails.tags = alert.tags;
      }

      // Add additional metadata
      if (alert.context.metadata) {
        customDetails.metadata = alert.context.metadata;
      }

      payload.payload = {
        summary: `[${alert.severity.toUpperCase()}] ${alert.title}: ${alert.message.slice(0, 200)}`,
        source: this.serviceName,
        severity: SEVERITY_MAPPING[alert.severity as AlertSeverity],
        timestamp: alert.timestamp.toISOString(),
        component: this.component,
        group: this.group,
        class: this.classValue,
        custom_details: customDetails,
      };
    }

    return payload;
  }

  /**
   * Test the PagerDuty connection
   */
  async test(): Promise<boolean> {
    try {
      // Send a test event that triggers and immediately resolves
      const testAlert: SecurityAlert = {
        id: 'test-' + Date.now(),
        severity: AlertSeverity.INFO,
        type: 'custom',
        title: 'Security Alert System Test',
        message: 'This is a test message from the security alerting system.',
        context: {},
        timestamp: new Date(),
        fingerprint: `test-connection-${Date.now()}`,
        source: this.serviceName,
        acknowledged: false,
        resolved: false,
      };

      // Trigger test event
      const result = await this.send(testAlert);

      if (result.success) {
        // Immediately resolve it
        await this.resolve(testAlert);
        logger.info('PagerDuty connection test successful');
        return true;
      }

      return false;
    } catch (error) {
      logger.error({ error }, 'PagerDuty connection test failed');
      return false;
    }
  }
}

/**
 * Create a new PagerDuty alert channel
 */
export function createPagerDutyChannel(config: PagerDutyChannelConfig): PagerDutyAlertChannel {
  return new PagerDutyAlertChannel(config);
}
