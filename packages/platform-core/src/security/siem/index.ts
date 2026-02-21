/**
 * SIEM Connector Framework
 *
 * Enterprise SIEM (Security Information and Event Management) integration
 * framework supporting multiple SIEM platforms:
 * - Splunk (HTTP Event Collector)
 * - Elasticsearch/OpenSearch
 * - Datadog
 *
 * Features:
 * - Multiple connector support with fan-out
 * - Event buffering and batching
 * - Circuit breaker per connector
 * - Event enrichment (geo, threat intel, user context)
 * - Multiple output formats (JSON, CEF, Syslog)
 * - Integration hooks for alerts, audit, anomalies
 *
 * @example
 * ```typescript
 * import {
 *   getSIEMService,
 *   registerStandardHooks,
 *   forwardSecurityAlert,
 * } from './security/siem';
 *
 * // Get the SIEM service
 * const siemService = getSIEMService({
 *   connectors: [
 *     {
 *       type: 'splunk',
 *       name: 'splunk-prod',
 *       enabled: true,
 *       hecUrl: 'https://splunk.example.com:8088',
 *       token: 'your-hec-token',
 *       index: 'security',
 *       sourcetype: 'vorion:security',
 *     },
 *   ],
 *   batchSize: 100,
 *   flushIntervalMs: 5000,
 * });
 *
 * // Register standard hooks
 * registerStandardHooks(siemService);
 *
 * // Connect all connectors
 * await siemService.connectAll();
 *
 * // Send an event
 * await siemService.send({
 *   id: 'event-123',
 *   timestamp: new Date(),
 *   eventType: 'login.failed',
 *   category: 'authentication',
 *   severity: 4,
 *   outcome: 'failure',
 *   message: 'Failed login attempt',
 *   sourceIp: '192.168.1.100',
 *   user: { userId: 'user-123' },
 *   source: 'vorion',
 * });
 *
 * // Or forward security alerts
 * await forwardSecurityAlert(siemService, alert);
 * ```
 *
 * @packageDocumentation
 * @module security/siem
 */

// =============================================================================
// Type Exports
// =============================================================================

export type {
  // Event types
  SecurityEvent,
  SendResult,
  GeoLocation,
  ThreatContext,
  UserContext,

  // Connector configs
  BaseConnectorConfig,
  SplunkConnectorConfig,
  ElasticConnectorConfig,
  DatadogConnectorConfig,
  ConnectorConfig,

  // Format configs
  CEFConfig,
  SyslogConfig,

  // Enrichment configs
  GeoEnrichmentConfig,
  ThreatEnrichmentConfig,
  UserEnrichmentConfig,
  EnrichmentConfig,

  // Service config
  SIEMConfig,
  SIEMMetrics,

  // Hooks
  IntegrationHook,
  EventFilter,
  EventTransformer,
} from './types.js';

// Enum/const exports
export {
  EventSeverity,
  EventCategory,
  EventOutcome,
  EventFormat,
  DEFAULT_SIEM_CONFIG,
} from './types.js';

// =============================================================================
// Connector Exports
// =============================================================================

export type { SIEMConnector, ConnectorFactory } from './connector.js';

export {
  BaseSIEMConnector,
  registerConnectorFactory,
  getConnectorFactory,
  getRegisteredConnectorTypes,
} from './connector.js';

// Splunk
export { SplunkConnector, createSplunkConnector } from './splunk.js';

// Elasticsearch
export { ElasticConnector, createElasticConnector } from './elastic.js';

// Datadog
export { DatadogConnector, createDatadogConnector } from './datadog.js';

// =============================================================================
// Formatter Exports
// =============================================================================

export {
  EventFormatter,
  FieldNormalizer,
  createEventFormatter,
  createFieldNormalizer,
  getDefaultFormatter,
  configureDefaultFormatter,
} from './formatter.js';

// =============================================================================
// Enrichment Exports
// =============================================================================

export type {
  EnrichmentResult,
  GeoEnrichmentProvider,
  ThreatEnrichmentProvider,
  UserEnrichmentProvider,
} from './enrichment.js';

export {
  EventEnricher,
  DefaultGeoProvider,
  DefaultThreatProvider,
  DefaultUserProvider,
  createEventEnricher,
  createNoOpEnricher,
} from './enrichment.js';

// =============================================================================
// Service Exports
// =============================================================================

export {
  SIEMService,
  getSIEMService,
  resetSIEMService,
  createSIEMService,
} from './service.js';

// =============================================================================
// Hook Exports
// =============================================================================

export type {
  SecurityAlertHookConfig,
  AuditLogHookConfig,
  AnomalyHookConfig,
} from './hooks.js';

export {
  // Hook creators
  createSecurityAlertHook,
  createAuditLogHook,
  createAnomalyHook,

  // Event converters
  securityAlertToEvent,
  auditRecordToEvent,
  anomalyToEvent,

  // Helper functions
  registerStandardHooks,
  forwardSecurityAlert,
  forwardAuditRecord,
  forwardAnomaly,
} from './hooks.js';
