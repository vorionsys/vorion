/**
 * Datadog SIEM Connector
 *
 * Datadog Logs API integration:
 * - Logs API v2 integration
 * - Tags and attributes mapping
 * - API key authentication
 * - Service and source configuration
 * - Gzip compression support
 *
 * @packageDocumentation
 * @module security/siem/datadog
 */

import { createLogger } from '../../common/logger.js';
import { BaseSIEMConnector, registerConnectorFactory } from './connector.js';
import type { SecurityEvent, SendResult, DatadogConnectorConfig } from './types.js';
import { gzipSync } from 'zlib';

const logger = createLogger({ component: 'siem-datadog' });

// =============================================================================
// Types
// =============================================================================

/**
 * Datadog log entry
 */
interface DatadogLogEntry {
  /** Log message */
  message: string;
  /** Service name */
  service: string;
  /** Source */
  ddsource: string;
  /** Tags (comma-separated) */
  ddtags: string;
  /** Hostname */
  hostname?: string;
  /** Timestamp (ISO 8601 or Unix ms) */
  '@timestamp'?: string;
  /** Additional attributes */
  [key: string]: unknown;
}

/**
 * Datadog API response
 */
interface DatadogResponse {
  status?: string;
  message?: string;
}

// =============================================================================
// Datadog Site URLs
// =============================================================================

const DATADOG_SITES: Record<string, string> = {
  us1: 'https://http-intake.logs.datadoghq.com',
  us3: 'https://http-intake.logs.us3.datadoghq.com',
  us5: 'https://http-intake.logs.us5.datadoghq.com',
  eu1: 'https://http-intake.logs.datadoghq.eu',
  ap1: 'https://http-intake.logs.ap1.datadoghq.com',
};

// =============================================================================
// Datadog Connector
// =============================================================================

/**
 * Datadog connector for SIEM integration
 *
 * Features:
 * - Logs API v2 for efficient ingestion
 * - Tag-based event categorization
 * - Gzip compression for large payloads
 * - Multi-site support
 */
export class DatadogConnector extends BaseSIEMConnector {
  public readonly type = 'datadog';

  private readonly site: string;
  private readonly apiKey: string;
  private readonly service: string;
  private readonly source: string;
  private readonly hostname?: string;
  private readonly defaultTags: string[];
  private readonly compress: boolean;
  private readonly baseUrl: string;

  constructor(config: DatadogConnectorConfig) {
    super(config);

    this.site = config.site;
    this.apiKey = config.apiKey;
    this.service = config.service;
    this.source = config.source ?? 'vorion';
    this.hostname = config.hostname;
    this.defaultTags = config.tags ?? [];
    this.compress = config.compress ?? true;

    this.baseUrl = DATADOG_SITES[this.site];
    if (!this.baseUrl) {
      throw new Error(`Invalid Datadog site: ${this.site}`);
    }

    logger.info(
      {
        name: this.name,
        site: this.site,
        service: this.service,
        source: this.source,
        compress: this.compress,
      },
      'DatadogConnector initialized'
    );
  }

  /**
   * Connect to Datadog (verify API key)
   */
  protected async doConnect(): Promise<void> {
    // Verify API key by checking validation endpoint
    const healthy = await this.doHealthCheck();
    if (!healthy) {
      throw new Error('Failed to validate Datadog API key');
    }
  }

  /**
   * Disconnect from Datadog (no-op for HTTP)
   */
  protected async doDisconnect(): Promise<void> {
    // HTTP-based connection, no persistent connection to close
  }

  /**
   * Send events to Datadog Logs API
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
          'Failed to send batch to Datadog'
        );
      }
    }

    return {
      success: totalFailed === 0,
      eventsSent: totalSent,
      eventsFailed: totalFailed,
      durationMs: 0,
      failedEventIds: failedIds.length > 0 ? failedIds : undefined,
    };
  }

  /**
   * Send a single batch to Datadog
   */
  private async sendBatch(events: SecurityEvent[]): Promise<SendResult> {
    const logs = events.map((event) => this.toDatadogLog(event));
    const jsonBody = JSON.stringify(logs);

    const headers: Record<string, string> = {
      'DD-API-KEY': this.apiKey,
      'Content-Type': 'application/json',
    };

    let body: string | Buffer = jsonBody;

    // Compress if enabled and payload is large enough
    if (this.compress && jsonBody.length > 1000) {
      body = gzipSync(jsonBody);
      headers['Content-Encoding'] = 'gzip';
    }

    const response = await this.httpRequest<DatadogResponse>({
      url: `${this.baseUrl}/api/v2/logs`,
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      throw new Error(`Datadog API error: ${response.status} - ${response.text}`);
    }

    return {
      success: true,
      eventsSent: events.length,
      eventsFailed: 0,
      durationMs: 0,
      response: response.data,
    };
  }

  /**
   * Health check - validate API key
   */
  protected async doHealthCheck(): Promise<boolean> {
    try {
      // Use the validate endpoint
      const response = await this.httpRequest<{ valid: boolean }>({
        url: 'https://api.datadoghq.com/api/v1/validate',
        method: 'GET',
        headers: {
          'DD-API-KEY': this.apiKey,
        },
        timeout: 5000,
      });

      return response.ok;
    } catch (error) {
      this.logger.warn(
        { error: (error as Error).message },
        'Datadog health check failed'
      );
      return false;
    }
  }

  /**
   * Convert security event to Datadog log format
   */
  private toDatadogLog(event: SecurityEvent): DatadogLogEntry {
    // Build tags array
    const tags = [
      ...this.defaultTags,
      `category:${event.category}`,
      `severity:${this.getSeverityName(event.severity)}`,
      `outcome:${event.outcome}`,
      `event_type:${event.eventType}`,
    ];

    if (event.environment) {
      tags.push(`env:${event.environment}`);
    }

    if (event.user?.tenantId) {
      tags.push(`tenant:${event.user.tenantId}`);
    }

    if (event.tags) {
      tags.push(...event.tags);
    }

    const log: DatadogLogEntry = {
      message: event.message,
      service: this.service,
      ddsource: this.source,
      ddtags: tags.join(','),
      '@timestamp': event.timestamp.toISOString(),

      // Event metadata
      event_id: event.id,
      event_type: event.eventType,
      event_category: event.category,
      event_severity: event.severity,
      event_severity_name: this.getSeverityName(event.severity),
      event_outcome: event.outcome,
      description: event.description,

      // Network attributes
      network: this.buildNetworkAttributes(event),

      // User attributes
      usr: this.buildUserAttributes(event),

      // Geo attributes
      geo: event.geo
        ? {
            country: event.geo.country,
            country_code: event.geo.countryCode,
            city: event.geo.city,
            region: event.geo.region,
            latitude: event.geo.latitude,
            longitude: event.geo.longitude,
            timezone: event.geo.timezone,
          }
        : undefined,

      // Threat attributes
      threat: event.threat
        ? {
            indicator: event.threat.indicator,
            type: event.threat.threatType,
            confidence: event.threat.confidence,
            source: event.threat.source,
            malware_families: event.threat.malwareFamilies,
            threat_actors: event.threat.threatActors,
            mitre_attack: event.threat.mitreAttack,
          }
        : undefined,

      // Process attributes
      process: event.processName || event.processId
        ? {
            name: event.processName,
            pid: event.processId,
          }
        : undefined,

      // File attributes
      file: event.filePath || event.fileHash
        ? {
            path: event.filePath,
            hash: event.fileHash,
          }
        : undefined,

      // Source attributes
      vorion: {
        source: event.source,
        component: event.component,
        version: event.version,
        request_id: event.requestId,
      },

      // Custom fields
      ...event.customFields,
    };

    if (this.hostname) {
      log.hostname = this.hostname;
    }

    // Remove undefined values
    return this.removeUndefined(log) as DatadogLogEntry;
  }

  /**
   * Build network attributes
   */
  private buildNetworkAttributes(
    event: SecurityEvent
  ): Record<string, unknown> | undefined {
    if (
      !event.sourceIp &&
      !event.destinationIp &&
      !event.protocol &&
      !event.httpUrl
    ) {
      return undefined;
    }

    return {
      client: event.sourceIp
        ? {
            ip: event.sourceIp,
            port: event.sourcePort,
          }
        : undefined,
      destination: event.destinationIp
        ? {
            ip: event.destinationIp,
            port: event.destinationPort,
          }
        : undefined,
      protocol: event.protocol,
    };
  }

  /**
   * Build user attributes
   */
  private buildUserAttributes(
    event: SecurityEvent
  ): Record<string, unknown> | undefined {
    if (!event.user) {
      return undefined;
    }

    return {
      id: event.user.userId,
      name: event.user.username,
      email: event.user.email,
      roles: event.user.roles,
      groups: event.user.groups,
      tenant_id: event.user.tenantId,
      tenant_name: event.user.tenantName,
      department: event.user.department,
      privileged: event.user.privileged,
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
   * Remove undefined values from object
   */
  private removeUndefined(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) {
        continue;
      }

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const cleaned = this.removeUndefined(value as Record<string, unknown>);
        if (Object.keys(cleaned).length > 0) {
          result[key] = cleaned;
        }
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}

// =============================================================================
// Factory Registration
// =============================================================================

/**
 * Create a Datadog connector
 */
export function createDatadogConnector(
  config: DatadogConnectorConfig
): DatadogConnector {
  return new DatadogConnector(config);
}

// Register the factory
registerConnectorFactory('datadog', (config) =>
  createDatadogConnector(config as DatadogConnectorConfig)
);
