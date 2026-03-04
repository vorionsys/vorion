/**
 * SIEM Connector Types
 *
 * Type definitions for the SIEM (Security Information and Event Management)
 * connector framework including:
 * - Security event structures
 * - Connector configurations
 * - Event formats (CEF, JSON, Syslog)
 * - Enrichment options
 *
 * @packageDocumentation
 * @module security/siem/types
 */

import { z } from 'zod';

// =============================================================================
// Event Severity & Types
// =============================================================================

/**
 * Event severity levels (aligned with CEF standard)
 */
export const EventSeverity = {
  UNKNOWN: 0,
  LOW: 1,
  MEDIUM: 4,
  HIGH: 7,
  CRITICAL: 10,
} as const;

export type EventSeverity = (typeof EventSeverity)[keyof typeof EventSeverity];

export const eventSeveritySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(4),
  z.literal(7),
  z.literal(10),
]);

/**
 * Event categories
 */
export const EventCategory = {
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  NETWORK: 'network',
  APPLICATION: 'application',
  SYSTEM: 'system',
  MALWARE: 'malware',
  DATA: 'data',
  POLICY: 'policy',
  ANOMALY: 'anomaly',
  AUDIT: 'audit',
} as const;

export type EventCategory = (typeof EventCategory)[keyof typeof EventCategory];

export const eventCategorySchema = z.nativeEnum(EventCategory);

/**
 * Event action outcome
 */
export const EventOutcome = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  UNKNOWN: 'unknown',
} as const;

export type EventOutcome = (typeof EventOutcome)[keyof typeof EventOutcome];

export const eventOutcomeSchema = z.nativeEnum(EventOutcome);

// =============================================================================
// Security Event
// =============================================================================

/**
 * Geographic location data for events
 */
export interface GeoLocation {
  /** Country name */
  country?: string;
  /** Country ISO code */
  countryCode?: string;
  /** City name */
  city?: string;
  /** Region/state */
  region?: string;
  /** Latitude */
  latitude?: number;
  /** Longitude */
  longitude?: number;
  /** Timezone */
  timezone?: string;
}

export const geoLocationSchema = z.object({
  country: z.string().optional(),
  countryCode: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  timezone: z.string().optional(),
});

/**
 * Threat intelligence context
 */
export interface ThreatContext {
  /** Known threat indicator */
  indicator?: string;
  /** Threat type (e.g., malware, botnet, spam) */
  threatType?: string;
  /** Confidence score (0-100) */
  confidence?: number;
  /** Threat feed source */
  source?: string;
  /** First seen timestamp */
  firstSeen?: Date;
  /** Last seen timestamp */
  lastSeen?: Date;
  /** Associated malware families */
  malwareFamilies?: string[];
  /** Associated threat actors */
  threatActors?: string[];
  /** MITRE ATT&CK techniques */
  mitreAttack?: string[];
}

export const threatContextSchema = z.object({
  indicator: z.string().optional(),
  threatType: z.string().optional(),
  confidence: z.number().min(0).max(100).optional(),
  source: z.string().optional(),
  firstSeen: z.coerce.date().optional(),
  lastSeen: z.coerce.date().optional(),
  malwareFamilies: z.array(z.string()).optional(),
  threatActors: z.array(z.string()).optional(),
  mitreAttack: z.array(z.string()).optional(),
});

/**
 * User context for events
 */
export interface UserContext {
  /** User ID */
  userId?: string;
  /** Username */
  username?: string;
  /** User email */
  email?: string;
  /** User roles */
  roles?: string[];
  /** User groups */
  groups?: string[];
  /** Tenant/organization ID */
  tenantId?: string;
  /** Tenant/organization name */
  tenantName?: string;
  /** Department */
  department?: string;
  /** Whether user is privileged */
  privileged?: boolean;
}

export const userContextSchema = z.object({
  userId: z.string().optional(),
  username: z.string().optional(),
  email: z.string().optional(),
  roles: z.array(z.string()).optional(),
  groups: z.array(z.string()).optional(),
  tenantId: z.string().optional(),
  tenantName: z.string().optional(),
  department: z.string().optional(),
  privileged: z.boolean().optional(),
});

/**
 * A security event to be sent to SIEM
 */
export interface SecurityEvent {
  /** Unique event ID */
  id: string;
  /** Event timestamp */
  timestamp: Date;
  /** Event type/name */
  eventType: string;
  /** Event category */
  category: EventCategory;
  /** Event severity (0-10) */
  severity: EventSeverity;
  /** Action outcome */
  outcome: EventOutcome;
  /** Human-readable message */
  message: string;
  /** Detailed description */
  description?: string;

  // Source information
  /** Source IP address */
  sourceIp?: string;
  /** Source port */
  sourcePort?: number;
  /** Source hostname */
  sourceHost?: string;
  /** Source MAC address */
  sourceMac?: string;

  // Destination information
  /** Destination IP address */
  destinationIp?: string;
  /** Destination port */
  destinationPort?: number;
  /** Destination hostname */
  destinationHost?: string;
  /** Destination MAC address */
  destinationMac?: string;

  // Network information
  /** Network protocol */
  protocol?: string;
  /** HTTP method */
  httpMethod?: string;
  /** HTTP URL */
  httpUrl?: string;
  /** HTTP status code */
  httpStatusCode?: number;
  /** User agent */
  userAgent?: string;
  /** Request ID */
  requestId?: string;

  // Process information
  /** Process name */
  processName?: string;
  /** Process ID */
  processId?: number;
  /** File path */
  filePath?: string;
  /** File hash */
  fileHash?: string;

  // Context
  /** User context */
  user?: UserContext;
  /** Geographic location */
  geo?: GeoLocation;
  /** Threat intelligence context */
  threat?: ThreatContext;

  // Source system
  /** Source application/service name */
  source: string;
  /** Source component */
  component?: string;
  /** Source version */
  version?: string;
  /** Environment (production, staging, etc.) */
  environment?: string;

  // Classification
  /** Event tags */
  tags?: string[];
  /** Custom fields */
  customFields?: Record<string, unknown>;

  // Raw data
  /** Raw event data for detailed analysis */
  rawData?: Record<string, unknown>;
}

export const securityEventSchema = z.object({
  id: z.string().min(1),
  timestamp: z.coerce.date(),
  eventType: z.string().min(1),
  category: eventCategorySchema,
  severity: eventSeveritySchema,
  outcome: eventOutcomeSchema,
  message: z.string().min(1),
  description: z.string().optional(),
  sourceIp: z.string().optional(),
  sourcePort: z.number().int().optional(),
  sourceHost: z.string().optional(),
  sourceMac: z.string().optional(),
  destinationIp: z.string().optional(),
  destinationPort: z.number().int().optional(),
  destinationHost: z.string().optional(),
  destinationMac: z.string().optional(),
  protocol: z.string().optional(),
  httpMethod: z.string().optional(),
  httpUrl: z.string().optional(),
  httpStatusCode: z.number().int().optional(),
  userAgent: z.string().optional(),
  requestId: z.string().optional(),
  processName: z.string().optional(),
  processId: z.number().int().optional(),
  filePath: z.string().optional(),
  fileHash: z.string().optional(),
  user: userContextSchema.optional(),
  geo: geoLocationSchema.optional(),
  threat: threatContextSchema.optional(),
  source: z.string().min(1),
  component: z.string().optional(),
  version: z.string().optional(),
  environment: z.string().optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.unknown()).optional(),
  rawData: z.record(z.unknown()).optional(),
});

// =============================================================================
// Send Result
// =============================================================================

/**
 * Result of sending events to a SIEM connector
 */
export interface SendResult {
  /** Whether the send was successful */
  success: boolean;
  /** Number of events sent */
  eventsSent: number;
  /** Number of events that failed */
  eventsFailed: number;
  /** Error message if failed */
  error?: string;
  /** Time taken in milliseconds */
  durationMs: number;
  /** Response from the SIEM system */
  response?: unknown;
  /** IDs of failed events */
  failedEventIds?: string[];
}

export const sendResultSchema = z.object({
  success: z.boolean(),
  eventsSent: z.number().int().nonnegative(),
  eventsFailed: z.number().int().nonnegative(),
  error: z.string().optional(),
  durationMs: z.number().nonnegative(),
  response: z.unknown().optional(),
  failedEventIds: z.array(z.string()).optional(),
});

// =============================================================================
// Connector Configuration
// =============================================================================

/**
 * Base connector configuration
 */
export interface BaseConnectorConfig {
  /** Connector name */
  name: string;
  /** Whether connector is enabled */
  enabled: boolean;
  /** Request timeout in ms */
  timeout?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms */
  retryDelayMs?: number;
  /** Maximum backoff delay in ms */
  maxRetryDelayMs?: number;
  /** Batch size for bulk operations */
  batchSize?: number;
}

export const baseConnectorConfigSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  timeout: z.number().int().positive().default(30000),
  maxRetries: z.number().int().nonnegative().default(3),
  retryDelayMs: z.number().int().positive().default(1000),
  maxRetryDelayMs: z.number().int().positive().default(30000),
  batchSize: z.number().int().positive().default(100),
});

/**
 * Splunk HEC connector configuration
 */
export interface SplunkConnectorConfig extends BaseConnectorConfig {
  type: 'splunk';
  /** Splunk HEC URL */
  hecUrl: string;
  /** HEC token */
  token: string;
  /** Default index */
  index?: string;
  /** Default sourcetype */
  sourcetype?: string;
  /** Default source */
  source?: string;
  /** Default host */
  host?: string;
  /** Whether to verify SSL */
  verifySsl?: boolean;
  /** Custom fields to add to all events */
  defaultFields?: Record<string, string>;
}

export const splunkConnectorConfigSchema = baseConnectorConfigSchema.extend({
  type: z.literal('splunk'),
  hecUrl: z.string().url(),
  token: z.string().min(1),
  index: z.string().optional(),
  sourcetype: z.string().optional(),
  source: z.string().optional(),
  host: z.string().optional(),
  verifySsl: z.boolean().default(true),
  defaultFields: z.record(z.string()).optional(),
});

/**
 * Elasticsearch connector configuration
 */
export interface ElasticConnectorConfig extends BaseConnectorConfig {
  type: 'elastic';
  /** Elasticsearch node URLs */
  nodes: string[];
  /** Authentication type */
  auth: 'apiKey' | 'basic' | 'bearer' | 'none';
  /** API key (for apiKey auth) */
  apiKey?: string;
  /** Username (for basic auth) */
  username?: string;
  /** Password (for basic auth) */
  password?: string;
  /** Bearer token (for bearer auth) */
  bearerToken?: string;
  /** Cloud ID (for Elastic Cloud) */
  cloudId?: string;
  /** Index name or pattern */
  index: string;
  /** Pipeline name */
  pipeline?: string;
  /** Whether to verify SSL */
  verifySsl?: boolean;
  /** Refresh policy */
  refresh?: 'true' | 'false' | 'wait_for';
  /** Custom CA certificate */
  caCert?: string;
}

export const elasticConnectorConfigSchema = baseConnectorConfigSchema.extend({
  type: z.literal('elastic'),
  nodes: z.array(z.string().url()).min(1),
  auth: z.enum(['apiKey', 'basic', 'bearer', 'none']),
  apiKey: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  bearerToken: z.string().optional(),
  cloudId: z.string().optional(),
  index: z.string().min(1),
  pipeline: z.string().optional(),
  verifySsl: z.boolean().default(true),
  refresh: z.enum(['true', 'false', 'wait_for']).optional(),
  caCert: z.string().optional(),
});

/**
 * Datadog connector configuration
 */
export interface DatadogConnectorConfig extends BaseConnectorConfig {
  type: 'datadog';
  /** Datadog site (us1, us3, us5, eu1, ap1) */
  site: 'us1' | 'us3' | 'us5' | 'eu1' | 'ap1';
  /** API key */
  apiKey: string;
  /** Service name */
  service: string;
  /** Source */
  source?: string;
  /** Hostname */
  hostname?: string;
  /** Default tags */
  tags?: string[];
  /** Whether to compress payloads */
  compress?: boolean;
}

export const datadogConnectorConfigSchema = baseConnectorConfigSchema.extend({
  type: z.literal('datadog'),
  site: z.enum(['us1', 'us3', 'us5', 'eu1', 'ap1']),
  apiKey: z.string().min(1),
  service: z.string().min(1),
  source: z.string().optional(),
  hostname: z.string().optional(),
  tags: z.array(z.string()).optional(),
  compress: z.boolean().default(true),
});

/**
 * Union type for all connector configurations
 */
export type ConnectorConfig =
  | SplunkConnectorConfig
  | ElasticConnectorConfig
  | DatadogConnectorConfig;

export const connectorConfigSchema = z.discriminatedUnion('type', [
  splunkConnectorConfigSchema,
  elasticConnectorConfigSchema,
  datadogConnectorConfigSchema,
]);

// =============================================================================
// Event Format Configuration
// =============================================================================

/**
 * Event output format
 */
export const EventFormat = {
  JSON: 'json',
  CEF: 'cef',
  SYSLOG: 'syslog',
} as const;

export type EventFormat = (typeof EventFormat)[keyof typeof EventFormat];

export const eventFormatSchema = z.nativeEnum(EventFormat);

/**
 * CEF format configuration
 */
export interface CEFConfig {
  /** CEF vendor name */
  vendor: string;
  /** CEF product name */
  product: string;
  /** CEF product version */
  version: string;
  /** Device event class ID prefix */
  deviceEventClassIdPrefix?: string;
}

export const cefConfigSchema = z.object({
  vendor: z.string().min(1),
  product: z.string().min(1),
  version: z.string().min(1),
  deviceEventClassIdPrefix: z.string().optional(),
});

/**
 * Syslog format configuration (RFC 5424)
 */
export interface SyslogConfig {
  /** Syslog facility (0-23) */
  facility: number;
  /** Application name */
  appName: string;
  /** Process ID */
  procId?: string;
  /** Message ID */
  msgId?: string;
  /** Include structured data */
  includeStructuredData?: boolean;
}

export const syslogConfigSchema = z.object({
  facility: z.number().int().min(0).max(23),
  appName: z.string().min(1),
  procId: z.string().optional(),
  msgId: z.string().optional(),
  includeStructuredData: z.boolean().default(true),
});

// =============================================================================
// Enrichment Configuration
// =============================================================================

/**
 * Geo-location enrichment configuration
 */
export interface GeoEnrichmentConfig {
  /** Whether geo enrichment is enabled */
  enabled: boolean;
  /** IP fields to enrich */
  ipFields?: string[];
  /** GeoIP database path */
  databasePath?: string;
  /** GeoIP service URL */
  serviceUrl?: string;
  /** Cache TTL in seconds */
  cacheTtlSeconds?: number;
}

export const geoEnrichmentConfigSchema = z.object({
  enabled: z.boolean().default(false),
  ipFields: z.array(z.string()).default(['sourceIp', 'destinationIp']),
  databasePath: z.string().optional(),
  serviceUrl: z.string().url().optional(),
  cacheTtlSeconds: z.number().int().positive().default(3600),
});

/**
 * Threat intelligence enrichment configuration
 */
export interface ThreatEnrichmentConfig {
  /** Whether threat enrichment is enabled */
  enabled: boolean;
  /** Threat intel service URL */
  serviceUrl?: string;
  /** API key for threat intel service */
  apiKey?: string;
  /** Fields to check for indicators */
  indicatorFields?: string[];
  /** Cache TTL in seconds */
  cacheTtlSeconds?: number;
}

export const threatEnrichmentConfigSchema = z.object({
  enabled: z.boolean().default(false),
  serviceUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  indicatorFields: z.array(z.string()).default(['sourceIp', 'destinationIp', 'fileHash']),
  cacheTtlSeconds: z.number().int().positive().default(3600),
});

/**
 * User context enrichment configuration
 */
export interface UserEnrichmentConfig {
  /** Whether user enrichment is enabled */
  enabled: boolean;
  /** User service URL */
  serviceUrl?: string;
  /** Include roles */
  includeRoles?: boolean;
  /** Include groups */
  includeGroups?: boolean;
  /** Include tenant info */
  includeTenant?: boolean;
  /** Cache TTL in seconds */
  cacheTtlSeconds?: number;
}

export const userEnrichmentConfigSchema = z.object({
  enabled: z.boolean().default(false),
  serviceUrl: z.string().url().optional(),
  includeRoles: z.boolean().default(true),
  includeGroups: z.boolean().default(true),
  includeTenant: z.boolean().default(true),
  cacheTtlSeconds: z.number().int().positive().default(300),
});

/**
 * Combined enrichment configuration
 */
export interface EnrichmentConfig {
  /** Geo-location enrichment */
  geo?: GeoEnrichmentConfig;
  /** Threat intelligence enrichment */
  threat?: ThreatEnrichmentConfig;
  /** User context enrichment */
  user?: UserEnrichmentConfig;
  /** Field name normalization mapping */
  fieldNormalization?: Record<string, string>;
}

export const enrichmentConfigSchema = z.object({
  geo: geoEnrichmentConfigSchema.optional(),
  threat: threatEnrichmentConfigSchema.optional(),
  user: userEnrichmentConfigSchema.optional(),
  fieldNormalization: z.record(z.string()).optional(),
});

// =============================================================================
// SIEM Service Configuration
// =============================================================================

/**
 * SIEM service configuration
 */
export interface SIEMConfig {
  /** List of connector configurations */
  connectors: ConnectorConfig[];
  /** Batch size for buffering */
  batchSize: number;
  /** Flush interval in milliseconds */
  flushIntervalMs: number;
  /** Enabled event types (empty = all) */
  enabledEventTypes: string[];
  /** Enrichment configuration */
  enrichment: EnrichmentConfig;
  /** Default event format */
  defaultFormat?: EventFormat;
  /** CEF configuration */
  cef?: CEFConfig;
  /** Syslog configuration */
  syslog?: SyslogConfig;
  /** Circuit breaker failure threshold */
  circuitBreakerThreshold?: number;
  /** Circuit breaker reset timeout in ms */
  circuitBreakerResetMs?: number;
  /** Whether to log events to console (for debugging) */
  debugLogging?: boolean;
  /** Redis key prefix for metrics */
  redisKeyPrefix?: string;
}

export const siemConfigSchema = z.object({
  connectors: z.array(connectorConfigSchema).default([]),
  batchSize: z.number().int().positive().default(100),
  flushIntervalMs: z.number().int().positive().default(5000),
  enabledEventTypes: z.array(z.string()).default([]),
  enrichment: enrichmentConfigSchema.default({}),
  defaultFormat: eventFormatSchema.optional(),
  cef: cefConfigSchema.optional(),
  syslog: syslogConfigSchema.optional(),
  circuitBreakerThreshold: z.number().int().positive().default(5),
  circuitBreakerResetMs: z.number().int().positive().default(60000),
  debugLogging: z.boolean().default(false),
  redisKeyPrefix: z.string().default('vorion:siem:'),
});

/**
 * Default SIEM configuration
 */
export const DEFAULT_SIEM_CONFIG: Partial<SIEMConfig> = {
  batchSize: 100,
  flushIntervalMs: 5000,
  enabledEventTypes: [],
  enrichment: {},
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 60000,
  debugLogging: false,
  redisKeyPrefix: 'vorion:siem:',
};

// =============================================================================
// Metrics Types
// =============================================================================

/**
 * SIEM connector metrics
 */
export interface SIEMMetrics {
  /** Total events sent */
  eventsSent: number;
  /** Total events failed */
  eventsFailed: number;
  /** Total batches sent */
  batchesSent: number;
  /** Total batches failed */
  batchesFailed: number;
  /** Average latency in ms */
  avgLatencyMs: number;
  /** Events in current buffer */
  bufferSize: number;
  /** Connector status by name */
  connectorStatus: Record<string, 'connected' | 'disconnected' | 'circuit_open'>;
  /** Last send timestamp */
  lastSendTime?: Date;
  /** Last error */
  lastError?: string;
}

// =============================================================================
// Integration Hook Types
// =============================================================================

/**
 * Event filter function
 */
export type EventFilter = (event: SecurityEvent) => boolean;

/**
 * Event transformer function
 */
export type EventTransformer = (event: SecurityEvent) => SecurityEvent;

/**
 * Hook for integration with other systems
 */
export interface IntegrationHook {
  /** Hook name */
  name: string;
  /** Event types to handle (empty = all) */
  eventTypes: string[];
  /** Filter function */
  filter?: EventFilter;
  /** Transformer function */
  transformer?: EventTransformer;
  /** Whether hook is enabled */
  enabled: boolean;
}
