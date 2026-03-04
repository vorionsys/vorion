/**
 * Elasticsearch SIEM Connector
 *
 * Elasticsearch/OpenSearch integration for SIEM:
 * - Bulk API for efficient ingestion
 * - Index template management
 * - API key or basic auth
 * - Connection pooling
 *
 * @packageDocumentation
 * @module security/siem/elastic
 */

import { createLogger } from '../../common/logger.js';
import { BaseSIEMConnector, registerConnectorFactory } from './connector.js';
import type { SecurityEvent, SendResult, ElasticConnectorConfig } from './types.js';

const logger = createLogger({ component: 'siem-elastic' });

// =============================================================================
// Types
// =============================================================================

/**
 * Elasticsearch bulk action
 */
interface BulkAction {
  index: {
    _index: string;
    _id?: string;
    pipeline?: string;
  };
}

/**
 * Elasticsearch document
 */
interface ElasticDocument {
  '@timestamp': string;
  event: {
    id: string;
    kind: string;
    category: string[];
    type: string[];
    outcome: string;
    severity: number;
    created: string;
  };
  message: string;
  source?: {
    ip?: string;
    port?: number;
    domain?: string;
    mac?: string;
  };
  destination?: {
    ip?: string;
    port?: number;
    domain?: string;
    mac?: string;
  };
  network?: {
    protocol?: string;
  };
  http?: {
    request?: {
      method?: string;
    };
    response?: {
      status_code?: number;
    };
  };
  url?: {
    full?: string;
  };
  user_agent?: {
    original?: string;
  };
  process?: {
    name?: string;
    pid?: number;
  };
  file?: {
    path?: string;
    hash?: {
      sha256?: string;
    };
  };
  user?: {
    id?: string;
    name?: string;
    email?: string;
    roles?: string[];
    group?: {
      name?: string[];
    };
  };
  organization?: {
    id?: string;
    name?: string;
  };
  geo?: {
    country_name?: string;
    country_iso_code?: string;
    city_name?: string;
    region_name?: string;
    location?: {
      lat: number;
      lon: number;
    };
    timezone?: string;
  };
  threat?: {
    indicator?: {
      type?: string;
      confidence?: string;
      provider?: string;
      first_seen?: string;
      last_seen?: string;
    };
    software?: {
      name?: string;
    };
    tactic?: {
      id?: string[];
    };
  };
  labels?: Record<string, string>;
  tags?: string[];
  vorion?: Record<string, unknown>;
}

/**
 * Elasticsearch bulk response
 */
interface BulkResponse {
  took: number;
  errors: boolean;
  items: Array<{
    index: {
      _id: string;
      _index: string;
      status: number;
      result?: string;
      error?: {
        type: string;
        reason: string;
        caused_by?: {
          type: string;
          reason: string;
        };
      };
    };
  }>;
}

/**
 * Elasticsearch cluster health response
 */
interface ClusterHealthResponse {
  cluster_name: string;
  status: 'green' | 'yellow' | 'red';
  timed_out: boolean;
  number_of_nodes: number;
}

// =============================================================================
// Elasticsearch Connector
// =============================================================================

/**
 * Elasticsearch connector for SIEM integration
 *
 * Features:
 * - Bulk API for efficient ingestion
 * - ECS (Elastic Common Schema) compliant
 * - Multiple authentication methods
 * - Connection pooling via node selection
 */
export class ElasticConnector extends BaseSIEMConnector {
  public readonly type = 'elastic';

  private readonly nodes: string[];
  private readonly auth: ElasticConnectorConfig['auth'];
  private readonly apiKey?: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly bearerToken?: string;
  private readonly index: string;
  private readonly pipeline?: string;
  private readonly verifySsl: boolean;
  private readonly refresh?: 'true' | 'false' | 'wait_for';

  private currentNodeIndex = 0;

  constructor(config: ElasticConnectorConfig) {
    super(config);

    this.nodes = config.nodes.map((n) => n.replace(/\/$/, ''));
    this.auth = config.auth;
    this.apiKey = config.apiKey;
    this.username = config.username;
    this.password = config.password;
    this.bearerToken = config.bearerToken;
    this.index = config.index;
    this.pipeline = config.pipeline;
    this.verifySsl = config.verifySsl ?? true;
    this.refresh = config.refresh;

    logger.info(
      {
        name: this.name,
        nodes: this.nodes.length,
        index: this.index,
        auth: this.auth,
      },
      'ElasticConnector initialized'
    );
  }

  /**
   * Connect to Elasticsearch cluster
   */
  protected async doConnect(): Promise<void> {
    // Verify cluster is accessible
    const healthy = await this.doHealthCheck();
    if (!healthy) {
      throw new Error('Failed to connect to Elasticsearch cluster');
    }

    // Optionally create index template
    await this.ensureIndexTemplate();
  }

  /**
   * Disconnect from Elasticsearch (no-op for HTTP)
   */
  protected async doDisconnect(): Promise<void> {
    // HTTP-based connection, no persistent connection to close
  }

  /**
   * Send events using Bulk API
   */
  protected async doSend(events: SecurityEvent[]): Promise<SendResult> {
    const batches = this.splitIntoBatches(events);
    let totalSent = 0;
    let totalFailed = 0;
    const failedIds: string[] = [];

    for (const batch of batches) {
      try {
        const result = await this.sendBulk(batch);
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
          'Failed to send bulk to Elasticsearch'
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
   * Send a bulk request to Elasticsearch
   */
  private async sendBulk(events: SecurityEvent[]): Promise<SendResult> {
    // Build NDJSON body for bulk API
    const lines: string[] = [];

    for (const event of events) {
      const action: BulkAction = {
        index: {
          _index: this.resolveIndex(event),
          _id: event.id,
        },
      };

      if (this.pipeline) {
        action.index.pipeline = this.pipeline;
      }

      lines.push(JSON.stringify(action));
      lines.push(JSON.stringify(this.toECSDocument(event)));
    }

    const body = lines.join('\n') + '\n';

    let url = `${this.getNode()}/_bulk`;
    if (this.refresh) {
      url += `?refresh=${this.refresh}`;
    }

    const response = await this.httpRequest<BulkResponse>({
      url,
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/x-ndjson',
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`Elasticsearch bulk error: ${response.status} - ${response.text}`);
    }

    const result = response.data;

    // Count successes and failures
    let sent = 0;
    let failed = 0;
    const failedIds: string[] = [];

    for (let i = 0; i < result.items.length; i++) {
      const item = result.items[i];
      if (item.index.status >= 200 && item.index.status < 300) {
        sent++;
      } else {
        failed++;
        failedIds.push(events[i].id);
        this.logger.warn(
          {
            eventId: events[i].id,
            status: item.index.status,
            error: item.index.error,
          },
          'Event indexing failed'
        );
      }
    }

    return {
      success: failed === 0,
      eventsSent: sent,
      eventsFailed: failed,
      durationMs: result.took,
      response: { took: result.took, errors: result.errors },
      failedEventIds: failedIds.length > 0 ? failedIds : undefined,
    };
  }

  /**
   * Health check - verify cluster is accessible
   */
  protected async doHealthCheck(): Promise<boolean> {
    try {
      const response = await this.httpRequest<ClusterHealthResponse>({
        url: `${this.getNode()}/_cluster/health`,
        method: 'GET',
        headers: this.getAuthHeaders(),
        timeout: 5000,
      });

      if (!response.ok) {
        return false;
      }

      const status = response.data.status;
      return status === 'green' || status === 'yellow';
    } catch (error) {
      this.logger.warn(
        { error: (error as Error).message },
        'Elasticsearch health check failed'
      );
      return false;
    }
  }

  /**
   * Ensure index template exists
   */
  private async ensureIndexTemplate(): Promise<void> {
    const templateName = `vorion-security-events`;
    const indexPattern = this.index.includes('*')
      ? this.index
      : `${this.index}-*`;

    const template = {
      index_patterns: [indexPattern],
      template: {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 1,
          'index.lifecycle.name': 'vorion-security-events',
          'index.lifecycle.rollover_alias': this.index,
        },
        mappings: {
          properties: {
            '@timestamp': { type: 'date' },
            message: { type: 'text' },
            event: {
              properties: {
                id: { type: 'keyword' },
                kind: { type: 'keyword' },
                category: { type: 'keyword' },
                type: { type: 'keyword' },
                outcome: { type: 'keyword' },
                severity: { type: 'integer' },
                created: { type: 'date' },
              },
            },
            source: {
              properties: {
                ip: { type: 'ip' },
                port: { type: 'integer' },
                domain: { type: 'keyword' },
                mac: { type: 'keyword' },
              },
            },
            destination: {
              properties: {
                ip: { type: 'ip' },
                port: { type: 'integer' },
                domain: { type: 'keyword' },
                mac: { type: 'keyword' },
              },
            },
            user: {
              properties: {
                id: { type: 'keyword' },
                name: { type: 'keyword' },
                email: { type: 'keyword' },
                roles: { type: 'keyword' },
              },
            },
            organization: {
              properties: {
                id: { type: 'keyword' },
                name: { type: 'keyword' },
              },
            },
            geo: {
              properties: {
                country_name: { type: 'keyword' },
                country_iso_code: { type: 'keyword' },
                city_name: { type: 'keyword' },
                region_name: { type: 'keyword' },
                location: { type: 'geo_point' },
                timezone: { type: 'keyword' },
              },
            },
            threat: {
              properties: {
                indicator: {
                  properties: {
                    type: { type: 'keyword' },
                    confidence: { type: 'keyword' },
                    provider: { type: 'keyword' },
                  },
                },
              },
            },
            tags: { type: 'keyword' },
            labels: { type: 'object' },
            vorion: { type: 'object', enabled: false },
          },
        },
      },
      priority: 100,
    };

    try {
      await this.httpRequest({
        url: `${this.getNode()}/_index_template/${templateName}`,
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: template,
      });
      this.logger.info({ templateName }, 'Index template created/updated');
    } catch (error) {
      this.logger.warn(
        { error: (error as Error).message },
        'Failed to create index template (may already exist)'
      );
    }
  }

  /**
   * Convert security event to ECS document
   */
  private toECSDocument(event: SecurityEvent): ElasticDocument {
    const doc: ElasticDocument = {
      '@timestamp': event.timestamp.toISOString(),
      event: {
        id: event.id,
        kind: 'event',
        category: [event.category],
        type: [event.eventType],
        outcome: event.outcome,
        severity: event.severity,
        created: event.timestamp.toISOString(),
      },
      message: event.message,
    };

    // Source
    if (event.sourceIp || event.sourcePort || event.sourceHost || event.sourceMac) {
      doc.source = {
        ip: event.sourceIp,
        port: event.sourcePort,
        domain: event.sourceHost,
        mac: event.sourceMac,
      };
    }

    // Destination
    if (
      event.destinationIp ||
      event.destinationPort ||
      event.destinationHost ||
      event.destinationMac
    ) {
      doc.destination = {
        ip: event.destinationIp,
        port: event.destinationPort,
        domain: event.destinationHost,
        mac: event.destinationMac,
      };
    }

    // Network
    if (event.protocol) {
      doc.network = { protocol: event.protocol };
    }

    // HTTP
    if (event.httpMethod || event.httpStatusCode) {
      doc.http = {};
      if (event.httpMethod) {
        doc.http.request = { method: event.httpMethod };
      }
      if (event.httpStatusCode) {
        doc.http.response = { status_code: event.httpStatusCode };
      }
    }

    // URL
    if (event.httpUrl) {
      doc.url = { full: event.httpUrl };
    }

    // User agent
    if (event.userAgent) {
      doc.user_agent = { original: event.userAgent };
    }

    // Process
    if (event.processName || event.processId) {
      doc.process = {
        name: event.processName,
        pid: event.processId,
      };
    }

    // File
    if (event.filePath || event.fileHash) {
      doc.file = {
        path: event.filePath,
      };
      if (event.fileHash) {
        doc.file.hash = { sha256: event.fileHash };
      }
    }

    // User
    if (event.user) {
      doc.user = {
        id: event.user.userId,
        name: event.user.username,
        email: event.user.email,
        roles: event.user.roles,
      };
      if (event.user.groups && event.user.groups.length > 0) {
        doc.user.group = { name: event.user.groups };
      }
    }

    // Organization
    if (event.user?.tenantId || event.user?.tenantName) {
      doc.organization = {
        id: event.user.tenantId,
        name: event.user.tenantName,
      };
    }

    // Geo
    if (event.geo) {
      doc.geo = {
        country_name: event.geo.country,
        country_iso_code: event.geo.countryCode,
        city_name: event.geo.city,
        region_name: event.geo.region,
        timezone: event.geo.timezone,
      };
      if (event.geo.latitude !== undefined && event.geo.longitude !== undefined) {
        doc.geo.location = {
          lat: event.geo.latitude,
          lon: event.geo.longitude,
        };
      }
    }

    // Threat
    if (event.threat) {
      doc.threat = {
        indicator: {
          type: event.threat.threatType,
          confidence: event.threat.confidence?.toString(),
          provider: event.threat.source,
          first_seen: event.threat.firstSeen?.toISOString(),
          last_seen: event.threat.lastSeen?.toISOString(),
        },
      };
      if (event.threat.malwareFamilies && event.threat.malwareFamilies.length > 0) {
        doc.threat.software = { name: event.threat.malwareFamilies[0] };
      }
      if (event.threat.mitreAttack && event.threat.mitreAttack.length > 0) {
        doc.threat.tactic = { id: event.threat.mitreAttack };
      }
    }

    // Tags
    if (event.tags && event.tags.length > 0) {
      doc.tags = event.tags;
    }

    // Custom fields as labels
    if (event.customFields) {
      doc.labels = {};
      for (const [key, value] of Object.entries(event.customFields)) {
        if (typeof value === 'string') {
          doc.labels[key] = value;
        } else if (value !== null && value !== undefined) {
          doc.labels[key] = String(value);
        }
      }
    }

    // Vorion-specific data
    doc.vorion = {
      source: event.source,
      component: event.component,
      version: event.version,
      environment: event.environment,
      request_id: event.requestId,
      raw: event.rawData,
    };

    return doc;
  }

  /**
   * Resolve index name (supports date patterns)
   */
  private resolveIndex(event: SecurityEvent): string {
    const date = event.timestamp;
    return this.index
      .replace('%{+yyyy}', date.getUTCFullYear().toString())
      .replace('%{+MM}', String(date.getUTCMonth() + 1).padStart(2, '0'))
      .replace('%{+dd}', String(date.getUTCDate()).padStart(2, '0'));
  }

  /**
   * Get current node URL with round-robin
   */
  private getNode(): string {
    const node = this.nodes[this.currentNodeIndex];
    this.currentNodeIndex = (this.currentNodeIndex + 1) % this.nodes.length;
    return node;
  }

  /**
   * Get authentication headers
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    switch (this.auth) {
      case 'apiKey':
        if (this.apiKey) {
          headers['Authorization'] = `ApiKey ${this.apiKey}`;
        }
        break;
      case 'basic':
        if (this.username && this.password) {
          const encoded = Buffer.from(`${this.username}:${this.password}`).toString(
            'base64'
          );
          headers['Authorization'] = `Basic ${encoded}`;
        }
        break;
      case 'bearer':
        if (this.bearerToken) {
          headers['Authorization'] = `Bearer ${this.bearerToken}`;
        }
        break;
      case 'none':
      default:
        break;
    }

    return headers;
  }
}

// =============================================================================
// Factory Registration
// =============================================================================

/**
 * Create an Elasticsearch connector
 */
export function createElasticConnector(
  config: ElasticConnectorConfig
): ElasticConnector {
  return new ElasticConnector(config);
}

// Register the factory
registerConnectorFactory('elastic', (config) =>
  createElasticConnector(config as ElasticConnectorConfig)
);
