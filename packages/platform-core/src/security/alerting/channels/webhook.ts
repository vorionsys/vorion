/**
 * Generic Webhook Alert Channel
 *
 * Sends security alerts to any webhook endpoint.
 * Supports custom headers, authentication, and payload transformation.
 *
 * @packageDocumentation
 * @module security/alerting/channels/webhook
 */

import { createLogger } from '../../../common/logger.js';
import {
  type SecurityAlert,
  AlertChannel,
} from '../types.js';
import { HttpAlertChannel, type HttpChannelConfig } from './http-base.js';
import type { SendInternalResult } from './base.js';
import { createHmac } from 'crypto';

const logger = createLogger({ component: 'webhook-alert-channel' });

// =============================================================================
// Types
// =============================================================================

export interface WebhookChannelConfig extends HttpChannelConfig {
  /** Webhook URL */
  url: string;
  /** HTTP method (default: POST) */
  method?: 'POST' | 'PUT' | 'PATCH';
  /** Custom headers */
  headers?: Record<string, string>;
  /** Authentication configuration */
  auth?: {
    type: 'basic' | 'bearer' | 'api-key' | 'hmac';
    /** For basic auth: username */
    username?: string;
    /** For basic auth: password; for bearer: token; for api-key: key */
    credentials?: string;
    /** For api-key: header name (default: X-API-Key) */
    headerName?: string;
    /** For HMAC: secret key */
    secret?: string;
    /** For HMAC: algorithm (default: sha256) */
    algorithm?: 'sha256' | 'sha384' | 'sha512';
    /** For HMAC: header name (default: X-Signature) */
    signatureHeader?: string;
  };
  /** Custom payload transformer */
  transformPayload?: (alert: SecurityAlert) => unknown;
  /** Content type (default: application/json) */
  contentType?: string;
  /** Include timestamp header */
  includeTimestamp?: boolean;
  /** Timestamp header name (default: X-Timestamp) */
  timestampHeader?: string;
  /** Verify SSL (default: true) */
  verifySSL?: boolean;
}

interface WebhookPayload {
  alert: SecurityAlert;
  timestamp: string;
  version: string;
}

interface WebhookResponseData {
  id?: string;
  messageId?: string;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_RETRIES = 3;
const PAYLOAD_VERSION = '1.0';

// =============================================================================
// WebhookAlertChannel Class
// =============================================================================

/**
 * Generic webhook integration for security alerts
 */
export class WebhookAlertChannel extends HttpAlertChannel {
  protected readonly channelType = AlertChannel.WEBHOOK;
  protected readonly channelName = 'Webhook';
  protected override readonly logger = logger;

  private readonly url: string;
  private readonly method: 'POST' | 'PUT' | 'PATCH';
  private readonly customHeaders: Record<string, string>;
  private readonly auth?: WebhookChannelConfig['auth'];
  private readonly transformPayload?: WebhookChannelConfig['transformPayload'];
  private readonly contentType: string;
  private readonly includeTimestamp: boolean;
  private readonly timestampHeader: string;

  constructor(config: WebhookChannelConfig) {
    super({
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    });

    if (!config.url) {
      throw new Error('Webhook URL is required');
    }

    this.url = config.url;
    this.method = config.method ?? 'POST';
    this.customHeaders = config.headers ?? {};
    this.auth = config.auth;
    this.transformPayload = config.transformPayload;
    this.contentType = config.contentType ?? 'application/json';
    this.includeTimestamp = config.includeTimestamp ?? true;
    this.timestampHeader = config.timestampHeader ?? 'X-Timestamp';

    logger.info({ url: this.maskUrl(config.url) }, 'WebhookAlertChannel initialized');
  }

  /**
   * Send an alert to the webhook
   */
  protected async sendInternal(alert: SecurityAlert): Promise<SendInternalResult> {
    const timestamp = new Date().toISOString();

    // Build payload
    let payload: unknown;
    if (this.transformPayload) {
      payload = this.transformPayload(alert);
    } else {
      payload = {
        alert,
        timestamp,
        version: PAYLOAD_VERSION,
      } as WebhookPayload;
    }

    const body = JSON.stringify(payload);

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': this.contentType,
      ...this.customHeaders,
    };

    // Add timestamp header
    if (this.includeTimestamp) {
      headers[this.timestampHeader] = timestamp;
    }

    // Add authentication
    this.addAuthHeaders(headers, body);

    // Make request
    const response = await this.httpRequestOrThrow<WebhookResponseData>({
      url: this.url,
      method: this.method,
      headers,
      body: payload,
    });

    // Try to get message ID from response
    const messageId = response.data?.id || response.data?.messageId || `webhook-${Date.now()}`;

    return { messageId };
  }

  /**
   * Add authentication headers
   */
  private addAuthHeaders(headers: Record<string, string>, body: string): void {
    if (!this.auth) return;

    const { type, credentials, username, headerName, secret, algorithm, signatureHeader } = this.auth;

    switch (type) {
      case 'basic':
        if (username && credentials) {
          const encoded = Buffer.from(`${username}:${credentials}`).toString('base64');
          headers['Authorization'] = `Basic ${encoded}`;
        }
        break;

      case 'bearer':
        if (credentials) {
          headers['Authorization'] = `Bearer ${credentials}`;
        }
        break;

      case 'api-key':
        if (credentials) {
          headers[headerName ?? 'X-API-Key'] = credentials;
        }
        break;

      case 'hmac':
        if (secret) {
          const hmac = createHmac(algorithm ?? 'sha256', secret);
          hmac.update(body);
          const signature = hmac.digest('hex');
          headers[signatureHeader ?? 'X-Signature'] = signature;
        }
        break;
    }
  }

  /**
   * Test the webhook connection
   */
  async test(): Promise<boolean> {
    try {
      const testAlert: SecurityAlert = {
        id: 'test-' + Date.now(),
        severity: 'info',
        type: 'custom',
        title: 'Webhook Connection Test',
        message: 'This is a test message from the security alerting system.',
        context: {},
        timestamp: new Date(),
        fingerprint: `test-${Date.now()}`,
        source: 'webhook-test',
        acknowledged: false,
        resolved: false,
      };

      const result = await this.send(testAlert);

      if (result.success) {
        logger.info('Webhook connection test successful');
        return true;
      }

      return false;
    } catch (error) {
      logger.error({ error }, 'Webhook connection test failed');
      return false;
    }
  }

  /**
   * Get the webhook URL (masked for debugging)
   */
  getUrl(): string {
    return this.maskUrl(this.url);
  }

  /**
   * Mask sensitive parts of URL
   */
  private maskUrl(urlString: string): string {
    try {
      const url = new URL(urlString);
      if (url.password) {
        url.password = '***';
      }
      return url.toString();
    } catch {
      return '[invalid url]';
    }
  }
}

/**
 * Create a new webhook alert channel
 */
export function createWebhookChannel(config: WebhookChannelConfig): WebhookAlertChannel {
  return new WebhookAlertChannel(config);
}

/**
 * Create a webhook channel with HMAC signing
 */
export function createSignedWebhookChannel(
  url: string,
  secret: string,
  options?: Partial<WebhookChannelConfig>
): WebhookAlertChannel {
  return new WebhookAlertChannel({
    url,
    auth: {
      type: 'hmac',
      secret,
      algorithm: 'sha256',
    },
    ...options,
  });
}
