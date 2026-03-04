/**
 * Splunk SIEM Connector
 *
 * HTTP Event Collector (HEC) integration for Splunk:
 * - Batch event sending
 * - Index and sourcetype configuration
 * - Token-based authentication
 * - Retry with exponential backoff
 *
 * @packageDocumentation
 * @module security/siem/splunk
 */

import { createLogger } from '../../common/logger.js';
import { BaseSIEMConnector, registerConnectorFactory } from './connector.js';
import type { SecurityEvent, SendResult, SplunkConnectorConfig } from './types.js';

const logger = createLogger({ component: 'siem-splunk' });

// =============================================================================
// Types
// =============================================================================

/**
 * Splunk HEC event format
 */
interface SplunkHECEvent {
  /** Event timestamp in Unix epoch seconds */
  time?: number;
  /** Splunk host */
  host?: string;
  /** Splunk source */
  source?: string;
  /** Splunk sourcetype */
  sourcetype?: string;
  /** Splunk index */
  index?: string;
  /** Event data */
  event: Record<string, unknown>;
  /** Custom fields */
  fields?: Record<string, string>;
}

/**
 * Splunk HEC response
 */
interface SplunkHECResponse {
  text: string;
  code: number;
  ackId?: number;
}

// =============================================================================
// Splunk Connector
// =============================================================================

/**
 * Splunk connector using HTTP Event Collector (HEC)
 *
 * Features:
 * - Batch event sending for efficiency
 * - Configurable index, sourcetype, source
 * - Token-based authentication
 * - Retry with exponential backoff
 */
export class SplunkConnector extends BaseSIEMConnector {
  public readonly type = 'splunk';

  private readonly hecUrl: string;
  private readonly token: string;
  private readonly index?: string;
  private readonly sourcetype?: string;
  private readonly source?: string;
  private readonly host?: string;
  private readonly verifySsl: boolean;
  private readonly defaultFields?: Record<string, string>;

  constructor(config: SplunkConnectorConfig) {
    super(config);

    this.hecUrl = config.hecUrl.replace(/\/$/, '');
    this.token = config.token;
    this.index = config.index;
    this.sourcetype = config.sourcetype ?? 'vorion:security';
    this.source = config.source ?? 'vorion';
    this.host = config.host;
    this.verifySsl = config.verifySsl ?? true;
    this.defaultFields = config.defaultFields;

    logger.info(
      {
        name: this.name,
        hecUrl: this.maskUrl(this.hecUrl),
        index: this.index,
        sourcetype: this.sourcetype,
      },
      'SplunkConnector initialized'
    );
  }

  /**
   * Connect to Splunk (verify HEC endpoint is accessible)
   */
  protected async doConnect(): Promise<void> {
    // Verify HEC endpoint by checking health
    const healthy = await this.doHealthCheck();
    if (!healthy) {
      throw new Error('Failed to connect to Splunk HEC endpoint');
    }
  }

  /**
   * Disconnect from Splunk (no-op for HTTP-based connection)
   */
  protected async doDisconnect(): Promise<void> {
    // HTTP-based connection, no persistent connection to close
  }

  /**
   * Send events to Splunk via HEC
   */
  protected async doSend(events: SecurityEvent[]): Promise<SendResult> {
    const batches = this.splitIntoBatches(events);
    let totalSent = 0;
    let totalFailed = 0;
    const failedIds: string[] = [];

    for (const batch of batches) {
      try {
        const result = await this.sendBatch(batch);
        totalSent += result.eventsSent;
        totalFailed += result.eventsFailed;
        if (result.failedEventIds) {
          failedIds.push(...result.failedEventIds);
        }
      } catch (error) {
        totalFailed += batch.length;
        failedIds.push(...batch.map((e) => e.id));
        this.logger.error(
          { error, batchSize: batch.length },
          'Failed to send batch to Splunk'
        );
      }
    }

    return {
      success: totalFailed === 0,
      eventsSent: totalSent,
      eventsFailed: totalFailed,
      durationMs: 0, // Will be set by parent
      failedEventIds: failedIds.length > 0 ? failedIds : undefined,
    };
  }

  /**
   * Send a single batch to Splunk
   */
  private async sendBatch(events: SecurityEvent[]): Promise<SendResult> {
    const hecEvents = events.map((event) => this.toHECEvent(event));

    // HEC accepts newline-delimited JSON
    const body = hecEvents.map((e) => JSON.stringify(e)).join('\n');

    const response = await this.httpRequest<SplunkHECResponse>({
      url: `${this.hecUrl}/services/collector/event`,
      method: 'POST',
      headers: {
        Authorization: `Splunk ${this.token}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`Splunk HEC error: ${response.status} - ${response.text}`);
    }

    const result = response.data;
    if (result.code !== 0) {
      throw new Error(`Splunk HEC error: ${result.text} (code: ${result.code})`);
    }

    return {
      success: true,
      eventsSent: events.length,
      eventsFailed: 0,
      durationMs: 0,
      response: result,
    };
  }

  /**
   * Health check - verify HEC endpoint is accessible
   */
  protected async doHealthCheck(): Promise<boolean> {
    try {
      // Use HEC health endpoint
      const response = await this.httpRequest<{ status: string }>({
        url: `${this.hecUrl}/services/collector/health`,
        method: 'GET',
        headers: {
          Authorization: `Splunk ${this.token}`,
        },
        timeout: 5000,
      });

      return response.ok;
    } catch (error) {
      this.logger.warn(
        { error: (error as Error).message },
        'Splunk health check failed'
      );
      return false;
    }
  }

  /**
   * Convert security event to Splunk HEC format
   */
  private toHECEvent(event: SecurityEvent): SplunkHECEvent {
    const hecEvent: SplunkHECEvent = {
      time: Math.floor(event.timestamp.getTime() / 1000),
      host: this.host,
      source: this.source,
      sourcetype: this.sourcetype,
      event: this.buildEventPayload(event),
    };

    if (this.index) {
      hecEvent.index = this.index;
    }

    if (this.defaultFields) {
      hecEvent.fields = { ...this.defaultFields };
    }

    return hecEvent;
  }

  /**
   * Build the event payload for Splunk
   */
  private buildEventPayload(event: SecurityEvent): Record<string, unknown> {
    return {
      event_id: event.id,
      event_type: event.eventType,
      category: event.category,
      severity: event.severity,
      severity_name: this.getSeverityName(event.severity),
      outcome: event.outcome,
      message: event.message,
      description: event.description,

      // Source info
      src_ip: event.sourceIp,
      src_port: event.sourcePort,
      src_host: event.sourceHost,
      src_mac: event.sourceMac,

      // Destination info
      dest_ip: event.destinationIp,
      dest_port: event.destinationPort,
      dest_host: event.destinationHost,
      dest_mac: event.destinationMac,

      // Network info
      protocol: event.protocol,
      http_method: event.httpMethod,
      http_url: event.httpUrl,
      http_status: event.httpStatusCode,
      user_agent: event.userAgent,
      request_id: event.requestId,

      // Process info
      process_name: event.processName,
      process_id: event.processId,
      file_path: event.filePath,
      file_hash: event.fileHash,

      // User context
      user_id: event.user?.userId,
      username: event.user?.username,
      user_email: event.user?.email,
      user_roles: event.user?.roles?.join(','),
      tenant_id: event.user?.tenantId,
      tenant_name: event.user?.tenantName,
      privileged_user: event.user?.privileged,

      // Geo context
      geo_country: event.geo?.country,
      geo_country_code: event.geo?.countryCode,
      geo_city: event.geo?.city,
      geo_region: event.geo?.region,
      geo_lat: event.geo?.latitude,
      geo_lon: event.geo?.longitude,

      // Threat context
      threat_indicator: event.threat?.indicator,
      threat_type: event.threat?.threatType,
      threat_confidence: event.threat?.confidence,
      threat_source: event.threat?.source,
      mitre_attack: event.threat?.mitreAttack?.join(','),

      // Source system
      source_app: event.source,
      source_component: event.component,
      source_version: event.version,
      environment: event.environment,

      // Tags
      tags: event.tags,

      // Custom fields
      ...event.customFields,
    };
  }

  /**
   * Get severity name from numeric value
   */
  private getSeverityName(severity: number): string {
    switch (severity) {
      case 0:
        return 'unknown';
      case 1:
        return 'low';
      case 4:
        return 'medium';
      case 7:
        return 'high';
      case 10:
        return 'critical';
      default:
        return 'unknown';
    }
  }

  /**
   * Mask sensitive parts of URL for logging
   */
  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      return '[invalid url]';
    }
  }
}

// =============================================================================
// Factory Registration
// =============================================================================

/**
 * Create a Splunk connector
 */
export function createSplunkConnector(config: SplunkConnectorConfig): SplunkConnector {
  return new SplunkConnector(config);
}

// Register the factory
registerConnectorFactory('splunk', (config) =>
  createSplunkConnector(config as SplunkConnectorConfig)
);
