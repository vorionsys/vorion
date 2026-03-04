/**
 * SIEM Service
 *
 * Main orchestration layer for SIEM integration:
 * - Register multiple connectors
 * - Fan-out events to all active connectors
 * - Buffering and batching (100 events or 5 seconds)
 * - Circuit breaker per connector
 * - Metrics: events sent, failures, latency
 *
 * @packageDocumentation
 * @module security/siem/service
 */

import { createLogger } from '../../common/logger.js';
import { vorionRegistry } from '../../common/metrics-registry.js';
import { Counter, Histogram, Gauge } from 'prom-client';
import { v4 as uuidv4 } from 'uuid';
import type { SIEMConnector } from './connector.js';
import { createSplunkConnector } from './splunk.js';
import { createElasticConnector } from './elastic.js';
import { createDatadogConnector } from './datadog.js';
import { EventEnricher, createNoOpEnricher } from './enrichment.js';
import { EventFormatter } from './formatter.js';
import type {
  SecurityEvent,
  SendResult,
  SIEMConfig,
  SIEMMetrics,
  ConnectorConfig,
  EventCategory,
  EventSeverity,
  EventOutcome,
  IntegrationHook,
  EventFilter,
  EventTransformer,
} from './types.js';
import { DEFAULT_SIEM_CONFIG } from './types.js';

const logger = createLogger({ component: 'siem-service' });

// =============================================================================
// Metrics
// =============================================================================

const eventsSentTotal = new Counter({
  name: 'vorion_siem_events_sent_total',
  help: 'Total number of events sent to SIEM connectors',
  labelNames: ['connector', 'status'] as const,
  registers: [vorionRegistry],
});

const eventsFailedTotal = new Counter({
  name: 'vorion_siem_events_failed_total',
  help: 'Total number of events that failed to send',
  labelNames: ['connector', 'reason'] as const,
  registers: [vorionRegistry],
});

const batchesSentTotal = new Counter({
  name: 'vorion_siem_batches_sent_total',
  help: 'Total number of batches sent to SIEM connectors',
  labelNames: ['connector', 'status'] as const,
  registers: [vorionRegistry],
});

const sendLatency = new Histogram({
  name: 'vorion_siem_send_duration_seconds',
  help: 'Time taken to send events to SIEM connectors',
  labelNames: ['connector'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [vorionRegistry],
});

const bufferSize = new Gauge({
  name: 'vorion_siem_buffer_size',
  help: 'Current number of events in the buffer',
  registers: [vorionRegistry],
});

const connectorStatus = new Gauge({
  name: 'vorion_siem_connector_status',
  help: 'Connector status (1=connected, 0=disconnected, -1=circuit_open)',
  labelNames: ['connector'] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// Circuit Breaker State
// =============================================================================

interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half_open';
  failures: number;
  lastFailure: number | null;
  openedAt: number | null;
}

// =============================================================================
// SIEM Service
// =============================================================================

/**
 * SIEM Service for managing SIEM connectors and event forwarding
 */
export class SIEMService {
  private readonly config: SIEMConfig;
  private readonly connectors = new Map<string, SIEMConnector>();
  private readonly circuitBreakers = new Map<string, CircuitBreakerState>();
  private readonly enricher: EventEnricher;
  private readonly formatter: EventFormatter;
  private readonly hooks = new Map<string, IntegrationHook>();

  // Event buffer
  private buffer: SecurityEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;

  // Metrics tracking
  private totalEventsSent = 0;
  private totalEventsFailed = 0;
  private totalBatchesSent = 0;
  private totalBatchesFailed = 0;
  private latencySum = 0;
  private latencyCount = 0;
  private lastSendTime?: Date;
  private lastError?: string;

  constructor(config: Partial<SIEMConfig> = {}) {
    this.config = {
      ...DEFAULT_SIEM_CONFIG,
      ...config,
      connectors: config.connectors ?? [],
      enabledEventTypes: config.enabledEventTypes ?? [],
      enrichment: config.enrichment ?? {},
    } as SIEMConfig;

    // Initialize enricher
    if (
      this.config.enrichment.geo?.enabled ||
      this.config.enrichment.threat?.enabled ||
      this.config.enrichment.user?.enabled
    ) {
      this.enricher = new EventEnricher(this.config.enrichment);
    } else {
      this.enricher = createNoOpEnricher();
    }

    // Initialize formatter
    this.formatter = new EventFormatter({
      cef: this.config.cef,
      syslog: this.config.syslog,
    });

    // Initialize connectors from config
    this.initializeConnectors();

    // Start flush timer
    this.startFlushTimer();

    logger.info(
      {
        connectorCount: this.connectors.size,
        batchSize: this.config.batchSize,
        flushIntervalMs: this.config.flushIntervalMs,
      },
      'SIEMService initialized'
    );
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Send a security event to all active connectors
   */
  async send(event: SecurityEvent): Promise<void> {
    // Check if event type is enabled
    if (!this.isEventTypeEnabled(event.eventType)) {
      logger.debug(
        { eventType: event.eventType },
        'Event type not enabled, skipping'
      );
      return;
    }

    // Apply hooks
    let processedEvent = event;
    const hookValues = Array.from(this.hooks.values());
    for (const hook of hookValues) {
      if (!hook.enabled) continue;

      // Check event type filter
      if (hook.eventTypes.length > 0 && !hook.eventTypes.includes(event.eventType)) {
        continue;
      }

      // Apply filter
      if (hook.filter && !hook.filter(processedEvent)) {
        continue;
      }

      // Apply transformer
      if (hook.transformer) {
        processedEvent = hook.transformer(processedEvent);
      }
    }

    // Enrich event
    const enrichmentResult = await this.enricher.enrich(processedEvent);
    processedEvent = enrichmentResult.event;

    if (enrichmentResult.errors.length > 0) {
      logger.debug(
        { errors: enrichmentResult.errors },
        'Event enrichment had errors'
      );
    }

    // Add to buffer
    this.buffer.push(processedEvent);
    bufferSize.set(this.buffer.length);

    // Debug logging
    if (this.config.debugLogging) {
      logger.debug(
        {
          eventId: processedEvent.id,
          eventType: processedEvent.eventType,
          bufferSize: this.buffer.length,
        },
        'Event added to buffer'
      );
    }

    // Flush if buffer is full
    if (this.buffer.length >= this.config.batchSize) {
      await this.flush();
    }
  }

  /**
   * Send multiple events
   */
  async sendBatch(events: SecurityEvent[]): Promise<void> {
    for (const event of events) {
      await this.send(event);
    }
  }

  /**
   * Flush the event buffer to all connectors
   */
  async flush(): Promise<Map<string, SendResult>> {
    if (this.flushing || this.buffer.length === 0) {
      return new Map();
    }

    this.flushing = true;
    const events = [...this.buffer];
    this.buffer = [];
    bufferSize.set(0);

    const results = new Map<string, SendResult>();

    try {
      // Send to all connectors in parallel
      const promises = Array.from(this.connectors.entries()).map(
        async ([name, connector]) => {
          // Check circuit breaker
          if (this.isCircuitOpen(name)) {
            logger.debug({ connector: name }, 'Circuit breaker is open, skipping');
            connectorStatus.set({ connector: name }, -1);
            return {
              name,
              result: {
                success: false,
                eventsSent: 0,
                eventsFailed: events.length,
                error: 'Circuit breaker is open',
                durationMs: 0,
              } as SendResult,
            };
          }

          const startTime = Date.now();

          try {
            const result = await connector.send(events);
            const duration = Date.now() - startTime;

            // Record metrics
            sendLatency.observe({ connector: name }, duration / 1000);

            if (result.success) {
              eventsSentTotal.inc(
                { connector: name, status: 'success' },
                result.eventsSent
              );
              batchesSentTotal.inc({ connector: name, status: 'success' });
              this.totalEventsSent += result.eventsSent;
              this.totalBatchesSent++;
              this.recordCircuitBreakerSuccess(name);
              connectorStatus.set({ connector: name }, 1);
            } else {
              eventsSentTotal.inc(
                { connector: name, status: 'partial' },
                result.eventsSent
              );
              eventsFailedTotal.inc(
                { connector: name, reason: 'send_error' },
                result.eventsFailed
              );
              this.totalEventsFailed += result.eventsFailed;
              this.recordCircuitBreakerFailure(name);
            }

            this.latencySum += duration;
            this.latencyCount++;
            this.lastSendTime = new Date();

            return { name, result };
          } catch (error) {
            const duration = Date.now() - startTime;

            eventsFailedTotal.inc(
              { connector: name, reason: 'exception' },
              events.length
            );
            batchesSentTotal.inc({ connector: name, status: 'error' });
            this.totalEventsFailed += events.length;
            this.totalBatchesFailed++;
            this.lastError = (error as Error).message;

            this.recordCircuitBreakerFailure(name);
            connectorStatus.set({ connector: name }, 0);

            logger.error(
              { connector: name, error: (error as Error).message, duration },
              'Failed to send events to connector'
            );

            return {
              name,
              result: {
                success: false,
                eventsSent: 0,
                eventsFailed: events.length,
                error: (error as Error).message,
                durationMs: duration,
              } as SendResult,
            };
          }
        }
      );

      const settledResults = await Promise.all(promises);

      for (const { name, result } of settledResults) {
        results.set(name, result);
      }
    } finally {
      this.flushing = false;
    }

    return results;
  }

  /**
   * Register a connector
   */
  registerConnector(connector: SIEMConnector): void {
    if (this.connectors.has(connector.name)) {
      throw new Error(`Connector '${connector.name}' is already registered`);
    }

    this.connectors.set(connector.name, connector);
    this.initializeCircuitBreaker(connector.name);
    connectorStatus.set({ connector: connector.name }, 0);

    logger.info(
      { connector: connector.name, type: connector.type },
      'Connector registered'
    );
  }

  /**
   * Unregister a connector
   */
  async unregisterConnector(name: string): Promise<void> {
    const connector = this.connectors.get(name);
    if (!connector) {
      return;
    }

    // Disconnect if connected
    if (connector.isConnected()) {
      await connector.disconnect();
    }

    this.connectors.delete(name);
    this.circuitBreakers.delete(name);

    logger.info({ connector: name }, 'Connector unregistered');
  }

  /**
   * Get a connector by name
   */
  getConnector(name: string): SIEMConnector | undefined {
    return this.connectors.get(name);
  }

  /**
   * Get all connector names
   */
  getConnectorNames(): string[] {
    return Array.from(this.connectors.keys());
  }

  /**
   * Connect all connectors
   */
  async connectAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const entries = Array.from(this.connectors.entries());

    for (const [name, connector] of entries) {
      try {
        await connector.connect();
        results.set(name, true);
        connectorStatus.set({ connector: name }, 1);
      } catch (error) {
        logger.error(
          { connector: name, error: (error as Error).message },
          'Failed to connect connector'
        );
        results.set(name, false);
        connectorStatus.set({ connector: name }, 0);
      }
    }

    return results;
  }

  /**
   * Disconnect all connectors
   */
  async disconnectAll(): Promise<void> {
    const entries = Array.from(this.connectors.entries());

    for (const [name, connector] of entries) {
      try {
        await connector.disconnect();
        connectorStatus.set({ connector: name }, 0);
      } catch (error) {
        logger.error(
          { connector: name, error: (error as Error).message },
          'Error disconnecting connector'
        );
      }
    }
  }

  /**
   * Health check all connectors
   */
  async healthCheckAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const entries = Array.from(this.connectors.entries());

    for (const [name, connector] of entries) {
      const healthy = await connector.healthCheck();
      results.set(name, healthy);
    }

    return results;
  }

  /**
   * Add an integration hook
   */
  addHook(hook: IntegrationHook): void {
    this.hooks.set(hook.name, hook);
    logger.info(
      { hookName: hook.name, eventTypes: hook.eventTypes },
      'Integration hook added'
    );
  }

  /**
   * Remove an integration hook
   */
  removeHook(name: string): void {
    this.hooks.delete(name);
  }

  /**
   * Get service metrics
   */
  getMetrics(): SIEMMetrics {
    const connectorStatuses: Record<
      string,
      'connected' | 'disconnected' | 'circuit_open'
    > = {};
    const entries = Array.from(this.connectors.entries());

    for (const [name, connector] of entries) {
      if (this.isCircuitOpen(name)) {
        connectorStatuses[name] = 'circuit_open';
      } else if (connector.isConnected()) {
        connectorStatuses[name] = 'connected';
      } else {
        connectorStatuses[name] = 'disconnected';
      }
    }

    return {
      eventsSent: this.totalEventsSent,
      eventsFailed: this.totalEventsFailed,
      batchesSent: this.totalBatchesSent,
      batchesFailed: this.totalBatchesFailed,
      avgLatencyMs:
        this.latencyCount > 0
          ? Math.round(this.latencySum / this.latencyCount)
          : 0,
      bufferSize: this.buffer.length,
      connectorStatus: connectorStatuses,
      lastSendTime: this.lastSendTime,
      lastError: this.lastError,
    };
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    // Stop flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining events
    if (this.buffer.length > 0) {
      await this.flush();
    }

    // Disconnect all connectors
    await this.disconnectAll();

    logger.info('SIEMService shutdown complete');
  }

  // ===========================================================================
  // Helper Methods for Creating Events
  // ===========================================================================

  /**
   * Create a security event with defaults
   */
  createEvent(params: {
    eventType: string;
    category: EventCategory;
    severity: EventSeverity;
    outcome: EventOutcome;
    message: string;
    sourceIp?: string;
    userId?: string;
    tenantId?: string;
    customFields?: Record<string, unknown>;
  }): SecurityEvent {
    return {
      id: uuidv4(),
      timestamp: new Date(),
      eventType: params.eventType,
      category: params.category,
      severity: params.severity,
      outcome: params.outcome,
      message: params.message,
      source: 'vorion',
      sourceIp: params.sourceIp,
      user: params.userId || params.tenantId
        ? {
            userId: params.userId,
            tenantId: params.tenantId,
          }
        : undefined,
      customFields: params.customFields,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Initialize connectors from configuration
   */
  private initializeConnectors(): void {
    for (const connectorConfig of this.config.connectors) {
      if (!connectorConfig.enabled) {
        continue;
      }

      try {
        const connector = this.createConnector(connectorConfig);
        this.connectors.set(connector.name, connector);
        this.initializeCircuitBreaker(connector.name);
        connectorStatus.set({ connector: connector.name }, 0);
      } catch (error) {
        logger.error(
          { config: connectorConfig, error: (error as Error).message },
          'Failed to create connector'
        );
      }
    }
  }

  /**
   * Create a connector from configuration
   */
  private createConnector(config: ConnectorConfig): SIEMConnector {
    switch (config.type) {
      case 'splunk':
        return createSplunkConnector(config);
      case 'elastic':
        return createElasticConnector(config);
      case 'datadog':
        return createDatadogConnector(config);
      default:
        throw new Error(`Unknown connector type: ${(config as { type: string }).type}`);
    }
  }

  /**
   * Start the flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      if (this.buffer.length > 0) {
        this.flush().catch((error) => {
          logger.error({ error: (error as Error).message }, 'Flush timer error');
        });
      }
    }, this.config.flushIntervalMs);
  }

  /**
   * Check if event type is enabled
   */
  private isEventTypeEnabled(eventType: string): boolean {
    if (this.config.enabledEventTypes.length === 0) {
      return true; // All types enabled if empty
    }
    return this.config.enabledEventTypes.includes(eventType);
  }

  // ===========================================================================
  // Circuit Breaker Methods
  // ===========================================================================

  /**
   * Initialize circuit breaker for a connector
   */
  private initializeCircuitBreaker(name: string): void {
    this.circuitBreakers.set(name, {
      state: 'closed',
      failures: 0,
      lastFailure: null,
      openedAt: null,
    });
  }

  /**
   * Check if circuit breaker is open
   */
  private isCircuitOpen(name: string): boolean {
    const state = this.circuitBreakers.get(name);
    if (!state) {
      return false;
    }

    if (state.state === 'closed') {
      return false;
    }

    if (state.state === 'open' && state.openedAt) {
      const elapsed = Date.now() - state.openedAt;
      if (elapsed >= this.config.circuitBreakerResetMs!) {
        // Transition to half-open
        state.state = 'half_open';
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Record circuit breaker success
   */
  private recordCircuitBreakerSuccess(name: string): void {
    const state = this.circuitBreakers.get(name);
    if (!state) {
      return;
    }

    if (state.state === 'half_open') {
      // Successful call in half-open -> close circuit
      state.state = 'closed';
      state.failures = 0;
      state.lastFailure = null;
      state.openedAt = null;

      logger.info(
        { connector: name },
        'Circuit breaker closed after successful recovery'
      );
    } else if (state.state === 'closed') {
      // Reset failure count on success
      state.failures = 0;
    }
  }

  /**
   * Record circuit breaker failure
   */
  private recordCircuitBreakerFailure(name: string): void {
    const state = this.circuitBreakers.get(name);
    if (!state) {
      return;
    }

    state.failures++;
    state.lastFailure = Date.now();

    if (state.state === 'half_open') {
      // Failure in half-open -> reopen circuit
      state.state = 'open';
      state.openedAt = Date.now();

      logger.warn({ connector: name }, 'Circuit breaker reopened after half-open failure');
    } else if (
      state.state === 'closed' &&
      state.failures >= this.config.circuitBreakerThreshold!
    ) {
      // Too many failures -> open circuit
      state.state = 'open';
      state.openedAt = Date.now();

      logger.warn(
        { connector: name, failures: state.failures },
        'Circuit breaker opened due to failures'
      );
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let serviceInstance: SIEMService | null = null;

/**
 * Get or create the singleton SIEMService instance
 */
export function getSIEMService(config?: Partial<SIEMConfig>): SIEMService {
  if (!serviceInstance) {
    serviceInstance = new SIEMService(config);
  }
  return serviceInstance;
}

/**
 * Reset the singleton instance (primarily for testing)
 */
export async function resetSIEMService(): Promise<void> {
  if (serviceInstance) {
    await serviceInstance.shutdown();
    serviceInstance = null;
  }
}

/**
 * Create a new SIEMService instance (non-singleton)
 */
export function createSIEMService(config?: Partial<SIEMConfig>): SIEMService {
  return new SIEMService(config);
}
