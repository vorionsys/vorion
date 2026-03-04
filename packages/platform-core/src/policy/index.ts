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

// Evaluator
export {
  PolicyEvaluator,
  createPolicyEvaluator,
} from './evaluator.js';

// Loader
export {
  PolicyLoader,
  getPolicyLoader,
  createPolicyLoader,
  resetPolicyLoader,
} from './loader.js';

// Visual Policy Builder (Epic 4: FR144-150)
export {
  VisualPolicyBuilder,
  createVisualPolicyBuilder,
  FieldDataType,
  FIELD_REGISTRY,
  OPERATOR_REGISTRY,
} from './visual-builder/index.js';

export type {
  FieldDefinition,
  OperatorDefinition,
  VisualConditionBlock,
  VisualActionBlock,
  VisualRuleBlock,
  VisualPolicyBlock,
  BuilderValidationError,
  BuilderValidationResult,
} from './visual-builder/index.js';

// Policy Simulator
export {
  PolicySimulator,
  createPolicySimulator,
} from './visual-builder/simulator.js';

export type {
  HistoricalIntent,
  IntentSimulationResult,
  ActionImpact,
  EntityImpact,
  SimulationReport,
  SimulationOptions,
  ImpactAnalysis,
} from './visual-builder/simulator.js';

// Policy Templates
export {
  PolicyTemplateService,
  createPolicyTemplateService,
  TemplateCategory,
  POLICY_TEMPLATES,
} from './visual-builder/templates.js';

export type {
  PolicyTemplate,
  TemplateVariable,
} from './visual-builder/templates.js';

// Policy Inheritance
export {
  PolicyInheritanceService,
  createPolicyInheritanceService,
} from './visual-builder/inheritance.js';

export type {
  PolicyInheritance,
  PolicyHierarchyNode,
  MergedPolicy,
  PolicyConflict,
  InheritanceValidationResult,
} from './visual-builder/inheritance.js';

// Policy Propagation
export {
  PolicyPropagationService,
  createPolicyPropagationService,
} from './visual-builder/propagation.js';

export type {
  PolicyUpdateEvent,
  PolicyAcknowledgment,
  PropagationStatus,
  PropagationOptions,
  AgentConnection,
} from './visual-builder/propagation.js';

// Visual Builder Routes
export { registerVisualPolicyBuilderRoutes } from './visual-builder/routes.js';
