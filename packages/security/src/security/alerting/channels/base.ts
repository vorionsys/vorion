/**
 * Base Alert Channel
 *
 * Abstract base class for all alert channels providing common functionality:
 * - Exponential backoff retry logic
 * - Error handling and logging
 * - Delivery result formatting
 *
 * @packageDocumentation
 * @module security/alerting/channels/base
 */

import { createLogger } from '../../../common/logger.js';
import {
  type SecurityAlert,
  type AlertDeliveryResult,
  type AlertChannel,
} from '../types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Base configuration for all alert channels
 */
export interface BaseChannelConfig {
  /** Timeout for requests in ms */
  timeout?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Maximum backoff delay in ms */
  maxBackoffDelay?: number;
  /** Base delay for exponential backoff in ms */
  baseBackoffDelay?: number;
}

/**
 * Internal result from sendInternal implementations
 */
export interface SendInternalResult {
  /** Message ID if available */
  messageId?: string;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_BACKOFF_DELAY = 10000;
const DEFAULT_BASE_BACKOFF_DELAY = 1000;

// =============================================================================
// BaseAlertChannel Class
// =============================================================================

/**
 * Abstract base class for all alert channels
 *
 * Provides common retry logic, error handling, and result formatting.
 * Subclasses must implement sendInternal() with channel-specific logic.
 */
export abstract class BaseAlertChannel {
  protected readonly logger: ReturnType<typeof createLogger>;
  protected readonly timeout: number;
  protected readonly maxRetries: number;
  protected readonly maxBackoffDelay: number;
  protected readonly baseBackoffDelay: number;

  /**
   * The channel type identifier
   */
  protected abstract readonly channelType: AlertChannel;

  /**
   * Channel name for logging
   */
  protected abstract readonly channelName: string;

  constructor(config: BaseChannelConfig = {}) {
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxBackoffDelay = config.maxBackoffDelay ?? DEFAULT_MAX_BACKOFF_DELAY;
    this.baseBackoffDelay = config.baseBackoffDelay ?? DEFAULT_BASE_BACKOFF_DELAY;

    // Logger will be initialized with component name in subclass constructor
    this.logger = createLogger({ component: 'base-alert-channel' });
  }

  /**
   * Send an alert through this channel with retry logic
   */
  async send(alert: SecurityAlert): Promise<AlertDeliveryResult> {
    const startTime = Date.now();
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount <= this.maxRetries) {
      try {
        const result = await this.sendInternal(alert);

        this.logger.info(
          {
            alertId: alert.id,
            messageId: result.messageId,
            severity: alert.severity,
            retryCount,
            durationMs: Date.now() - startTime,
          },
          `Alert sent to ${this.channelName}`
        );

        return this.createSuccessResult(result.messageId, retryCount);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        retryCount++;

        if (retryCount <= this.maxRetries) {
          const delay = this.calculateBackoff(retryCount);
          this.logger.warn(
            {
              alertId: alert.id,
              error: lastError.message,
              retryCount,
              nextRetryIn: delay,
            },
            `Retrying ${this.channelName} request`
          );
          await this.sleep(delay);
        }
      }
    }

    this.logger.error(
      {
        alertId: alert.id,
        error: lastError?.message,
        retryCount,
      },
      `Failed to send alert to ${this.channelName}`
    );

    return this.createFailureResult(lastError?.message ?? 'Unknown error', retryCount);
  }

  /**
   * Channel-specific send implementation
   *
   * Subclasses must implement this method with their specific delivery logic.
   * Should throw an error on failure to trigger retry.
   */
  protected abstract sendInternal(alert: SecurityAlert): Promise<SendInternalResult>;

  /**
   * Test the channel connection
   */
  abstract test(): Promise<boolean>;

  /**
   * Calculate exponential backoff delay
   */
  protected calculateBackoff(attempt: number): number {
    const delay = this.baseBackoffDelay * Math.pow(2, attempt - 1);
    return Math.min(delay, this.maxBackoffDelay);
  }

  /**
   * Sleep for specified milliseconds
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create a success delivery result
   */
  protected createSuccessResult(messageId?: string, retryCount = 0): AlertDeliveryResult {
    return {
      channel: this.channelType,
      success: true,
      messageId,
      timestamp: new Date(),
      retryCount,
    };
  }

  /**
   * Create a failure delivery result
   */
  protected createFailureResult(error: string, retryCount = 0): AlertDeliveryResult {
    return {
      channel: this.channelType,
      success: false,
      error,
      timestamp: new Date(),
      retryCount,
    };
  }

  /**
   * Create logger for a specific component
   */
  protected createChannelLogger(component: string): ReturnType<typeof createLogger> {
    return createLogger({ component });
  }
}
