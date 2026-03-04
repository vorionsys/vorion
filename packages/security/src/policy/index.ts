/**
 * Policy Engine
 *
 * Provides policy-based access control for intent governance.
 *
 * @packageDocumentation
 */

// Types
export type {
  PolicyStatus,
  ConditionOperator,
  LogicalOperator,
  FieldCondition,
  CompoundCondition,
  TrustCondition,
  TimeCondition,
  PolicyCondition,
  PolicyAction,
  PolicyRule,
  PolicyTarget,
  PolicyDefinition,
  Policy,
  PolicyVersion,
  PolicyEvaluationContext,
  RuleEvaluationResult,
  PolicyEvaluationResult,
  MultiPolicyEvaluationResult,
  CreatePolicyInput,
  UpdatePolicyInput,
  PolicyListFilters,
  PolicyValidationError,
  PolicyValidationResult,
} from './types.js';

export {
  POLICY_STATUSES,
  CONDITION_OPERATORS,
  LOGICAL_OPERATORS,
} from './types.js';

// Service
export {
  PolicyService,
  PolicyValidationException,
  createPolicyService,
  validatePolicyDefinition,
} from './service.js';

export type {
  UpdateWithVersioningInput,
  PolicyVersionWithMeta,
  PolicyVersionCompareResult,
} from './service.js';

// Diff utility
export {
  diffPolicyDefinitions,
  formatChange,
  formatDiff,
  getChangeSummary,
  arePoliciesEquivalent,
  getRuleChanges,
} from './diff.js';

export type {
  ChangeType,
  DiffChange,
  PolicyDiffResult,
} from './diff.js';

// Evaluator
export {
  PolicyEvaluator,
  createPolicyEvaluator,
  // Cache management exports
  invalidatePolicyCache,
  getPolicyCacheMetrics,
  clearPolicyCache,
  stopPolicyCache,
  type PolicyCacheMetrics,
} from './evaluator.js';

// Loader
export {
  PolicyLoader,
  getPolicyLoader,
  createPolicyLoader,
  resetPolicyLoader,
} from './loader.js';
