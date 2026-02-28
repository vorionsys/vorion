/**
 * AI Gateway Routing Module
 *
 * Enterprise-grade routing infrastructure for AI gateway including:
 * - Semantic routing with self-reflection
 * - Health checking with provider probing
 * - Distributed circuit breaker
 * - Priority-based request queuing
 * - Exponential backoff retry handling
 * - Per-tenant quota management
 * - SLA tracking and monitoring
 * - Gateway orchestration
 *
 * @packageDocumentation
 */

// =============================================================================
// SEMANTIC ROUTER
// =============================================================================

export {
  SemanticRouter,
  type SemanticRoute,
  type RoutingDecision as SemanticRoutingDecision,
  type ReflectionResult,
} from "./semantic-router.js";

// =============================================================================
// HEALTH CHECKER
// =============================================================================

export {
  HealthChecker,
  createHealthChecker,
  healthChecker,
  type ProviderId,
  type HealthCheckResult,
  type HealthStatus,
  type HealthCheckerConfig,
} from "./health-checker.js";

// =============================================================================
// CIRCUIT BREAKER
// =============================================================================

export {
  CircuitBreaker,
  createCircuitBreaker,
  circuitBreaker,
  type CircuitState,
  type CircuitBreakerConfig,
  type CallResult,
} from "./circuit-breaker.js";

// =============================================================================
// REQUEST QUEUE
// =============================================================================

export {
  RequestQueue,
  createRequestQueue,
  requestQueue,
  type Priority as RequestPriority,
  type QueuedRequest,
  type DequeueResult,
  type QueueConfig,
  type QueueStats,
} from "./request-queue.js";

// =============================================================================
// RETRY HANDLER
// =============================================================================

export {
  RetryHandler,
  createRetryHandler,
  retryHandler,
  sleep,
  calculateBackoff,
  type ErrorType,
  type RetryDecision,
  type RetryConfig,
  type RetryContext,
} from "./retry-handler.js";

// =============================================================================
// QUOTA MANAGER
// =============================================================================

export {
  QuotaManager,
  InMemoryQuotaStorage,
  createQuotaManager,
  quotaManager,
  checkQuotaMiddleware,
  type QuotaPeriod,
  type QuotaType,
  type QuotaLimit,
  type TenantQuotaConfig,
  type QuotaUsage,
  type QuotaCheckResult,
  type UsageRecord,
  type QuotaManagerConfig,
  type QuotaStorage,
} from "./quota-manager.js";

// =============================================================================
// SLA TRACKER
// =============================================================================

export {
  SlaTracker,
  createSlaTracker,
  slaTracker,
  exportSlaMetrics,
  type SlaMetricType,
  type SlaTarget,
  type SlaTier,
  type SlaMeasurement,
  type SlaMetricStatus,
  type SlaReport,
  type SlaTrackerConfig,
  type SlaAlert,
} from "./sla-tracker.js";

// =============================================================================
// ORCHESTRATOR
// =============================================================================

export {
  GatewayOrchestrator,
  createOrchestrator,
  getOrchestrator,
  resetOrchestrator,
  type RequestContext,
  type RoutingDecision,
  type RequestResult,
  type ProviderConfig,
  type OrchestratorConfig,
  type OrchestratorStatus,
  type ProviderExecutor,
} from "./orchestrator.js";

// =============================================================================
// CONVENIENCE RE-EXPORTS
// =============================================================================

// Local imports for use within this module
import {
  getOrchestrator as _getOrchestrator,
  createOrchestrator as _createOrchestrator,
} from "./orchestrator.js";
import { createHealthChecker as _createHealthChecker } from "./health-checker.js";
import { createCircuitBreaker as _createCircuitBreaker } from "./circuit-breaker.js";
import { createRequestQueue as _createRequestQueue } from "./request-queue.js";
import { createRetryHandler as _createRetryHandler } from "./retry-handler.js";
import { createQuotaManager as _createQuotaManager } from "./quota-manager.js";
import { createSlaTracker as _createSlaTracker } from "./sla-tracker.js";
import { SemanticRouter } from "./semantic-router.js";

/**
 * Default configured orchestrator for quick setup
 */
export const defaultOrchestrator = () => _getOrchestrator();

/**
 * Enterprise routing bundle with all components pre-configured
 */
export function createEnterpriseRouting(config?: {
  healthChecker?: Partial<import("./health-checker.js").HealthCheckerConfig>;
  circuitBreaker?: Partial<import("./circuit-breaker.js").CircuitBreakerConfig>;
  requestQueue?: Partial<import("./request-queue.js").QueueConfig>;
  retryHandler?: Partial<import("./retry-handler.js").RetryConfig>;
  quotaManager?: Partial<import("./quota-manager.js").QuotaManagerConfig>;
  slaTracker?: Partial<import("./sla-tracker.js").SlaTrackerConfig>;
  orchestrator?: Partial<import("./orchestrator.js").OrchestratorConfig>;
}) {
  return {
    healthChecker: _createHealthChecker(config?.healthChecker),
    circuitBreaker: _createCircuitBreaker(config?.circuitBreaker),
    requestQueue: _createRequestQueue(config?.requestQueue),
    retryHandler: _createRetryHandler(config?.retryHandler),
    quotaManager: _createQuotaManager(undefined, config?.quotaManager),
    slaTracker: _createSlaTracker(config?.slaTracker),
    orchestrator: _createOrchestrator(config?.orchestrator),
    semanticRouter: new SemanticRouter(),
  };
}
