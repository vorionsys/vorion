/**
 * SIEM Connector Base
 *
 * Abstract base class and interface for SIEM connectors providing:
 * - Connection lifecycle management
 * - Retry logic with exponential backoff
 * - Health checks
 * - Common utilities
 *
 * @packageDocumentation
 * @module security/siem/connector
 */

import { createLogger } from '../../common/logger.js';
import type { SecurityEvent, SendResult, BaseConnectorConfig } from './types.js';

const logger = createLogger({ component: 'siem-connector' });

// =============================================================================
// SIEM Connector Interface
// =============================================================================

/**
 * Interface for SIEM connectors
 */
export interface SIEMConnector {
  /** Connector name */
  readonly name: string;

  /** Connector type */
  readonly type: string;

  /**
   * Connect to the SIEM system
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the SIEM system
   */
  disconnect(): Promise<void>;

  /**
   * Send events to the SIEM system
   * @param events Events to send
   * @returns Send result
   */
  send(events: SecurityEvent[]): Promise<SendResult>;

  /**
   * Check if the connector is healthy
   * @returns True if healthy
   */
  healthCheck(): Promise<boolean>;

  /**
   * Check if currently connected
   */
  isConnected(): boolean;
}

// =============================================================================
// Abstract Base Connector
// =============================================================================

/**
 * Abstract base class for SIEM connectors
 *
 * Provides common functionality:
 * - Retry logic with exponential backoff
 * - Connection state management
 * - Logging
 * - Error handling
 */
export abstract class BaseSIEMConnector implements SIEMConnector {
  public readonly name: string;
  public abstract readonly type: string;

  protected readonly timeout: number;
  protected readonly maxRetries: number;
  protected readonly retryDelayMs: number;
  protected readonly maxRetryDelayMs: number;
  protected readonly batchSize: number;

  protected connected = false;
  protected readonly logger: ReturnType<typeof createLogger>;

  constructor(config: BaseConnectorConfig) {
    this.name = config.name;
    this.timeout = config.timeout ?? 30000;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
    this.maxRetryDelayMs = config.maxRetryDelayMs ?? 30000;
    this.batchSize = config.batchSize ?? 100;

    this.logger = createLogger({ component: `siem-${this.name}` });
  }

  /**
   * Connect to the SIEM system
   */
  async connect(): Promise<void> {
    if (this.connected) {
      this.logger.debug({}, 'Already connected');
      return;
    }

    try {
      await this.doConnect();
      this.connected = true;
      this.logger.info({ connector: this.name }, 'Connected to SIEM');
    } catch (error) {
      this.logger.error(
        { error, connector: this.name },
        'Failed to connect to SIEM'
      );
      throw error;
    }
  }

  /**
   * Disconnect from the SIEM system
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      await this.doDisconnect();
      this.connected = false;
      this.logger.info({ connector: this.name }, 'Disconnected from SIEM');
    } catch (error) {
      this.logger.error(
        { error, connector: this.name },
        'Error during disconnect'
      );
      this.connected = false;
    }
  }

  /**
   * Send events to the SIEM system with retry logic
   */
  async send(events: SecurityEvent[]): Promise<SendResult> {
    if (events.length === 0) {
      return {
        success: true,
        eventsSent: 0,
        eventsFailed: 0,
        durationMs: 0,
      };
    }

    const startTime = Date.now();
    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      try {
        const result = await this.doSend(events);
        result.durationMs = Date.now() - startTime;

        if (result.success) {
          this.logger.debug(
            {
              connector: this.name,
              eventsSent: result.eventsSent,
              durationMs: result.durationMs,
            },
            'Events sent successfully'
          );
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempt++;

        if (attempt <= this.maxRetries) {
          const delay = this.calculateBackoff(attempt);
          this.logger.warn(
            {
              connector: this.name,
              error: lastError.message,
              attempt,
              maxRetries: this.maxRetries,
              retryDelayMs: delay,
            },
            'Send failed, retrying'
          );
          await this.sleep(delay);
        }
      }
    }

    const durationMs = Date.now() - startTime;
    this.logger.error(
      {
        connector: this.name,
        error: lastError?.message,
        attempts: attempt,
        eventsCount: events.length,
        durationMs,
      },
      'Failed to send events after all retries'
    );

    return {
      success: false,
      eventsSent: 0,
      eventsFailed: events.length,
      error: lastError?.message ?? 'Unknown error',
      durationMs,
      failedEventIds: events.map((e) => e.id),
    };
  }

  /**
   * Health check with timeout
   */
  async healthCheck(): Promise<boolean> {
    try {
      const timeoutPromise = new Promise<boolean>((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), this.timeout);
      });

      const checkPromise = this.doHealthCheck();

      return await Promise.race([checkPromise, timeoutPromise]);
    } catch (error) {
      this.logger.warn(
        { connector: this.name, error: (error as Error).message },
        'Health check failed'
      );
      return false;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ===========================================================================
  // Abstract Methods - Must be implemented by subclasses
  // ===========================================================================

  /**
   * Connector-specific connect logic
   */
  protected abstract doConnect(): Promise<void>;

  /**
   * Connector-specific disconnect logic
   */
  protected abstract doDisconnect(): Promise<void>;

  /**
   * Connector-specific send logic
   */
  protected abstract doSend(events: SecurityEvent[]): Promise<SendResult>;

  /**
   * Connector-specific health check logic
   */
  protected abstract doHealthCheck(): Promise<boolean>;

  // ===========================================================================
  // Protected Utility Methods
  // ===========================================================================

  /**
   * Calculate exponential backoff delay
   */
  protected calculateBackoff(attempt: number): number {
    const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
    // Add jitter (up to 20%)
    const jitter = delay * 0.2 * Math.random();
    return Math.min(delay + jitter, this.maxRetryDelayMs);
  }

  /**
   * Sleep for specified milliseconds
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Make HTTP request with timeout
   */
  protected async httpRequest<T>(options: {
    url: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: unknown;
    timeout?: number;
  }): Promise<{ status: number; ok: boolean; data: T; text: string }> {
    const {
      url,
      method = 'POST',
      headers = {},
      body,
      timeout = this.timeout,
    } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const requestInit: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        signal: controller.signal,
      };

      if (body !== undefined) {
        requestInit.body = typeof body === 'string' ? body : JSON.stringify(body);
      }

      const response = await fetch(url, requestInit);
      const text = await response.text();

      let data: T;
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = text as unknown as T;
      }

      return {
        status: response.status,
        ok: response.ok,
        data,
        text,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Split events into batches
   */
  protected splitIntoBatches(events: SecurityEvent[]): SecurityEvent[][] {
    const batches: SecurityEvent[][] = [];
    for (let i = 0; i < events.length; i += this.batchSize) {
      batches.push(events.slice(i, i + this.batchSize));
    }
    return batches;
  }
}

// =============================================================================
// Connector Factory
// =============================================================================

/**
 * Factory function type for creating connectors
 */
export type ConnectorFactory<T extends SIEMConnector = SIEMConnector> = (
  config: BaseConnectorConfig
) => T;

/**
 * Registry of connector factories
 */
const connectorFactories = new Map<string, ConnectorFactory>();

/**
 * Register a connector factory
 */
export function registerConnectorFactory(
  type: string,
  factory: ConnectorFactory
): void {
  connectorFactories.set(type, factory);
  logger.debug({ type }, 'Registered SIEM connector factory');
}

/**
 * Get a connector factory by type
 */
export function getConnectorFactory(type: string): ConnectorFactory | undefined {
  return connectorFactories.get(type);
}

/**
 * Get all registered connector types
 */
export function getRegisteredConnectorTypes(): string[] {
  return Array.from(connectorFactories.keys());
}
