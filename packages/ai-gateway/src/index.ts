/**
 * @vorionsys/ai-gateway
 *
 * Multi-provider AI Gateway with intelligent routing, sustainability, and self-reflection
 * Extracted from BAI Command Center for the Vorion AI Governance Platform
 *
 * Enterprise Features:
 * - Health checking with provider probing
 * - Distributed circuit breaker
 * - Priority-based request queuing
 * - Exponential backoff retry handling
 * - Per-tenant quota management
 * - SLA tracking and monitoring
 * - Gateway orchestration
 */

export { AIGateway, createGateway } from './gateway.js'
export type {
  GatewayMessage,
  GatewayRequest,
  GatewayResponse,
  RoutingDecision
} from './gateway.js'

// Sustainability modules
export { carbonTracker, CarbonTracker } from './sustainability/carbon-tracker.js'
export { greenRouter, GreenRouter } from './sustainability/green-route.js'
export type {
  CarbonMetrics,
  ModelEnergyProfile
} from './sustainability/carbon-tracker.js'
export type {
  GreenRoutingPolicy,
  GreenRouteDecision
} from './sustainability/green-route.js'

// Semantic routing with self-reflection
export { semanticRouter, SemanticRouter } from './routing/semantic-router.js'
export type {
  SemanticRoute,
  RoutingDecision as SemanticRoutingDecision,
  ReflectionResult
} from './routing/semantic-router.js'

// =============================================================================
// ENTERPRISE ROUTING INFRASTRUCTURE
// =============================================================================

// Health Checker
export {
  HealthChecker,
  createHealthChecker,
  healthChecker,
} from './routing/health-checker.js'
export type {
  ProviderId,
  HealthCheckResult,
  HealthStatus,
  HealthCheckerConfig,
} from './routing/health-checker.js'

// Circuit Breaker
export {
  CircuitBreaker,
  createCircuitBreaker,
  circuitBreaker,
} from './routing/circuit-breaker.js'
export type {
  CircuitState,
  CircuitBreakerConfig,
  CallResult,
} from './routing/circuit-breaker.js'

// Request Queue
export {
  RequestQueue,
  createRequestQueue,
  requestQueue,
} from './routing/request-queue.js'
export type {
  Priority as RequestPriority,
  QueuedRequest,
  DequeueResult,
  QueueConfig,
  QueueStats,
} from './routing/request-queue.js'

// Retry Handler
export {
  RetryHandler,
  createRetryHandler,
  retryHandler,
  sleep,
  calculateBackoff,
} from './routing/retry-handler.js'
export type {
  ErrorType,
  RetryDecision,
  RetryConfig,
  RetryContext,
} from './routing/retry-handler.js'

// Quota Manager
export {
  QuotaManager,
  InMemoryQuotaStorage,
  createQuotaManager,
  quotaManager,
  checkQuotaMiddleware,
} from './routing/quota-manager.js'
export type {
  QuotaPeriod,
  QuotaType,
  QuotaLimit,
  TenantQuotaConfig,
  QuotaUsage,
  QuotaCheckResult,
  UsageRecord,
  QuotaManagerConfig,
  QuotaStorage,
} from './routing/quota-manager.js'

// SLA Tracker
export {
  SlaTracker,
  createSlaTracker,
  slaTracker,
  exportSlaMetrics,
} from './routing/sla-tracker.js'
export type {
  SlaMetricType,
  SlaTarget,
  SlaTier,
  SlaMeasurement,
  SlaMetricStatus,
  SlaReport,
  SlaTrackerConfig,
  SlaAlert,
} from './routing/sla-tracker.js'

// Orchestrator
export {
  GatewayOrchestrator,
  createOrchestrator,
  getOrchestrator,
  resetOrchestrator,
} from './routing/orchestrator.js'
export type {
  RequestContext,
  RoutingDecision as OrchestratorRoutingDecision,
  RequestResult,
  ProviderConfig,
  OrchestratorConfig,
  OrchestratorStatus,
  ProviderExecutor,
} from './routing/orchestrator.js'

// Enterprise bundle
export { createEnterpriseRouting } from './routing/index.js'
