/**
 * SIEM Integration Module
 *
 * Provides unified SIEM (Security Information and Event Management) integration
 * for audit event forwarding. Supports multiple providers:
 *
 * - **Loki** (primary, free/self-hosted) - Grafana Loki push API
 * - **Splunk** - HTTP Event Collector (HEC)
 * - **Elastic** - Elasticsearch/OpenSearch bulk API
 *
 * @example
 * ```typescript
 * import { SIEMConnector, SIEMConfigSchema } from './audit/siem';
 *
 * const config = SIEMConfigSchema.parse({
 *   enabled: true,
 *   provider: 'loki',
 *   endpoint: 'http://loki:3100',
 *   batchSize: 100,
 *   flushIntervalMs: 5000,
 * });
 *
 * const siem = new SIEMConnector(config);
 * await siem.initialize();
 *
 * // Send audit events
 * await siem.sendEvent({
 *   id: crypto.randomUUID(),
 *   timestamp: new Date(),
 *   type: 'USER_LOGIN',
 *   category: 'authentication',
 *   severity: 'info',
 *   actor: { ipAddress: '192.168.1.1', actorType: 'user' },
 *   resource: { type: 'session', id: 'sess-123' },
 *   action: 'login',
 *   outcome: 'success',
 *   details: {},
 *   metadata: { requestId: 'req-123' },
 * });
 *
 * // Graceful shutdown
 * await siem.shutdown();
 * ```
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import type {
  AuditEvent,
  ISIEMConnector,
  SIEMConfig,
  SIEMConnectorStats,
  SIEMProvider,
} from './types.js';
import { SIEMConfigSchema, SIEMConfigurationError, AuditEventSchema } from './types.js';
import { createLokiConnector, LokiConnector } from './loki.js';
import { createSplunkConnector, SplunkConnector } from './splunk.js';
import { createElasticConnector, ElasticConnector } from './elastic.js';

const logger = createLogger({ component: 'siem' });

// =============================================================================
// MAIN SIEM CONNECTOR CLASS
// =============================================================================

/**
 * Unified SIEM connector that provides a single interface for all providers.
 *
 * This is the main entry point for SIEM integration. It handles:
 * - Configuration validation
 * - Provider-specific connector initialization
 * - Event validation before sending
 * - Graceful shutdown coordination
 *
 * @example
 * ```typescript
 * const siem = new SIEMConnector({
 *   enabled: true,
 *   provider: 'loki',
 *   endpoint: 'http://loki:3100',
 * });
 *
 * await siem.initialize();
 * await siem.sendEvent(auditEvent);
 * await siem.shutdown();
 * ```
 */
export class SIEMConnector implements ISIEMConnector {
  readonly provider: SIEMProvider;

  private config: SIEMConfig;
  private connector: ISIEMConnector | null = null;
  private isInitialized = false;

  /**
   * Create a new SIEM connector
   *
   * @param config - SIEM configuration (will be validated with Zod)
   * @throws SIEMConfigurationError if configuration is invalid
   */
  constructor(config: Partial<SIEMConfig> & { endpoint: string }) {
    // Validate configuration
    const result = SIEMConfigSchema.safeParse(config);
    if (!result.success) {
      const errors = result.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join(', ');
      throw new SIEMConfigurationError(
        `Invalid SIEM configuration: ${errors}`,
        config.provider ?? 'loki'
      );
    }

    this.config = result.data;
    this.provider = this.config.provider;

    logger.info(
      {
        provider: this.provider,
        enabled: this.config.enabled,
        endpoint: this.config.endpoint,
      },
      'SIEM connector created'
    );
  }

  /**
   * Initialize the provider-specific connector
   *
   * Must be called before sending events.
   *
   * @throws SIEMConfigurationError if initialization fails
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('SIEM connector already initialized');
      return;
    }

    if (!this.config.enabled) {
      logger.info('SIEM integration disabled, skipping initialization');
      this.isInitialized = true;
      return;
    }

    // Create provider-specific connector
    switch (this.config.provider) {
      case 'loki':
        this.connector = createLokiConnector(this.config);
        break;

      case 'splunk':
        this.connector = createSplunkConnector(this.config);
        break;

      case 'elastic':
        this.connector = createElasticConnector(this.config);
        break;

      default:
        throw new SIEMConfigurationError(
          `Unsupported SIEM provider: ${this.config.provider}`,
          this.config.provider
        );
    }

    // Perform initial health check
    const isHealthy = await this.connector.healthCheck();
    if (!isHealthy) {
      logger.warn(
        { provider: this.config.provider, endpoint: this.config.endpoint },
        'SIEM provider health check failed during initialization - will retry on send'
      );
    }

    this.isInitialized = true;
    logger.info(
      { provider: this.config.provider, healthy: isHealthy },
      'SIEM connector initialized'
    );
  }

  /**
   * Check if the SIEM provider is healthy
   */
  async healthCheck(): Promise<boolean> {
    if (!this.config.enabled || !this.connector) {
      return true; // Disabled is considered healthy
    }

    return this.connector.healthCheck();
  }

  /**
   * Send a single audit event to the SIEM
   *
   * @param event - The audit event to send
   * @throws Error if connector not initialized or event validation fails
   */
  async sendEvent(event: AuditEvent): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('SIEM connector not initialized. Call initialize() first.');
    }

    if (!this.config.enabled || !this.connector) {
      return; // Silently skip if disabled
    }

    // Validate event
    const validationResult = AuditEventSchema.safeParse(event);
    if (!validationResult.success) {
      const errors = validationResult.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join(', ');
      logger.warn({ eventId: event.id, errors }, 'Invalid audit event, skipping');
      return;
    }

    await this.connector.sendEvent(validationResult.data);
  }

  /**
   * Send a batch of audit events to the SIEM
   *
   * @param events - Array of audit events to send
   */
  async sendBatch(events: AuditEvent[]): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('SIEM connector not initialized. Call initialize() first.');
    }

    if (!this.config.enabled || !this.connector) {
      return;
    }

    // Validate all events
    const validEvents: AuditEvent[] = [];
    for (const event of events) {
      const result = AuditEventSchema.safeParse(event);
      if (result.success) {
        validEvents.push(result.data);
      } else {
        logger.warn({ eventId: event.id }, 'Invalid audit event in batch, skipping');
      }
    }

    if (validEvents.length > 0) {
      await this.connector.sendBatch(validEvents);
    }
  }

  /**
   * Flush any buffered events
   */
  async flush(): Promise<void> {
    if (!this.config.enabled || !this.connector) {
      return;
    }

    await this.connector.flush();
  }

  /**
   * Gracefully shutdown the connector
   *
   * Flushes any buffered events before closing.
   */
  async shutdown(): Promise<void> {
    if (!this.connector) {
      return;
    }

    logger.info({ provider: this.config.provider }, 'Shutting down SIEM connector');
    await this.connector.shutdown();
    this.connector = null;
    this.isInitialized = false;
  }

  /**
   * Get connector statistics
   */
  getStats(): SIEMConnectorStats {
    if (!this.connector) {
      return {
        eventsSent: 0,
        eventsFailed: 0,
        batchesSent: 0,
        queueSize: 0,
        avgLatencyMs: 0,
        eventsDropped: 0,
        retryAttempts: 0,
      };
    }

    return this.connector.getStats();
  }

  /**
   * Check if the connector is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the current configuration
   */
  getConfig(): Readonly<SIEMConfig> {
    return { ...this.config };
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a SIEM connector from environment variables
 *
 * Environment variables:
 * - VORION_SIEM_ENABLED: Enable SIEM integration (true/false)
 * - VORION_SIEM_PROVIDER: Provider type (loki, splunk, elastic)
 * - VORION_SIEM_ENDPOINT: Provider endpoint URL
 * - VORION_SIEM_AUTH_TYPE: Authentication type (none, basic, bearer, api-key)
 * - VORION_SIEM_AUTH_USERNAME: Username for basic auth
 * - VORION_SIEM_AUTH_PASSWORD: Password for basic auth
 * - VORION_SIEM_AUTH_TOKEN: Token for bearer auth
 * - VORION_SIEM_AUTH_API_KEY: API key for api-key auth
 * - VORION_SIEM_BATCH_SIZE: Events per batch
 * - VORION_SIEM_FLUSH_INTERVAL_MS: Flush interval in ms
 * - VORION_SIEM_RETRY_ATTEMPTS: Number of retry attempts
 * - VORION_SIEM_EVENT_TYPES: Comma-separated list of event types to send
 * - VORION_SIEM_APP_LABEL: Application label
 * - VORION_SIEM_ENVIRONMENT_LABEL: Environment label
 */
export function createSIEMConnectorFromEnv(): SIEMConnector {
  const enabled = process.env['VORION_SIEM_ENABLED'] === 'true';
  const provider = (process.env['VORION_SIEM_PROVIDER'] ?? 'loki') as SIEMProvider;
  const endpoint = process.env['VORION_SIEM_ENDPOINT'] ?? 'http://localhost:3100';

  const authType = (process.env['VORION_SIEM_AUTH_TYPE'] ?? 'none') as
    | 'none'
    | 'basic'
    | 'bearer'
    | 'api-key';

  const eventTypes = process.env['VORION_SIEM_EVENT_TYPES']
    ? process.env['VORION_SIEM_EVENT_TYPES'].split(',').map((t) => t.trim())
    : [];

  return new SIEMConnector({
    enabled,
    provider,
    endpoint,
    authentication: {
      type: authType,
      username: process.env['VORION_SIEM_AUTH_USERNAME'],
      password: process.env['VORION_SIEM_AUTH_PASSWORD'],
      token: process.env['VORION_SIEM_AUTH_TOKEN'],
      apiKey: process.env['VORION_SIEM_AUTH_API_KEY'],
    },
    batchSize: parseInt(process.env['VORION_SIEM_BATCH_SIZE'] ?? '100', 10),
    flushIntervalMs: parseInt(process.env['VORION_SIEM_FLUSH_INTERVAL_MS'] ?? '5000', 10),
    retryAttempts: parseInt(process.env['VORION_SIEM_RETRY_ATTEMPTS'] ?? '3', 10),
    retryDelayMs: parseInt(process.env['VORION_SIEM_RETRY_DELAY_MS'] ?? '1000', 10),
    eventTypes,
    appLabel: process.env['VORION_SIEM_APP_LABEL'] ?? 'vorion',
    environmentLabel: process.env['VORION_SIEM_ENVIRONMENT_LABEL'] ?? 'development',
    timeoutMs: parseInt(process.env['VORION_SIEM_TIMEOUT_MS'] ?? '10000', 10),
    maxQueueSize: parseInt(process.env['VORION_SIEM_MAX_QUEUE_SIZE'] ?? '10000', 10),
    compression: process.env['VORION_SIEM_COMPRESSION'] !== 'false',
  });
}

/**
 * Create a SIEM connector with minimal configuration (Loki)
 *
 * @param endpoint - Loki endpoint URL
 * @param options - Optional configuration overrides
 */
export function createLokiSIEM(
  endpoint: string,
  options?: Partial<SIEMConfig>
): SIEMConnector {
  return new SIEMConnector({
    enabled: true,
    provider: 'loki',
    endpoint,
    ...options,
  });
}

/**
 * Create a SIEM connector with minimal configuration (Splunk)
 *
 * @param endpoint - Splunk HEC endpoint URL
 * @param token - HEC token
 * @param options - Optional configuration overrides
 */
export function createSplunkSIEM(
  endpoint: string,
  token: string,
  options?: Partial<SIEMConfig>
): SIEMConnector {
  return new SIEMConnector({
    enabled: true,
    provider: 'splunk',
    endpoint,
    authentication: {
      type: 'bearer',
      token,
    },
    ...options,
  });
}

/**
 * Create a SIEM connector with minimal configuration (Elasticsearch)
 *
 * @param endpoint - Elasticsearch endpoint URL
 * @param options - Optional configuration overrides
 */
export function createElasticSIEM(
  endpoint: string,
  options?: Partial<SIEMConfig>
): SIEMConnector {
  return new SIEMConnector({
    enabled: true,
    provider: 'elastic',
    endpoint,
    ...options,
  });
}

// =============================================================================
// EXPORTS
// =============================================================================

// Provider-specific connectors
export { LokiConnector, createLokiConnector } from './loki.js';
export { SplunkConnector, createSplunkConnector } from './splunk.js';
export { ElasticConnector, createElasticConnector } from './elastic.js';

// Types and schemas
export type {
  SIEMConfig,
  SIEMProvider,
  AuthType,
  AuditEvent,
  AuditEventActor,
  AuditEventResource,
  AuditEventMetadata,
  ISIEMConnector,
  SIEMConnectorStats,
  SIEMEventCategory,
  SIEMEventSeverity,
  SIEMEventOutcome,
  SIEMAuditEventType,
  // Loki types
  LokiPushRequest,
  LokiStream,
  LokiLogEntry,
  // Splunk types
  SplunkHECEvent,
  // Elastic types
  ElasticBulkAction,
  ElasticAuditDocument,
} from './types.js';

export {
  SIEMConfigSchema,
  SIEMAuthenticationSchema,
  AuditEventSchema,
  AuditEventActorSchema,
  AuditEventResourceSchema,
  AuditEventMetadataSchema,
  SIEM_PROVIDERS,
  AUTH_TYPES,
  SIEM_EVENT_CATEGORIES,
  SIEM_EVENT_SEVERITIES,
  SIEM_EVENT_OUTCOMES,
  SIEM_EVENT_TYPES,
  // Errors
  SIEMConnectionError,
  SIEMConfigurationError,
  SIEMBatchError,
} from './types.js';
