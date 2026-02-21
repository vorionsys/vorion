/**
 * SIEM Event Formatter
 *
 * Provides multiple event output formats:
 * - Common Event Format (CEF)
 * - JSON structured logging
 * - Syslog format (RFC 5424)
 * - Custom field mapping per connector
 *
 * @packageDocumentation
 * @module security/siem/formatter
 */

import { createLogger } from '../../common/logger.js';
import type {
  SecurityEvent,
  EventFormat,
  CEFConfig,
  SyslogConfig,
} from './types.js';

const logger = createLogger({ component: 'siem-formatter' });

// =============================================================================
// Constants
// =============================================================================

/**
 * CEF severity mapping (0-10 scale)
 */
const CEF_SEVERITY_MAP: Record<number, string> = {
  0: '0', // Unknown
  1: '3', // Low
  4: '5', // Medium
  7: '8', // High
  10: '10', // Critical
};

/**
 * Syslog severity levels (RFC 5424)
 */
const SYSLOG_SEVERITY: Record<number, number> = {
  0: 6, // Unknown -> Informational
  1: 5, // Low -> Notice
  4: 4, // Medium -> Warning
  7: 3, // High -> Error
  10: 2, // Critical -> Critical
};

/**
 * CEF escape characters
 */
const CEF_ESCAPE_MAP: Record<string, string> = {
  '\\': '\\\\',
  '|': '\\|',
  '=': '\\=',
  '\n': '\\n',
  '\r': '\\r',
};

// =============================================================================
// Event Formatter Class
// =============================================================================

/**
 * Event formatter for multiple output formats
 */
export class EventFormatter {
  private readonly cefConfig?: CEFConfig;
  private readonly syslogConfig?: SyslogConfig;

  constructor(options?: { cef?: CEFConfig; syslog?: SyslogConfig }) {
    this.cefConfig = options?.cef;
    this.syslogConfig = options?.syslog;
  }

  /**
   * Format an event in the specified format
   */
  format(event: SecurityEvent, format: EventFormat): string {
    switch (format) {
      case 'cef':
        return this.formatCEF(event);
      case 'syslog':
        return this.formatSyslog(event);
      case 'json':
      default:
        return this.formatJSON(event);
    }
  }

  /**
   * Format as JSON
   */
  formatJSON(event: SecurityEvent): string {
    const jsonEvent = {
      ...event,
      timestamp: event.timestamp.toISOString(),
      threat: event.threat
        ? {
            ...event.threat,
            firstSeen: event.threat.firstSeen?.toISOString(),
            lastSeen: event.threat.lastSeen?.toISOString(),
          }
        : undefined,
    };

    return JSON.stringify(jsonEvent);
  }

  /**
   * Format as CEF (Common Event Format)
   *
   * CEF:Version|Device Vendor|Device Product|Device Version|Device Event Class ID|Name|Severity|[Extension]
   */
  formatCEF(event: SecurityEvent): string {
    const config = this.cefConfig ?? {
      vendor: 'Vorion',
      product: 'SecurityPlatform',
      version: '1.0',
    };

    const version = 'CEF:0';
    const vendor = this.escapeCEFHeader(config.vendor);
    const product = this.escapeCEFHeader(config.product);
    const deviceVersion = this.escapeCEFHeader(config.version);
    const eventClassId = this.escapeCEFHeader(
      `${config.deviceEventClassIdPrefix ?? ''}${event.eventType}`
    );
    const name = this.escapeCEFHeader(event.message.substring(0, 512));
    const severity = CEF_SEVERITY_MAP[event.severity] ?? '0';

    // Build extension
    const extension = this.buildCEFExtension(event);

    return `${version}|${vendor}|${product}|${deviceVersion}|${eventClassId}|${name}|${severity}|${extension}`;
  }

  /**
   * Format as Syslog (RFC 5424)
   *
   * <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID [SD-ID ...] MSG
   */
  formatSyslog(event: SecurityEvent): string {
    const config = this.syslogConfig ?? {
      facility: 1, // user-level
      appName: 'vorion',
    };

    // Calculate PRI
    const severity = SYSLOG_SEVERITY[event.severity] ?? 6;
    const pri = config.facility * 8 + severity;

    // Format components
    const version = 1;
    const timestamp = event.timestamp.toISOString();
    const hostname = event.sourceHost ?? '-';
    const appName = config.appName;
    const procId = config.procId ?? '-';
    const msgId = config.msgId ?? event.eventType;

    // Build structured data
    const structuredData = config.includeStructuredData
      ? this.buildSyslogStructuredData(event)
      : '-';

    // Message
    const msg = event.message;

    return `<${pri}>${version} ${timestamp} ${hostname} ${appName} ${procId} ${msgId} ${structuredData} ${msg}`;
  }

  /**
   * Build CEF extension field
   */
  private buildCEFExtension(event: SecurityEvent): string {
    const fields: Array<[string, string | number | undefined]> = [
      // Timestamps
      ['rt', event.timestamp.getTime()],
      ['deviceExternalId', event.id],

      // Source
      ['src', event.sourceIp],
      ['spt', event.sourcePort],
      ['shost', event.sourceHost],
      ['smac', event.sourceMac],

      // Destination
      ['dst', event.destinationIp],
      ['dpt', event.destinationPort],
      ['dhost', event.destinationHost],
      ['dmac', event.destinationMac],

      // Network
      ['proto', event.protocol],
      ['requestMethod', event.httpMethod],
      ['request', event.httpUrl],

      // User
      ['suser', event.user?.username],
      ['suid', event.user?.userId],

      // Outcome
      ['outcome', event.outcome],
      ['cat', event.category],

      // Device
      ['deviceProcessName', event.processName],
      ['deviceProcessId', event.processId],

      // File
      ['filePath', event.filePath],
      ['fileHash', event.fileHash],

      // Custom
      ['cs1', event.user?.tenantId],
      ['cs1Label', event.user?.tenantId ? 'TenantId' : undefined],
      ['cs2', event.requestId],
      ['cs2Label', event.requestId ? 'RequestId' : undefined],
      ['cs3', event.environment],
      ['cs3Label', event.environment ? 'Environment' : undefined],

      // Geo
      ['cs4', event.geo?.country],
      ['cs4Label', event.geo?.country ? 'Country' : undefined],
      ['cs5', event.geo?.city],
      ['cs5Label', event.geo?.city ? 'City' : undefined],

      // Threat
      ['cs6', event.threat?.threatType],
      ['cs6Label', event.threat?.threatType ? 'ThreatType' : undefined],

      // Message
      ['msg', event.description],
    ];

    return fields
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}=${this.escapeCEFExtension(String(value))}`)
      .join(' ');
  }

  /**
   * Build syslog structured data
   */
  private buildSyslogStructuredData(event: SecurityEvent): string {
    const elements: string[] = [];

    // Event metadata
    const eventData: Array<[string, string | number | undefined]> = [
      ['id', event.id],
      ['type', event.eventType],
      ['category', event.category],
      ['severity', event.severity],
      ['outcome', event.outcome],
    ];

    const eventElement = this.buildStructuredDataElement('event@47450', eventData);
    if (eventElement) {
      elements.push(eventElement);
    }

    // Source/destination
    const networkData: Array<[string, string | number | undefined]> = [
      ['srcIp', event.sourceIp],
      ['srcPort', event.sourcePort],
      ['dstIp', event.destinationIp],
      ['dstPort', event.destinationPort],
      ['proto', event.protocol],
    ];

    const networkElement = this.buildStructuredDataElement('network@47450', networkData);
    if (networkElement) {
      elements.push(networkElement);
    }

    // User context
    if (event.user) {
      const userData: Array<[string, string | number | undefined]> = [
        ['id', event.user.userId],
        ['name', event.user.username],
        ['tenantId', event.user.tenantId],
      ];

      const userElement = this.buildStructuredDataElement('user@47450', userData);
      if (userElement) {
        elements.push(userElement);
      }
    }

    // Geo context
    if (event.geo) {
      const geoData: Array<[string, string | number | undefined]> = [
        ['country', event.geo.country],
        ['city', event.geo.city],
        ['region', event.geo.region],
      ];

      const geoElement = this.buildStructuredDataElement('geo@47450', geoData);
      if (geoElement) {
        elements.push(geoElement);
      }
    }

    return elements.length > 0 ? elements.join('') : '-';
  }

  /**
   * Build a single structured data element
   */
  private buildStructuredDataElement(
    sdId: string,
    params: Array<[string, string | number | undefined]>
  ): string | null {
    const validParams = params.filter(
      ([, value]) => value !== undefined && value !== null && value !== ''
    );

    if (validParams.length === 0) {
      return null;
    }

    const paramStr = validParams
      .map(([key, value]) => `${key}="${this.escapeSyslogParamValue(String(value))}"`)
      .join(' ');

    return `[${sdId} ${paramStr}]`;
  }

  /**
   * Escape CEF header value
   */
  private escapeCEFHeader(value: string): string {
    return value.replace(/[\\|]/g, (char) => CEF_ESCAPE_MAP[char] ?? char);
  }

  /**
   * Escape CEF extension value
   */
  private escapeCEFExtension(value: string): string {
    return value.replace(/[\\=\n\r]/g, (char) => CEF_ESCAPE_MAP[char] ?? char);
  }

  /**
   * Escape syslog param value (RFC 5424)
   */
  private escapeSyslogParamValue(value: string): string {
    return value.replace(/["\]\\]/g, (char) => `\\${char}`);
  }
}

// =============================================================================
// Field Normalizer
// =============================================================================

/**
 * Normalize field names across different schemas
 */
export class FieldNormalizer {
  private readonly mappings: Record<string, string>;

  constructor(mappings?: Record<string, string>) {
    this.mappings = mappings ?? {};
  }

  /**
   * Normalize a security event's field names
   */
  normalize(event: SecurityEvent): SecurityEvent {
    if (Object.keys(this.mappings).length === 0) {
      return event;
    }

    const customFields = event.customFields
      ? this.normalizeObject(event.customFields)
      : undefined;

    return {
      ...event,
      customFields,
    };
  }

  /**
   * Normalize field names in an object
   */
  private normalizeObject(
    obj: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const normalizedKey = this.mappings[key] ?? key;

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result[normalizedKey] = this.normalizeObject(
          value as Record<string, unknown>
        );
      } else {
        result[normalizedKey] = value;
      }
    }

    return result;
  }

  /**
   * Add a field mapping
   */
  addMapping(from: string, to: string): void {
    this.mappings[from] = to;
  }

  /**
   * Remove a field mapping
   */
  removeMapping(from: string): void {
    delete this.mappings[from];
  }

  /**
   * Get all mappings
   */
  getMappings(): Record<string, string> {
    return { ...this.mappings };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an event formatter
 */
export function createEventFormatter(options?: {
  cef?: CEFConfig;
  syslog?: SyslogConfig;
}): EventFormatter {
  return new EventFormatter(options);
}

/**
 * Create a field normalizer
 */
export function createFieldNormalizer(
  mappings?: Record<string, string>
): FieldNormalizer {
  return new FieldNormalizer(mappings);
}

// =============================================================================
// Singleton Formatter
// =============================================================================

let defaultFormatter: EventFormatter | null = null;

/**
 * Get the default event formatter
 */
export function getDefaultFormatter(): EventFormatter {
  if (!defaultFormatter) {
    defaultFormatter = new EventFormatter();
  }
  return defaultFormatter;
}

/**
 * Set the default event formatter configuration
 */
export function configureDefaultFormatter(options: {
  cef?: CEFConfig;
  syslog?: SyslogConfig;
}): void {
  defaultFormatter = new EventFormatter(options);
}
