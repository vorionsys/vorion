/**
 * Grafana Loki SIEM Connector
 *
 * Primary connector for Loki (free/self-hosted SIEM).
 * Implements the Loki Push API for log ingestion with batching and retry.
 *
 * @see https://grafana.com/docs/loki/latest/api/#push-log-entries-to-loki
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import { gzip } from 'zlib';
import { promisify } from 'util';
import type {
  AuditEvent,
  ISIEMConnector,
  LokiPushRequest,
  LokiStream,
  SIEMConfig,
  SIEMConnectorStats,
} from './types.js';
import { SIEMConnectionError, SIEMBatchError } from './types.js';

const logger = createLogger({ component: 'siem-loki' });
const gzipAsync = promisify(gzip);

// =============================================================================
// LOKI CONNECTOR IMPLEMENTATION
// =============================================================================

/**
 * Grafana Loki connector for SIEM integration.
 *
 * Features:
 * - Push API support (/loki/api/v1/push)
 * - Structured JSON log lines
 * - Configurable labels (app, environment, severity)
 * - Automatic batching with flush interval
 * - Exponential backoff retry
 * - Gzip compression support
 */
export class LokiConnector implements ISIEMConnector {
  readonly provider = 'loki' as const;

  private config: SIEMConfig;
  private queue: AuditEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

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

    // Start the flush timer
    this.startFlushTimer();

    logger.info(
      {
        endpoint: config.endpoint,
        batchSize: config.batchSize,
        flushIntervalMs: config.flushIntervalMs,
        compression: config.compression,
      },
      'Loki connector initialized'
    );
  }

  /**
   * Check if Loki is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Loki's /ready endpoint is used for health checks
      const readyUrl = new URL('/ready', this.config.endpoint).toString();

      const response = await fetch(readyUrl, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      const isHealthy = response.ok;

      logger.debug({ isHealthy, status: response.status }, 'Loki health check');

      return isHealthy;
    } catch (error) {
      logger.warn({ error }, 'Loki health check failed');
      return false;
    }
  }

  /**
   * Send a single event to Loki
   */
  async sendEvent(event: AuditEvent): Promise<void> {
    if (this.isShuttingDown) {
      throw new SIEMConnectionError(
        'Connector is shutting down',
        'loki',
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
   * Send a batch of events to Loki
   */
  async sendBatch(events: AuditEvent[]): Promise<void> {
    if (this.isShuttingDown) {
      throw new SIEMConnectionError(
        'Connector is shutting down',
        'loki',
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
        await this.pushToLoki(events);

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
          'Batch sent to Loki'
        );

        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.stats.retryAttempts++;

        if (attempt < this.config.retryAttempts) {
          // Calculate delay with exponential backoff
          const delay = this.config.retryDelayMs * Math.pow(2, attempt);
          logger.warn(
            {
              attempt: attempt + 1,
              maxAttempts: this.config.retryAttempts + 1,
              delayMs: delay,
              error: lastError.message,
            },
            'Loki push failed, retrying'
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
      `Failed to send batch to Loki after ${this.config.retryAttempts + 1} attempts`,
      'loki',
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

    // Take all events from queue
    const events = this.queue.splice(0, this.queue.length);
    this.stats.queueSize = this.queue.length;

    try {
      await this.sendBatch(events);
    } catch (error) {
      logger.error(
        { error, eventsCount: events.length },
        'Failed to flush events to Loki'
      );
      // Events are lost after all retries fail
      throw error;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Loki connector');
    this.isShuttingDown = true;

    // Stop the flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining events
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
      'Loki connector shutdown complete'
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
          // Errors are already logged in flush()
        }
      }
    }, this.config.flushIntervalMs);

    // Unref so it doesn't keep the process alive
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
      return; // Event type not in filter
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
   * Push events to Loki's API
   */
  private async pushToLoki(events: AuditEvent[]): Promise<void> {
    const pushUrl = new URL('/loki/api/v1/push', this.config.endpoint).toString();

    // Build Loki push request
    const request = this.buildLokiRequest(events);

    // Serialize to JSON
    const body = JSON.stringify(request);

    // Optionally compress
    let finalBody: Buffer | string = body;
    const headers = this.buildHeaders();

    if (this.config.compression) {
      finalBody = await gzipAsync(body);
      headers['Content-Encoding'] = 'gzip';
    }

    // Send request - cast body for TypeScript compatibility
    const response = await fetch(pushUrl, {
      method: 'POST',
      headers,
      body: finalBody as BodyInit,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new SIEMConnectionError(
        `Loki push failed: ${response.status} ${response.statusText} - ${errorBody}`,
        'loki',
        pushUrl,
        response.status
      );
    }
  }

  /**
   * Build Loki push request from events
   */
  private buildLokiRequest(events: AuditEvent[]): LokiPushRequest {
    // Group events by labels (app, environment, severity)
    const streamMap = new Map<string, AuditEvent[]>();

    for (const event of events) {
      const labelKey = this.getLabelKey(event);
      const existing = streamMap.get(labelKey);
      if (existing) {
        existing.push(event);
      } else {
        streamMap.set(labelKey, [event]);
      }
    }

    // Build streams
    const streams: LokiStream[] = [];

    streamMap.forEach((groupedEvents, labelKey) => {
      const labels = this.parseLabelKey(labelKey);
      const values = groupedEvents.map((event) =>
        this.eventToLokiEntry(event)
      );

      streams.push({
        stream: labels,
        values,
      });
    });

    return { streams };
  }

  /**
   * Get a unique key for grouping events by labels
   */
  private getLabelKey(event: AuditEvent): string {
    return `${this.config.appLabel}|${this.config.environmentLabel}|${event.severity}|${event.category}`;
  }

  /**
   * Parse label key back to label object
   */
  private parseLabelKey(key: string): Record<string, string> {
    const [app, environment, severity, category] = key.split('|');
    return {
      app: app ?? this.config.appLabel,
      environment: environment ?? this.config.environmentLabel,
      severity: severity ?? 'info',
      category: category ?? 'system',
      job: 'vorion-audit',
    };
  }

  /**
   * Convert an audit event to a Loki log entry
   */
  private eventToLokiEntry(event: AuditEvent): [string, string] {
    // Loki expects nanosecond timestamps as strings
    const timestampNs = (event.timestamp.getTime() * 1_000_000).toString();

    // Build structured log line as JSON
    const logLine = JSON.stringify({
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
        source: event.metadata.source,
        tags: event.metadata.tags,
      },
      details: event.details,
    });

    return [timestampNs, logLine];
  }

  /**
   * Build HTTP headers for Loki requests
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const auth = this.config.authentication;

    switch (auth.type) {
      case 'basic':
        if (auth.username && auth.password) {
          const credentials = Buffer.from(
            `${auth.username}:${auth.password}`
          ).toString('base64');
          headers['Authorization'] = `Basic ${credentials}`;
        }
        break;

      case 'bearer':
        if (auth.token) {
          headers['Authorization'] = `Bearer ${auth.token}`;
        }
        break;

      case 'api-key':
        if (auth.apiKey) {
          headers['X-API-Key'] = auth.apiKey;
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

    // Keep only last 100 latencies for rolling average
    if (this.latencies.length > 100) {
      this.latencies.shift();
    }

    // Calculate average
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
 * Create a new Loki connector instance
 */
export function createLokiConnector(config: SIEMConfig): LokiConnector {
  return new LokiConnector(config);
}
