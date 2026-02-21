/**
 * Observability Module
 *
 * Unified observability for Agent Anchor including:
 * - Prometheus metrics for all subsystems
 * - Structured logging with trace context
 * - Distributed tracing with OpenTelemetry
 * - Health checks for Kubernetes probes
 * - Alerting rules and notifications
 *
 * @packageDocumentation
 */

// Metrics
export {
  anchorRegistry,
  // Agent Registry Metrics
  agentsRegisteredTotal,
  agentsCurrentByState,
  agentStateTransitions,
  agentRegistrationDuration,
  // Trust Score Metrics
  trustScoreComputations,
  trustScoreComputationDuration,
  trustScoreDistribution,
  agentsByTier,
  tierTransitions,
  humanApprovalRequests,
  // Attestation Metrics
  attestationsSubmitted,
  attestationProcessingDuration,
  attestationBatchSize,
  attestationsPending,
  // A2A Metrics
  a2aInvocationsTotal,
  a2aInvocationDuration,
  a2aChainDepth,
  a2aActiveChains,
  a2aTrustVerifications,
  a2aDelegationUsage,
  a2aCircuitBreakerStateChanges,
  a2aRegisteredEndpoints,
  // Sandbox Metrics
  sandboxContainersCreated,
  sandboxContainersActive,
  sandboxContainerDuration,
  capabilityRequests,
  networkPolicyViolations,
  filesystemPolicyViolations,
  sandboxResourceUsage,
  // API Metrics
  apiRequestsTotal,
  apiRequestDuration,
  apiErrors,
  // A3I Cache Metrics
  a3iCacheOperations,
  a3iSyncOperations,
  a3iSyncDuration,
  // Database Replication Metrics
  dbReplicationLagBytes,
  dbReplicationLagSeconds,
  dbReplicaStatus,
  dbClusterHealth,
  dbHealthyReplicaCount,
  dbFailoverEvents,
  dbHealthCheckDuration,
  // Helpers
  recordAgentRegistration,
  recordTrustScoreComputation,
  recordA2AInvocation,
  recordAttestation,
  recordSandboxContainer,
  recordDbReplicationLag,
  recordDbClusterHealth,
  recordDbFailover,
  recordDbHealthCheck,
  getMetrics,
  getMetricsContentType,
} from './metrics.js';

// Logging
export {
  type LogContext,
  type StructuredLogger,
  type LoggingConfig,
  initLogging,
  getLogger,
  createComponentLogger,
  createAgentLogger,
  createA2ALogger,
  createSandboxLogger,
  logAgentEvent,
  logTrustChange,
  logA2AInvocation,
  logSandboxEvent,
  logAttestation,
} from './logging.js';

// Tracing
export {
  AnchorAttributes,
  getTracer,
  type SpanOptions,
  startAgentSpan,
  startA2ASpan,
  startA2AServerSpan,
  startTrustVerificationSpan,
  startSandboxSpan,
  startAttestationSpan,
  endSpanSuccess,
  endSpanError,
  addTrustToSpan,
  addChainToSpan,
  injectTraceContext,
  extractTraceContext,
  withExtractedContext,
  traceAsync,
  traceAgentRegistration,
  traceA2AInvocation,
  traceSandboxExecution,
} from './tracing.js';

// Health Checks
export {
  type HealthStatus,
  type ComponentHealth,
  type OverallHealth,
  type HealthCheck,
  registerHealthCheck,
  unregisterHealthCheck,
  clearHealthChecks,
  createDatabaseHealthCheck,
  createRedisHealthCheck,
  createExternalServiceHealthCheck,
  createMemoryHealthCheck,
  createAgentAnchorHealthCheck,
  createA2AHealthCheck,
  createSandboxHealthCheck,
  checkHealth,
  isAlive,
  isReady,
  registerHealthRoutes,
  initHealthChecks,
} from './health.js';

// Alerting
export {
  type AlertSeverity,
  type AlertState,
  type AlertRule,
  type AlertCondition,
  type Alert,
  type AlertNotification,
  type AlertHandler,
  DEFAULT_ALERT_RULES,
  AlertManager,
  createAlertManager,
  getAlertManager,
  loggingAlertHandler,
  createWebhookAlertHandler,
} from './alerts.js';

// ============================================================================
// Initialization
// ============================================================================

import { initLogging } from './logging.js';
import { initHealthChecks } from './health.js';
import { createAlertManager, loggingAlertHandler } from './alerts.js';
import { createLogger } from '../common/logger.js';

const logger = createLogger({ component: 'observability' });

export interface ObservabilityConfig {
  logging?: {
    level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    pretty?: boolean;
  };
  alertWebhookUrl?: string;
}

/**
 * Initialize all observability subsystems
 */
export function initObservability(config: ObservabilityConfig = {}): void {
  // Initialize logging
  initLogging({
    level: config.logging?.level ?? 'info',
    pretty: config.logging?.pretty ?? process.env.NODE_ENV !== 'production',
    includeTraceContext: true,
    redact: ['password', 'apiKey', 'secret', 'token', 'authorization'],
    serviceName: 'vorion-anchor',
  });

  // Initialize health checks
  initHealthChecks();

  // Initialize alerting
  const alertManager = createAlertManager();
  alertManager.onAlert(loggingAlertHandler);

  if (config.alertWebhookUrl) {
    const { createWebhookAlertHandler } = require('./alerts.js');
    alertManager.onAlert(createWebhookAlertHandler(config.alertWebhookUrl));
  }

  logger.info('Observability subsystems initialized');
}
