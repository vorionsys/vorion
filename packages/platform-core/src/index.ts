/**
 * @vorionsys/platform-core
 *
 * Core business logic for the Vorion AI Governance Platform.
 *
 * This package contains the implementation of:
 * - Trust Engine - Trust scoring and calculation
 * - Enforce - Policy enforcement decisions
 * - Proof - Evidence chain and audit logging
 * - Governance - Governance rules and workflows
 * - BASIS - Rule engine implementation
 * - Intent - Intent parsing and classification
 * - Cognigate - Constrained execution gateway
 * - Security - Authentication and authorization
 * - Common - Shared utilities
 * - API - API server implementation
 * - A2A - Agent-to-Agent Protocol
 * - Agent Registry - Agent Anchor core
 * - Observability - Metrics, logging, tracing
 * - Persistence - Repository pattern
 * - Versioning - SemVer, deprecation
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

// Enforce - namespaced to avoid Decision conflict with common/types
export * as enforce from './enforce/index.js';
export { EnforcementService, createEnforcementService } from './enforce/index.js';
export * from './cognigate/index.js';
export * from './proof/index.js';
export * from './trust-engine/index.js';
// Governance namespaced to avoid conflicts with basis exports (EvaluationContext, EvaluationResult, Rule, RuleEvaluator)
export * as governance from './governance/index.js';
export * as security from './security/index.js';

// A2A Protocol - namespaced to avoid conflicts (ChainStats conflict with proof)
export * as a2a from './a2a/index.js';
export { registerA2ARoutes } from './a2a/index.js';

// Agent Registry (Agent Anchor core) - namespaced to avoid conflicts (Attestation conflict with trust-engine)
export * as agentRegistry from './agent-registry/index.js';
export { registerAgentRegistryRoutes } from './agent-registry/index.js';

// Observability (metrics, logging, tracing, health, alerts)
export * as observability from './observability/index.js';
export { initObservability, registerHealthRoutes } from './observability/index.js';

// Persistence (repository pattern, audit chain)
export * as persistence from './persistence/index.js';

// Versioning (semver, deprecation, compatibility)
export {
  PLATFORM_VERSION,
  API_VERSION,
  SUPPORTED_API_VERSIONS,
  MIN_SDK_VERSION,
  MAX_SDK_VERSION,
  A2A_PROTOCOL_VERSION,
  SUPPORTED_A2A_VERSIONS,
  SCHEMA_VERSION,
  ADL_VERSION,
  isSDKVersionCompatible,
  isA2AVersionSupported,
  getVersionInfo,
  // SemVer utilities
  type Version,
  type VersionRange,
  SEMVER_REGEX,
  parseVersion,
  tryParseVersion,
  isValidVersion,
  formatVersion,
  compareVersions,
  eq,
  gt,
  lt,
  gte,
  lte,
  satisfies,
  isCompatible,
  isApproximatelyEqual,
  increment,
  maxVersion,
  minVersion,
  sortVersions,
  // Deprecation
  type Deprecation,
  type DeprecationRegistry,
  createDeprecationRegistry,
  getDeprecationRegistry,
  deprecated,
  VORION_DEPRECATIONS,
  initDeprecations,
  checkApiCompatibility,
} from './versioning/index.js';

// Version alias for backwards compatibility
export { PLATFORM_VERSION as VERSION } from './versioning/index.js';

// Friction Feedback System (Epic 3: FR119-122)
export * as friction from './friction/index.js';
export { registerFrictionRoutes } from './friction/routes.js';
export {
  FrictionFeedbackService,
  createFrictionFeedbackService,
  DenialReasonCategory,
  DenialSeverity,
  NextStepAction,
  REVIEWER_DECISION_OPTIONS,
} from './friction/index.js';
export type {
  DenialExplanation,
  NextStep,
  DecisionOption,
  FrictionFeedback,
  AgentUnderstandingSignal,
  FrictionContext,
} from './friction/index.js';

// Main entry point for server
export { createServer } from './api/server.js';
