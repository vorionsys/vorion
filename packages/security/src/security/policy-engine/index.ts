/**
 * Security Policy Engine
 *
 * A flexible security policy engine for dynamic security rules.
 * Provides policy evaluation, management, and enforcement capabilities.
 *
 * Features:
 * - Dynamic policy conditions (user, request, time, risk, resource)
 * - Flexible rules (MFA, approval, block, rate-limit, encryption, audit)
 * - Configurable actions (allow, deny, challenge, notify, escalate, quarantine)
 * - JSON-based Policy DSL
 * - Fastify middleware integration
 * - Management API for CRUD operations
 * - Policy versioning and rollback
 * - Dry-run/simulation mode
 * - Break-glass override support
 *
 * @example
 * ```typescript
 * import {
 *   createSecurityPolicyEngine,
 *   enforcePolicies,
 *   builtInPolicies,
 * } from './security/policy-engine';
 *
 * // Create engine
 * const engine = createSecurityPolicyEngine({
 *   enableTracing: true,
 *   defaultDecision: 'allow',
 * });
 *
 * // Add built-in policies
 * for (const policy of builtInPolicies) {
 *   engine.addPolicy(policy);
 * }
 *
 * // Use with Fastify
 * const { middleware } = enforcePolicies({ engine });
 * fastify.addHook('preHandler', middleware);
 *
 * // Or use the plugin
 * import { policyEnginePluginFp } from './security/policy-engine';
 * fastify.register(policyEnginePluginFp, {
 *   engine,
 *   enableManagementApi: true,
 * });
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// TYPES
// =============================================================================

// Re-export everything from types
export {
  // Condition operator/type enums
  ConditionOperator,
  LogicalOperator,
  ConditionType,
  PolicyRuleType,
  PolicyActionType,
  DecisionOutcome,

  // Schemas
  securityPolicySchema,
  policyConditionSchema,
  policyRuleSchema,
  policyActionSchema,
  policyContextSchema,
} from './types.js';

// Type-only exports
export type {
  // Condition types
  PolicyCondition,
  UserAttributeCondition,
  RequestAttributeCondition,
  TimeBasedCondition,
  RiskBasedCondition,
  ResourceAttributeCondition,
  CompositeCondition,
  CustomCondition,

  // Rule types
  PolicyRule,
  MFARule,
  ApprovalRule,
  BlockAccessRule,
  RateLimitRule,
  EncryptionRule,
  AuditLogRule,
  StepUpAuthRule,
  DataMaskingRule,
  SessionTimeoutRule,
  GeoRestrictionRule,
  CustomRule,

  // Action types
  PolicyAction,
  AllowAction,
  DenyAction,
  ChallengeAction,
  NotifyAction,
  LogAction,
  EscalateAction,
  QuarantineAction,
  RedirectAction,
  ModifyAction,

  // Policy types
  SecurityPolicy,

  // Context types
  PolicyContext,
  PolicyContextUser,
  PolicyContextRequest,
  PolicyContextResource,
  PolicyContextRisk,
  PolicyContextEnvironment,

  // Decision types
  PolicyDecision,
  PolicyEvaluationResult,
  ConditionEvaluationResult,
  RuleEvaluationResult,

  // Version types
  PolicyVersionRecord,

  // Simulation types
  PolicySimulationRequest,
  PolicySimulationResult,

  // Validation types
  PolicyValidationResult,
  PolicyValidationError,
} from './types.js';

// =============================================================================
// ENGINE
// =============================================================================

export {
  SecurityPolicyEngine,
  createSecurityPolicyEngine,
  type SecurityPolicyEngineOptions,
  type PolicyUpdateListener,
  type BreakGlassValidator,
} from './engine.js';

// =============================================================================
// CONDITION EVALUATOR
// =============================================================================

export {
  ConditionEvaluator,
  createConditionEvaluator,
  type ConditionEvaluatorOptions,
  type CustomExpressionEvaluator,
} from './condition-evaluator.js';

// =============================================================================
// RULE EVALUATOR
// =============================================================================

export {
  RuleEvaluator,
  createRuleEvaluator,
  type RuleEvaluatorOptions,
  type RateLimiter,
  type GeoLocationProvider,
  type CustomRuleHandler,
} from './rule-evaluator.js';

// =============================================================================
// MIDDLEWARE
// =============================================================================

export {
  createPolicyMiddleware,
  enforcePolicies,
  policyEnginePluginFp,
  type PolicyMiddlewareOptions,
} from './middleware.js';

// =============================================================================
// BUILT-IN POLICIES
// =============================================================================

export {
  builtInPolicies,
  getBuiltInPoliciesByTag,
  getBuiltInPolicyIds,
  requireMfaForAdminPolicy,
  blockHighRiskIpsPolicy,
  requireApprovalForBulkExportPolicy,
  enhancedLoggingForSensitiveResourcesPolicy,
  rateLimitByRiskScorePolicy,
  mfaOutsideBusinessHoursPolicy,
  blockCriticalThreatsPolicy,
  geoRestrictSensitiveOperationsPolicy,
  sessionSecurityHighRiskUsersPolicy,
  dataMaskingForPiiPolicy,
} from './built-in-policies.js';

// =============================================================================
// ATSF ADAPTER
// =============================================================================

export {
  SecurityPolicyEngineAdapter,
  createSecurityPolicyEngineAdapter,
} from './atsf-adapter.js';
