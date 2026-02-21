/**
 * AWS SNS Alert Channel
 *
 * Sends security alerts to AWS SNS for scalable, distributed delivery.
 * Supports topic publishing for fan-out to multiple subscribers.
 *
 * @packageDocumentation
 * @module security/alerting/channels/sns
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

const logger = createLogger({ component: 'sns-alert-channel' });

// =============================================================================
// Types
// =============================================================================

export interface SNSChannelConfig extends BaseChannelConfig {
  /** AWS region */
  region: string;
  /** SNS topic ARN */
  topicArn: string;
  /** AWS credentials (optional - uses default credential chain if not provided) */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  /** Custom endpoint URL (for local development or testing) */
  endpoint?: string;
  /** Include message attributes for filtering */
  includeMessageAttributes?: boolean;
  /** Custom subject prefix */
  subjectPrefix?: string;
}

interface SNSMessageAttributes {
  [key: string]: {
    DataType: 'String' | 'Number' | 'Binary';
    StringValue?: string;
    BinaryValue?: Uint8Array;
  };
}

/** AWS SNS Client interface for proper typing */
interface SNSClientInterface {
  send(command: unknown): Promise<{ MessageId?: string }>;
}

/** SNS Publish Command input */
interface PublishCommandInput {
  TopicArn: string;
  Subject: string;
  Message: string;
  MessageAttributes?: SNSMessageAttributes;
}

/** SNS Get Topic Attributes Command input */
interface GetTopicAttributesCommandInput {
  TopicArn: string;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_RETRIES = 3;

// =============================================================================
// SNSAlertChannel Class
// =============================================================================

/**
 * AWS SNS integration for security alerts
 */
export class SNSAlertChannel extends BaseAlertChannel {
  protected readonly channelType = AlertChannel.SNS;
  protected readonly channelName = 'SNS';
  protected override readonly logger = logger;

  private readonly region: string;
  private topicArn: string;
  private readonly credentials?: SNSChannelConfig['credentials'];
  private readonly endpoint?: string;
  private readonly includeMessageAttributes: boolean;
  private readonly subjectPrefix: string;
  private snsClient: SNSClientInterface | null = null;

  constructor(config: SNSChannelConfig) {
    super({
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    });

    if (!config.region) {
      throw new Error('AWS region is required');
    }
    if (!config.topicArn) {
      throw new Error('SNS topic ARN is required');
    }

    this.region = config.region;
    this.topicArn = config.topicArn;
    this.credentials = config.credentials;
    this.endpoint = config.endpoint;
    this.includeMessageAttributes = config.includeMessageAttributes ?? true;
    this.subjectPrefix = config.subjectPrefix ?? '[Security Alert]';

    logger.info(
      { region: config.region, topicArn: config.topicArn },
      'SNSAlertChannel initialized'
    );
  }

  /**
   * Initialize the SNS client
   */
  private async initClient(): Promise<void> {
    if (this.snsClient) return;

    try {
      const { SNSClient } = await import('@aws-sdk/client-sns');

      this.snsClient = new SNSClient({
        region: this.region,
        credentials: this.credentials,
        endpoint: this.endpoint,
      }) as SNSClientInterface;
    } catch (error) {
      logger.error({ error }, 'Failed to initialize SNS client');
      throw error;
    }
  }

  /**
   * Send an alert to SNS
   */
  protected async sendInternal(alert: SecurityAlert): Promise<SendInternalResult> {
    await this.initClient();
    return this.publishMessage(alert);
  }

  /**
   * Publish message to SNS topic
   */
  private async publishMessage(alert: SecurityAlert): Promise<SendInternalResult> {
    const { PublishCommand } = await import('@aws-sdk/client-sns');

    const subject = `${this.subjectPrefix} [${alert.severity.toUpperCase()}] ${alert.title}`.slice(0, 100);
    const message = this.formatMessage(alert);

    const params: PublishCommandInput = {
      TopicArn: this.topicArn,
      Subject: subject,
      Message: message,
    };

    // Add message attributes for filtering
    if (this.includeMessageAttributes) {
      params.MessageAttributes = this.buildMessageAttributes(alert);
    }

    const command = new PublishCommand(params);

    if (!this.snsClient) {
      throw new Error('SNS client not initialized');
    }

    const response = await this.snsClient.send(command);

    return { messageId: response.MessageId ?? `sns-${Date.now()}` };
  }

  /**
   * Format alert as message string
   */
  private formatMessage(alert: SecurityAlert): string {
    const data = {
      version: '1.0',
      alert: {
        id: alert.id,
        severity: alert.severity,
        type: alert.type,
        title: alert.title,
        message: alert.message,
        source: alert.source,
        timestamp: alert.timestamp.toISOString(),
        fingerprint: alert.fingerprint,
        context: alert.context,
        suggestedActions: alert.suggestedActions,
        tags: alert.tags,
        acknowledged: alert.acknowledged,
        resolved: alert.resolved,
      },
    };

    return JSON.stringify(data);
  }

  /**
   * Build SNS message attributes for filtering
   */
  private buildMessageAttributes(alert: SecurityAlert): SNSMessageAttributes {
    const attributes: SNSMessageAttributes = {
      severity: {
        DataType: 'String',
        StringValue: alert.severity,
      },
      type: {
        DataType: 'String',
        StringValue: alert.type,
      },
      source: {
        DataType: 'String',
        StringValue: alert.source,
      },
      alertId: {
        DataType: 'String',
        StringValue: alert.id,
      },
    };

    // Add context attributes if present
    if (alert.context.tenantId) {
      attributes.tenantId = {
        DataType: 'String',
        StringValue: alert.context.tenantId,
      };
    }

    if (alert.context.userId) {
      attributes.userId = {
        DataType: 'String',
        StringValue: alert.context.userId,
      };
    }

    // Add severity level as number for comparison filters
    const severityLevel = this.getSeverityLevel(alert.severity as AlertSeverity);
    attributes.severityLevel = {
      DataType: 'Number',
      StringValue: severityLevel.toString(),
    };

    // Add tags as comma-separated string
    if (alert.tags && alert.tags.length > 0) {
      attributes.tags = {
        DataType: 'String',
        StringValue: alert.tags.join(','),
      };
    }

    return attributes;
  }

  /**
   * Get numeric severity level for filtering
   */
  private getSeverityLevel(severity: AlertSeverity): number {
    const levels: Record<AlertSeverity, number> = {
      [AlertSeverity.CRITICAL]: 5,
      [AlertSeverity.HIGH]: 4,
      [AlertSeverity.MEDIUM]: 3,
      [AlertSeverity.LOW]: 2,
      [AlertSeverity.INFO]: 1,
    };
    return levels[severity] ?? 0;
  }

  /**
   * Publish to multiple topics based on severity
   */
  async sendToSeverityTopics(
    alert: SecurityAlert,
    topicMapping: Partial<Record<AlertSeverity, string>>
  ): Promise<AlertDeliveryResult[]> {
    const results: AlertDeliveryResult[] = [];

    // Always send to main topic
    results.push(await this.send(alert));

    // Also send to severity-specific topic if configured
    const severity = alert.severity as AlertSeverity;
    const severityTopic = topicMapping[severity];
    if (severityTopic && severityTopic !== this.topicArn) {
      const originalTopic = this.topicArn;
      this.topicArn = severityTopic;
      try {
        results.push(await this.send(alert));
      } finally {
        this.topicArn = originalTopic;
      }
    }

    return results;
  }

  /**
   * Test the SNS connection
   */
  async test(): Promise<boolean> {
    try {
      await this.initClient();

      // We can't easily test without actually publishing
      // So we verify the client is initialized and topic exists
      const { GetTopicAttributesCommand } = await import('@aws-sdk/client-sns');

      const params: GetTopicAttributesCommandInput = {
        TopicArn: this.topicArn,
      };

      const command = new GetTopicAttributesCommand(params);

      if (!this.snsClient) {
        throw new Error('SNS client not initialized');
      }

      await this.snsClient.send(command);

      logger.info('SNS connection test successful');
      return true;
    } catch (error) {
      logger.error({ error }, 'SNS connection test failed');
      return false;
    }
  }

  /**
   * Get the topic ARN
   */
  getTopicArn(): string {
    return this.topicArn;
  }
}

/**
 * Create a new SNS alert channel
 */
export function createSNSChannel(config: SNSChannelConfig): SNSAlertChannel {
  return new SNSAlertChannel(config);
}
