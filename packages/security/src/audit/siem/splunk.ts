/**
 * Splunk HEC SIEM Connector
 *
 * Connector for Splunk HTTP Event Collector (HEC) integration.
 * Supports batching, retry, and configurable indexing.
 *
 * @see https://docs.splunk.com/Documentation/Splunk/latest/Data/FormateventsforHTTPEventCollector
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import { gzip } from 'zlib';
import { promisify } from 'util';
import type {
  AuditEvent,
  ISIEMConnector,
  SIEMConfig,
  SIEMConnectorStats,
  SplunkHECEvent,
} from './types.js';
import { SIEMConnectionError, SIEMBatchError } from './types.js';

const logger = createLogger({ component: 'siem-splunk' });
const gzipAsync = promisify(gzip);

// =============================================================================
// SPLUNK HEC CONNECTOR IMPLEMENTATION
// =============================================================================

/**
 * Splunk HEC connector for SIEM integration.
 *
 * Features:
 * - HEC event endpoint support
 * - Configurable source, sourcetype, and index
 * - Automatic batching with flush interval
 * - Exponential backoff retry
 * - Gzip compression support
 * - Token-based authentication
 */
export class SplunkConnector implements ISIEMConnector {
  readonly provider = 'splunk' as const;

  private config: SIEMConfig;
  private queue: AuditEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  // Splunk-specific config
  private source: string;
  private sourcetype: string;
  private index: string;

  // Statistics
  private stats: SIEMConnectorStats = {
    eventsSent: 0,
    eventsFailed: 0,
    batchesSent: 0,
    queueSize: 0,
    avgLatencyMs: 0,
    eventsDropped: 0,
    retryAttempts: 0,
  };
  private latencies: number[] = [];

  constructor(config: SIEMConfig) {
    this.config = config;

    // Splunk-specific settings (can be overridden via endpoint query params)
    this.source = config.appLabel;
    this.sourcetype = 'vorion:audit';
    this.index = 'main'; // Default Splunk index

    // Start the flush timer
    this.startFlushTimer();

    logger.info(
      {
        endpoint: config.endpoint,
        batchSize: config.batchSize,
        flushIntervalMs: config.flushIntervalMs,
        source: this.source,
        sourcetype: this.sourcetype,
      },
      'Splunk HEC connector initialized'
    );
  }

  /**
   * Check if Splunk HEC is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Splunk HEC health check endpoint
      const healthUrl = new URL(
        '/services/collector/health',
        this.config.endpoint
      ).toString();

      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      const isHealthy = response.ok;

      logger.debug({ isHealthy, status: response.status }, 'Splunk health check');

      return isHealthy;
    } catch (error) {
      logger.warn({ error }, 'Splunk health check failed');
      return false;
    }
  }

  /**
   * Send a single event to Splunk
   */
  async sendEvent(event: AuditEvent): Promise<void> {
    if (this.isShuttingDown) {
      throw new SIEMConnectionError(
        'Connector is shutting down',
        'splunk',
        this.config.endpoint
      );
    }

    // Add to queue
    this.addToQueue(event);

    // Flush if batch size reached
    if (this.queue.length >= this.config.batchSize) {
      await this.flush();
    }
  }

  /**
   * Send a batch of events to Splunk
   */
  async sendBatch(events: AuditEvent[]): Promise<void> {
    if (this.isShuttingDown) {
      throw new SIEMConnectionError(
        'Connector is shutting down',
        'splunk',
        this.config.endpoint
      );
    }

    if (events.length === 0) {
      return;
    }

    const startTime = Date.now();
    let lastError: Error | undefined;

    // Retry loop with exponential backoff
    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      try {
        await this.pushToSplunk(events);

        // Success - update stats
        const latency = Date.now() - startTime;
        this.updateLatencyStats(latency);
        this.stats.eventsSent += events.length;
        this.stats.batchesSent++;
        this.stats.lastSuccessAt = new Date();

        logger.debug(
          {
            eventsCount: events.length,
            latencyMs: latency,
            attempt: attempt + 1,
          },
          'Batch sent to Splunk'
        );

        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.stats.retryAttempts++;

        if (attempt < this.config.retryAttempts) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt);
          logger.warn(
            {
              attempt: attempt + 1,
              maxAttempts: this.config.retryAttempts + 1,
              delayMs: delay,
              error: lastError.message,
            },
            'Splunk push failed, retrying'
          );
          await this.sleep(delay);
        }
      }
    }

    // All retries failed
    this.stats.eventsFailed += events.length;
    this.stats.lastErrorAt = new Date();
    this.stats.lastError = lastError?.message ?? 'Unknown error';

    throw new SIEMBatchError(
      `Failed to send batch to Splunk after ${this.config.retryAttempts + 1} attempts`,
      'splunk',
      events.length,
      events.length,
      lastError
    );
  }

  /**
   * Flush all queued events
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) {
      return;
    }

    const events = this.queue.splice(0, this.queue.length);
    this.stats.queueSize = this.queue.length;

    try {
      await this.sendBatch(events);
    } catch (error) {
      logger.error(
        { error, eventsCount: events.length },
        'Failed to flush events to Splunk'
      );
      throw error;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Splunk connector');
    this.isShuttingDown = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    try {
      await this.flush();
    } catch (error) {
      logger.error({ error }, 'Error flushing events during shutdown');
    }

    logger.info(
      {
        eventsSent: this.stats.eventsSent,
        eventsFailed: this.stats.eventsFailed,
        eventsDropped: this.stats.eventsDropped,
      },
      'Splunk connector shutdown complete'
    );
  }

  /**
   * Get connector statistics
   */
  getStats(): SIEMConnectorStats {
    return {
      ...this.stats,
      queueSize: this.queue.length,
    };
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Start the periodic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(async () => {
      if (this.queue.length > 0 && !this.isShuttingDown) {
        try {
          await this.flush();
        } catch (error) {
          // Errors are logged in flush()
        }
      }
    }, this.config.flushIntervalMs);

    this.flushTimer.unref();
  }

  /**
   * Add event to queue with overflow protection
   */
  private addToQueue(event: AuditEvent): void {
    // Check event type filter
    if (
      this.config.eventTypes.length > 0 &&
      !this.config.eventTypes.includes(event.type)
    ) {
      return;
    }

    // Check queue overflow
    if (this.queue.length >= this.config.maxQueueSize) {
      this.stats.eventsDropped++;
      logger.warn(
        {
          queueSize: this.queue.length,
          maxQueueSize: this.config.maxQueueSize,
        },
        'Event dropped due to queue overflow'
      );
      return;
    }

    this.queue.push(event);
    this.stats.queueSize = this.queue.length;
  }

  /**
   * Push events to Splunk HEC
   */
  private async pushToSplunk(events: AuditEvent[]): Promise<void> {
    const hecUrl = new URL(
      '/services/collector/event',
      this.config.endpoint
    ).toString();

    // Build HEC event batch (newline-delimited JSON)
    const hecEvents = events.map((event) => this.eventToHECEvent(event));
    const body = hecEvents.map((e) => JSON.stringify(e)).join('\n');

    // Optionally compress
    let finalBody: Buffer | string = body;
    const headers = this.buildHeaders();

    if (this.config.compression) {
      finalBody = await gzipAsync(body);
      headers['Content-Encoding'] = 'gzip';
    }

    // Send request - cast body for TypeScript compatibility
    const response = await fetch(hecUrl, {
      method: 'POST',
      headers,
      body: finalBody as BodyInit,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new SIEMConnectionError(
        `Splunk HEC push failed: ${response.status} ${response.statusText} - ${errorBody}`,
        'splunk',
        hecUrl,
        response.status
      );
    }

    // Check Splunk response for partial failures
    const result = await response.json().catch(() => ({})) as { text?: string; code?: number };
    if (result.code !== undefined && result.code !== 0) {
      throw new SIEMConnectionError(
        `Splunk HEC error: ${result.text ?? 'Unknown error'}`,
        'splunk',
        hecUrl,
        result.code
      );
    }
  }

  /**
   * Convert an audit event to Splunk HEC format
   */
  private eventToHECEvent(event: AuditEvent): SplunkHECEvent {
    return {
      time: event.timestamp.getTime() / 1000, // Splunk expects epoch seconds
      host: event.metadata.source ?? 'vorion',
      source: this.source,
      sourcetype: this.sourcetype,
      index: this.index,
      event: {
        id: event.id,
        type: event.type,
        category: event.category,
        severity: event.severity,
        action: event.action,
        outcome: event.outcome,
        actor: {
          userId: event.actor.userId,
          tenantId: event.actor.tenantId,
          ipAddress: event.actor.ipAddress,
          userAgent: event.actor.userAgent,
          sessionId: event.actor.sessionId,
          actorType: event.actor.actorType,
        },
        resource: {
          type: event.resource.type,
          id: event.resource.id,
          name: event.resource.name,
        },
        metadata: {
          requestId: event.metadata.requestId,
          traceId: event.metadata.traceId,
          spanId: event.metadata.spanId,
          correlationId: event.metadata.correlationId,
          tags: event.metadata.tags,
        },
        details: event.details,
      },
      fields: {
        environment: this.config.environmentLabel,
        severity: event.severity,
        category: event.category,
        eventType: event.type,
        tenantId: event.actor.tenantId ?? '',
      },
    };
  }

  /**
   * Build HTTP headers for Splunk HEC requests
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const auth = this.config.authentication;

    // Splunk HEC primarily uses token auth via Authorization header
    switch (auth.type) {
      case 'bearer':
        if (auth.token) {
          headers['Authorization'] = `Splunk ${auth.token}`;
        }
        break;

      case 'api-key':
        if (auth.apiKey) {
          headers['Authorization'] = `Splunk ${auth.apiKey}`;
        }
        break;

      case 'basic':
        // Basic auth is less common for HEC but supported
        if (auth.username && auth.password) {
          const credentials = Buffer.from(
            `${auth.username}:${auth.password}`
          ).toString('base64');
          headers['Authorization'] = `Basic ${credentials}`;
        }
        break;
    }

    return headers;
  }

  /**
   * Update latency statistics
   */
  private updateLatencyStats(latencyMs: number): void {
    this.latencies.push(latencyMs);

    if (this.latencies.length > 100) {
      this.latencies.shift();
    }

    const sum = this.latencies.reduce((a, b) => a + b, 0);
    this.stats.avgLatencyMs = Math.round(sum / this.latencies.length);
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a new Splunk HEC connector instance
 */
export function createSplunkConnector(config: SIEMConfig): SplunkConnector {
  return new SplunkConnector(config);
}
