/**
 * Elasticsearch SIEM Connector
 *
 * Connector for Elasticsearch/OpenSearch integration.
 * Supports bulk API, configurable index patterns, and ECS-compatible format.
 *
 * @see https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-bulk.html
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import { gzip } from 'zlib';
import { promisify } from 'util';
import type {
  AuditEvent,
  ElasticAuditDocument,
  ElasticBulkAction,
  ISIEMConnector,
  SIEMConfig,
  SIEMConnectorStats,
} from './types.js';
import { SIEMConnectionError, SIEMBatchError } from './types.js';

const logger = createLogger({ component: 'siem-elastic' });
const gzipAsync = promisify(gzip);

// =============================================================================
// ELASTICSEARCH CONNECTOR IMPLEMENTATION
// =============================================================================

/**
 * Elasticsearch connector for SIEM integration.
 *
 * Features:
 * - Bulk API support for efficient indexing
 * - ECS (Elastic Common Schema) compatible document format
 * - Configurable index patterns with date rotation
 * - Automatic batching with flush interval
 * - Exponential backoff retry
 * - Gzip compression support
 */
export class ElasticConnector implements ISIEMConnector {
  readonly provider = 'elastic' as const;

  private config: SIEMConfig;
  private queue: AuditEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  // Elastic-specific config
  private indexPattern: string;

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

    // Index pattern with date substitution (e.g., vorion-audit-2024.01.29)
    this.indexPattern = `${config.appLabel}-audit`;

    // Start the flush timer
    this.startFlushTimer();

    logger.info(
      {
        endpoint: config.endpoint,
        batchSize: config.batchSize,
        flushIntervalMs: config.flushIntervalMs,
        indexPattern: this.indexPattern,
      },
      'Elasticsearch connector initialized'
    );
  }

  /**
   * Check if Elasticsearch is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Elasticsearch cluster health endpoint
      const healthUrl = new URL('/_cluster/health', this.config.endpoint).toString();

      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!response.ok) {
        return false;
      }

      const health = await response.json() as { status?: string };
      // Cluster is healthy if status is green or yellow
      const isHealthy = health.status === 'green' || health.status === 'yellow';

      logger.debug(
        { isHealthy, status: health.status },
        'Elasticsearch health check'
      );

      return isHealthy;
    } catch (error) {
      logger.warn({ error }, 'Elasticsearch health check failed');
      return false;
    }
  }

  /**
   * Send a single event to Elasticsearch
   */
  async sendEvent(event: AuditEvent): Promise<void> {
    if (this.isShuttingDown) {
      throw new SIEMConnectionError(
        'Connector is shutting down',
        'elastic',
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
   * Send a batch of events to Elasticsearch
   */
  async sendBatch(events: AuditEvent[]): Promise<void> {
    if (this.isShuttingDown) {
      throw new SIEMConnectionError(
        'Connector is shutting down',
        'elastic',
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
        const failedCount = await this.pushToElastic(events);

        // Update stats
        const latency = Date.now() - startTime;
        this.updateLatencyStats(latency);
        this.stats.eventsSent += events.length - failedCount;
        this.stats.eventsFailed += failedCount;
        this.stats.batchesSent++;
        this.stats.lastSuccessAt = new Date();

        logger.debug(
          {
            eventsCount: events.length,
            failedCount,
            latencyMs: latency,
            attempt: attempt + 1,
          },
          'Batch sent to Elasticsearch'
        );

        // If some events failed, we don't retry (they're logged in bulk response)
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
            'Elasticsearch push failed, retrying'
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
      `Failed to send batch to Elasticsearch after ${this.config.retryAttempts + 1} attempts`,
      'elastic',
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
        'Failed to flush events to Elasticsearch'
      );
      throw error;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Elasticsearch connector');
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
      'Elasticsearch connector shutdown complete'
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
   * Push events to Elasticsearch bulk API
   * Returns the number of failed documents
   */
  private async pushToElastic(events: AuditEvent[]): Promise<number> {
    const bulkUrl = new URL('/_bulk', this.config.endpoint).toString();

    // Build bulk request body (newline-delimited JSON)
    const bulkLines: string[] = [];

    for (const event of events) {
      // Action line
      const action: ElasticBulkAction = {
        index: {
          _index: this.getIndexName(event.timestamp),
          _id: event.id,
        },
      };
      bulkLines.push(JSON.stringify(action));

      // Document line
      const doc = this.eventToElasticDocument(event);
      bulkLines.push(JSON.stringify(doc));
    }

    // Bulk body must end with newline
    const body = bulkLines.join('\n') + '\n';

    // Optionally compress
    let finalBody: Buffer | string = body;
    const headers = this.buildHeaders();
    headers['Content-Type'] = 'application/x-ndjson';

    if (this.config.compression) {
      finalBody = await gzipAsync(body);
      headers['Content-Encoding'] = 'gzip';
    }

    // Send request - cast body for TypeScript compatibility
    const response = await fetch(bulkUrl, {
      method: 'POST',
      headers,
      body: finalBody as BodyInit,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new SIEMConnectionError(
        `Elasticsearch bulk push failed: ${response.status} ${response.statusText} - ${errorBody}`,
        'elastic',
        bulkUrl,
        response.status
      );
    }

    // Parse bulk response to count failures
    const result = await response.json() as {
      errors?: boolean;
      items?: Array<{
        index?: {
          status?: number;
          error?: { type?: string; reason?: string };
        };
      }>;
    };

    if (!result.errors) {
      return 0;
    }

    // Count and log failures
    let failedCount = 0;
    for (const item of result.items ?? []) {
      const indexResult = item.index;
      if (indexResult?.status && indexResult.status >= 400) {
        failedCount++;
        logger.warn(
          {
            status: indexResult.status,
            error: indexResult.error,
          },
          'Elasticsearch document indexing failed'
        );
      }
    }

    return failedCount;
  }

  /**
   * Get the index name for a timestamp (with date rotation)
   */
  private getIndexName(timestamp: Date): string {
    const year = timestamp.getFullYear();
    const month = String(timestamp.getMonth() + 1).padStart(2, '0');
    const day = String(timestamp.getDate()).padStart(2, '0');

    return `${this.indexPattern}-${year}.${month}.${day}`;
  }

  /**
   * Convert an audit event to Elasticsearch ECS-compatible format
   */
  private eventToElasticDocument(event: AuditEvent): ElasticAuditDocument {
    return {
      '@timestamp': event.timestamp.toISOString(),
      event: {
        id: event.id,
        type: event.type,
        category: event.category,
        severity: event.severity,
        outcome: event.outcome,
        action: event.action,
      },
      user: event.actor.userId
        ? {
            id: event.actor.userId,
            name: event.actor.userId, // Could be enriched with actual username
          }
        : undefined,
      source: {
        ip: event.actor.ipAddress,
        user_agent: event.actor.userAgent,
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
        tenantId: event.actor.tenantId,
        sessionId: event.actor.sessionId,
        agentId: event.actor.agentId,
        actorType: event.actor.actorType,
        environment: this.config.environmentLabel,
      },
      details: event.details,
    };
  }

  /**
   * Build HTTP headers for Elasticsearch requests
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
          // Elasticsearch API key format
          headers['Authorization'] = `ApiKey ${auth.apiKey}`;
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
 * Create a new Elasticsearch connector instance
 */
export function createElasticConnector(config: SIEMConfig): ElasticConnector {
  return new ElasticConnector(config);
}
