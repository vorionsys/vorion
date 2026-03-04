/**
 * Vorion - Governed AI Execution Platform
 *
 * @packageDocumentation
 */

export * from './common/types.js';
export * from './basis/index.js';

// Intent module - explicitly exclude scoreToTier and tierToMinScore to avoid conflict with trust-engine
export {
  PAYLOAD_LIMITS,
  intentPayloadSchema,
  intentSubmissionSchema,
  bulkIntentOptionsSchema,
  bulkIntentSubmissionSchema,
  IntentService,
  createIntentService,
  ConsentService,
  ConsentRequiredError,
  ConsentPolicyNotFoundError,
  createConsentService,
  intentOpenApiSpec,
  getOpenApiSpec,
  getOpenApiSpecJson,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  IntentClassifier,
  createIntentClassifier,
  RiskAssessor,
  createRiskAssessor,
  ACTION_PATTERNS,
  RESOURCE_SENSITIVITY,
  matchActionPattern,
  matchResourceSensitivity,
  getResourceSensitivityLevel,
  getResourceRiskTier,
  inferCategoryFromAction,
  requiresApproval,
  // Renamed exports to avoid conflict with trust-engine
  scoreToTier as riskScoreToTier,
  tierToMinScore as riskTierToMinScore,
} from './intent/index.js';

// Route registration - imported directly from routes module
export { registerIntentRoutes } from './intent/routes.js';

// Shutdown utilities - imported directly to avoid circular dependencies
export {
  isServerShuttingDown,
  getActiveRequestCount,
  getLastShutdownMetrics,
  trackRequest,
  gracefulShutdown,
  registerShutdownHandlers,
  registerEnhancedShutdownHandlers,
  shutdownRequestHook,
  shutdownResponseHook,
  resetShutdownState,
} from './intent/shutdown.js';

// Queue utilities for health checks
export {
  checkQueueHealth,
  areWorkersRunning,
  getQueueDepth,
  pauseWorkers,
  resumeWorkers,
  waitForActiveJobs,
} from './intent/queues.js';

export type {
  IntentSubmission,
  BulkIntentOptions,
  BulkIntentSubmission,
  BulkIntentFailure,
  BulkIntentResult,
  SubmitOptions,
  ListOptions,
  CancelOptions,
  IntentWithEvents,
  ConsentType,
  ConsentMetadata,
  UserConsent,
  ConsentPolicy,
  ConsentHistoryEntry,
  ConsentValidationResult,
  PaginatedResult,
  Classification,
  IntentClassifierConfig,
  CreateIntent,
  RiskAssessment,
  HistoricalPattern,
  RiskAssessorConfig,
  RiskFactor,
  RequiredApprovals,
  ApprovalType,
  IntentCategory,
  RiskTier,
  ActionPattern,
  ResourceSensitivity,
} from './intent/index.js';

export type {
  GracefulShutdownOptions,
  EnhancedShutdownOptions,
  ShutdownMetrics,
} from './intent/shutdown.js';

export type { QueueHealthCheckResult } from './intent/queues.js';

// Enforce module - explicit exports to avoid conflicts with basis and common/types
// Excluded types that conflict with other modules:
// - EscalationConfig (conflicts with basis/types.js)
// - RuleCondition (conflicts with basis/types.js)
// - Constraint (conflicts with common/types.js)
// - ConstraintEvaluationResult (conflicts with common/types.js)
export {
  // From policy-engine.ts
  PolicyEngine,
  createPolicyEngine,
  createEnforcementPolicy,
  type PolicyVersion,
  type ConstraintTemplate,
  type TemplateParameter,
  type EnforcementPolicy,
  type PolicyRule,
  type PolicyConditions,
  type TimeCondition,
  type PolicyEvaluationResult,
  type RuleEvaluationResult,
  type PolicyEvaluationContext,
  type PolicyEngineOptions,
  // From constraint-evaluator.ts
  ConstraintEvaluator,
  InMemoryStateProvider,
  createConstraintEvaluator,
  createRateLimitConstraint,
  createTimeWindowConstraint,
  createResourceCapConstraint,
  createDependencyConstraint,
  createCompositeConstraint,
  type ConstraintType,
  type BaseConstraint,
  type RateLimitConstraint,
  type TimeWindowConstraint,
  type ResourceCapConstraint,
  type DependencyConstraint,
  type CustomConstraint,
  type CompositeLogic,
  type CompositeConstraint,
  type ConstraintEvaluationContext,
  type StateProvider,
  type ConstraintEvaluatorOptions,
  // From escalation-rules.ts
  DEFAULT_RISK_THRESHOLDS,
  EscalationRuleEngine,
  LoggingNotificationHandler,
  createEscalationRuleEngine,
  createEscalationRule,
  createEscalationTarget,
  type RiskThresholds,
  type RiskLevel,
  type ResourceSensitivity as EnforceResourceSensitivity,
  type EscalationTarget,
  type NotificationChannel,
  type AvailabilitySchedule,
  type EscalationRule,
  type EscalationConditions,
  type EscalationMatchResult,
  type EscalationRequestFull,
  type EscalationApproval,
  type EscalationRejection,
  type EscalationContext,
  type EscalationEngineOptions,
  type NotificationHandler,
  // From decision-aggregator.ts
  DecisionAggregator,
  createDecisionAggregator,
  createSourceDecision,
  type DecisionSourceType,
  type SourceDecision,
  type ConflictStrategy,
  type AggregatedDecision,
  type ConflictResolutionDetails,
  type AuditEntry,
  type AuditQueryOptions,
  type DecisionAggregatorOptions,
  type AggregationContext,
  // From runtime-config.ts
  RuntimeConfig,
  InMemoryConfigSource,
  createRuntimeConfig,
  createFeatureFlag,
  createABTest,
  createABTestVariant,
  type FeatureFlag,
  type EnforcementMode,
  type ABTestVariant,
  type ABTest,
  type ABTestAssignment,
  type ReloadEvent,
  type ConfigValue,
  type RuntimeConfigOptions,
  type ConfigSource,
  // From enforce/index.ts main
  EnforcementService,
  createEnforcementService,
  type EnforcementContext,
  type LegacyEnforcementPolicy,
  type LegacyEscalationRule,
  type EnforcementServiceOptions,
  type EnforcementPolicy_Legacy,
  type EscalationRule_Legacy,
} from './enforce/index.js';
export * from './cognigate/index.js';
export * from './proof/index.js';
export * from './trust-engine/index.js';

// Version
export const VERSION = '0.1.0';

// Main entry point for server
export { createServer } from './api/server.js';
