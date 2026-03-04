/**
 * Visual Policy Builder
 *
 * Provides a visual, no-code interface for building governance policies.
 * Implements FR144-150 for Epic 4.
 *
 * Features:
 * - Field registry with dropdown options
 * - Visual block to DSL conversion
 * - Real-time validation
 * - Policy templates
 * - Policy inheritance
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../../common/logger.js';
import { Counter, Histogram } from 'prom-client';
import { intentRegistry } from '../../intent/metrics.js';
import type { ID, ControlAction, TrustLevel } from '../../common/types.js';
import type {
  PolicyDefinition,
  PolicyRule,
  PolicyCondition,
  FieldCondition,
  CompoundCondition,
  TrustCondition,
  TimeCondition,
  PolicyAction,
  PolicyTarget,
  ConditionOperator,
  LogicalOperator,
} from '../types.js';

const logger = createLogger({ component: 'visual-policy-builder' });

// =============================================================================
// Metrics
// =============================================================================

const policiesBuilt = new Counter({
  name: 'vorion_visual_policies_built_total',
  help: 'Total policies built using visual builder',
  registers: [intentRegistry],
});

const policyBuildDuration = new Histogram({
  name: 'vorion_policy_build_duration_seconds',
  help: 'Time to build a policy from visual blocks',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [intentRegistry],
});

// =============================================================================
// Field Registry Types
// =============================================================================

/**
 * Field data types for validation and UI rendering
 */
export const FieldDataType = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  ARRAY: 'array',
  DATE: 'date',
  ENUM: 'enum',
  TRUST_LEVEL: 'trust_level',
} as const;

export type FieldDataType = (typeof FieldDataType)[keyof typeof FieldDataType];

/**
 * Field definition for the registry
 */
export interface FieldDefinition {
  /** Field path (e.g., "intent.action", "entity.trustScore") */
  path: string;
  /** Display label */
  label: string;
  /** Field description */
  description: string;
  /** Data type */
  dataType: FieldDataType;
  /** Category for grouping in UI */
  category: 'intent' | 'entity' | 'trust' | 'time' | 'custom';
  /** Available operators for this field type */
  operators: ConditionOperator[];
  /** Enum values if dataType is 'enum' */
  enumValues?: { value: string; label: string }[];
  /** Example values for the UI */
  examples?: string[];
  /** Is this field required for evaluation? */
  required?: boolean;
}

/**
 * Operator definition with metadata
 */
export interface OperatorDefinition {
  value: ConditionOperator;
  label: string;
  description: string;
  /** Number of operands (1 for unary like 'exists', 2 for binary like 'equals') */
  arity: 1 | 2;
  /** Compatible data types */
  compatibleTypes: FieldDataType[];
}

// =============================================================================
// Field Registry
// =============================================================================

/**
 * Registry of all available fields for policy conditions
 */
export const FIELD_REGISTRY: FieldDefinition[] = [
  // Intent fields
  {
    path: 'intent.action',
    label: 'Action',
    description: 'The action being requested',
    dataType: FieldDataType.STRING,
    category: 'intent',
    operators: ['equals', 'not_equals', 'in', 'not_in', 'contains', 'starts_with', 'matches'],
    examples: ['read', 'write', 'delete', 'execute', 'transfer'],
  },
  {
    path: 'intent.resource',
    label: 'Resource',
    description: 'The target resource of the action',
    dataType: FieldDataType.STRING,
    category: 'intent',
    operators: ['equals', 'not_equals', 'in', 'not_in', 'contains', 'starts_with', 'matches'],
    examples: ['database', 'file', 'api', 'user_data'],
  },
  {
    path: 'intent.category',
    label: 'Category',
    description: 'The category of the intent',
    dataType: FieldDataType.ENUM,
    category: 'intent',
    operators: ['equals', 'not_equals', 'in', 'not_in'],
    enumValues: [
      { value: 'data_access', label: 'Data Access' },
      { value: 'data_modification', label: 'Data Modification' },
      { value: 'financial', label: 'Financial' },
      { value: 'administrative', label: 'Administrative' },
      { value: 'communication', label: 'Communication' },
      { value: 'security', label: 'Security' },
    ],
  },
  {
    path: 'intent.risk_score',
    label: 'Risk Score',
    description: 'Calculated risk score for the intent (0-100)',
    dataType: FieldDataType.NUMBER,
    category: 'intent',
    operators: ['equals', 'greater_than', 'less_than', 'greater_than_or_equal', 'less_than_or_equal'],
    examples: ['25', '50', '75'],
  },
  {
    path: 'intent.parameters.amount',
    label: 'Amount',
    description: 'Monetary or quantity amount in the request',
    dataType: FieldDataType.NUMBER,
    category: 'intent',
    operators: ['equals', 'greater_than', 'less_than', 'greater_than_or_equal', 'less_than_or_equal'],
    examples: ['100', '1000', '10000'],
  },

  // Entity fields
  {
    path: 'entity.type',
    label: 'Entity Type',
    description: 'Type of the requesting entity',
    dataType: FieldDataType.ENUM,
    category: 'entity',
    operators: ['equals', 'not_equals', 'in', 'not_in'],
    enumValues: [
      { value: 'agent', label: 'AI Agent' },
      { value: 'user', label: 'Human User' },
      { value: 'service', label: 'Service Account' },
      { value: 'system', label: 'System Process' },
    ],
  },
  {
    path: 'entity.id',
    label: 'Entity ID',
    description: 'Unique identifier of the entity',
    dataType: FieldDataType.STRING,
    category: 'entity',
    operators: ['equals', 'not_equals', 'in', 'not_in'],
  },
  {
    path: 'entity.namespace',
    label: 'Namespace',
    description: 'Entity namespace or group',
    dataType: FieldDataType.STRING,
    category: 'entity',
    operators: ['equals', 'not_equals', 'in', 'not_in', 'starts_with'],
    examples: ['production', 'staging', 'development'],
  },

  // Trust fields
  {
    path: 'trust.score',
    label: 'Trust Score',
    description: 'Current trust score (0-1000)',
    dataType: FieldDataType.NUMBER,
    category: 'trust',
    operators: ['equals', 'greater_than', 'less_than', 'greater_than_or_equal', 'less_than_or_equal'],
    examples: ['200', '500', '800'],
  },
  {
    path: 'trust.level',
    label: 'Trust Level',
    description: 'Trust band level (0-7)',
    dataType: FieldDataType.TRUST_LEVEL,
    category: 'trust',
    operators: ['equals', 'greater_than', 'less_than', 'greater_than_or_equal', 'less_than_or_equal'],
    enumValues: [
      { value: '0', label: 'T0 - Sandbox' },
      { value: '1', label: 'T1 - Observed' },
      { value: '2', label: 'T2 - Provisional' },
      { value: '3', label: 'T3 - Monitored' },
      { value: '4', label: 'T4 - Standard' },
      { value: '5', label: 'T5 - Trusted' },
      { value: '6', label: 'T6 - Certified' },
      { value: '7', label: 'T7 - Autonomous' },
    ],
  },
  {
    path: 'trust.observation_tier',
    label: 'Observation Tier',
    description: 'Observation transparency tier',
    dataType: FieldDataType.ENUM,
    category: 'trust',
    operators: ['equals', 'not_equals', 'in'],
    enumValues: [
      { value: 'BLACK_BOX', label: 'Black Box' },
      { value: 'GRAY_BOX', label: 'Gray Box' },
      { value: 'WHITE_BOX', label: 'White Box' },
      { value: 'ATTESTED_BOX', label: 'Attested Box' },
      { value: 'VERIFIED_BOX', label: 'Verified Box' },
    ],
  },

  // Time fields
  {
    path: 'time.hour',
    label: 'Hour of Day',
    description: 'Current hour (0-23)',
    dataType: FieldDataType.NUMBER,
    category: 'time',
    operators: ['equals', 'greater_than', 'less_than', 'greater_than_or_equal', 'less_than_or_equal', 'in'],
    examples: ['9', '17', '0'],
  },
  {
    path: 'time.dayOfWeek',
    label: 'Day of Week',
    description: 'Current day (0=Sunday, 6=Saturday)',
    dataType: FieldDataType.NUMBER,
    category: 'time',
    operators: ['equals', 'in', 'not_in'],
    enumValues: [
      { value: '0', label: 'Sunday' },
      { value: '1', label: 'Monday' },
      { value: '2', label: 'Tuesday' },
      { value: '3', label: 'Wednesday' },
      { value: '4', label: 'Thursday' },
      { value: '5', label: 'Friday' },
      { value: '6', label: 'Saturday' },
    ],
  },
  {
    path: 'time.isBusinessHours',
    label: 'Business Hours',
    description: 'Whether current time is within business hours',
    dataType: FieldDataType.BOOLEAN,
    category: 'time',
    operators: ['equals'],
  },
];

/**
 * Registry of all available operators
 */
export const OPERATOR_REGISTRY: OperatorDefinition[] = [
  {
    value: 'equals',
    label: 'equals',
    description: 'Value is exactly equal',
    arity: 2,
    compatibleTypes: [FieldDataType.STRING, FieldDataType.NUMBER, FieldDataType.BOOLEAN, FieldDataType.ENUM, FieldDataType.TRUST_LEVEL],
  },
  {
    value: 'not_equals',
    label: 'does not equal',
    description: 'Value is not equal',
    arity: 2,
    compatibleTypes: [FieldDataType.STRING, FieldDataType.NUMBER, FieldDataType.BOOLEAN, FieldDataType.ENUM, FieldDataType.TRUST_LEVEL],
  },
  {
    value: 'greater_than',
    label: 'is greater than',
    description: 'Value is greater than',
    arity: 2,
    compatibleTypes: [FieldDataType.NUMBER, FieldDataType.TRUST_LEVEL],
  },
  {
    value: 'less_than',
    label: 'is less than',
    description: 'Value is less than',
    arity: 2,
    compatibleTypes: [FieldDataType.NUMBER, FieldDataType.TRUST_LEVEL],
  },
  {
    value: 'greater_than_or_equal',
    label: 'is at least',
    description: 'Value is greater than or equal to',
    arity: 2,
    compatibleTypes: [FieldDataType.NUMBER, FieldDataType.TRUST_LEVEL],
  },
  {
    value: 'less_than_or_equal',
    label: 'is at most',
    description: 'Value is less than or equal to',
    arity: 2,
    compatibleTypes: [FieldDataType.NUMBER, FieldDataType.TRUST_LEVEL],
  },
  {
    value: 'in',
    label: 'is one of',
    description: 'Value is in the list',
    arity: 2,
    compatibleTypes: [FieldDataType.STRING, FieldDataType.NUMBER, FieldDataType.ENUM],
  },
  {
    value: 'not_in',
    label: 'is not one of',
    description: 'Value is not in the list',
    arity: 2,
    compatibleTypes: [FieldDataType.STRING, FieldDataType.NUMBER, FieldDataType.ENUM],
  },
  {
    value: 'contains',
    label: 'contains',
    description: 'String contains substring',
    arity: 2,
    compatibleTypes: [FieldDataType.STRING, FieldDataType.ARRAY],
  },
  {
    value: 'not_contains',
    label: 'does not contain',
    description: 'String does not contain substring',
    arity: 2,
    compatibleTypes: [FieldDataType.STRING, FieldDataType.ARRAY],
  },
  {
    value: 'starts_with',
    label: 'starts with',
    description: 'String starts with prefix',
    arity: 2,
    compatibleTypes: [FieldDataType.STRING],
  },
  {
    value: 'ends_with',
    label: 'ends with',
    description: 'String ends with suffix',
    arity: 2,
    compatibleTypes: [FieldDataType.STRING],
  },
  {
    value: 'matches',
    label: 'matches pattern',
    description: 'String matches regex pattern',
    arity: 2,
    compatibleTypes: [FieldDataType.STRING],
  },
  {
    value: 'exists',
    label: 'exists',
    description: 'Field has a value',
    arity: 1,
    compatibleTypes: [FieldDataType.STRING, FieldDataType.NUMBER, FieldDataType.BOOLEAN, FieldDataType.ARRAY],
  },
  {
    value: 'not_exists',
    label: 'does not exist',
    description: 'Field has no value',
    arity: 1,
    compatibleTypes: [FieldDataType.STRING, FieldDataType.NUMBER, FieldDataType.BOOLEAN, FieldDataType.ARRAY],
  },
];

// =============================================================================
// Visual Block Types (for UI)
// =============================================================================

/**
 * Visual condition block for the UI
 */
export interface VisualConditionBlock {
  id: string;
  type: 'field' | 'trust' | 'time' | 'group';
  field?: string;
  operator?: ConditionOperator | LogicalOperator;
  value?: unknown;
  children?: VisualConditionBlock[];
}

/**
 * Visual action block for the UI
 */
export interface VisualActionBlock {
  action: ControlAction;
  reason?: string;
  escalateTo?: string;
  escalationTimeout?: string;
  requireJustification?: boolean;
  constraints?: Record<string, unknown>;
}

/**
 * Visual rule block for the UI
 */
export interface VisualRuleBlock {
  id: string;
  name: string;
  description?: string;
  priority: number;
  enabled: boolean;
  condition: VisualConditionBlock;
  action: VisualActionBlock;
}

/**
 * Visual policy block for the UI
 */
export interface VisualPolicyBlock {
  name: string;
  description?: string;
  target?: {
    intentTypes?: string[];
    entityTypes?: string[];
    trustLevels?: number[];
    namespaces?: string[];
  };
  rules: VisualRuleBlock[];
  defaultAction: ControlAction;
  defaultReason?: string;
  parentPolicyId?: string;
  templateId?: string;
}

// =============================================================================
// Validation Types
// =============================================================================

export interface BuilderValidationError {
  blockId: string;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface BuilderValidationResult {
  valid: boolean;
  errors: BuilderValidationError[];
  warnings: BuilderValidationError[];
}

// =============================================================================
// Policy Builder Service
// =============================================================================

/**
 * Visual Policy Builder Service
 *
 * Converts visual blocks to PolicyDefinition and vice versa.
 * Provides field registry and validation.
 */
export class VisualPolicyBuilder {
  /**
   * Get all available fields for dropdowns
   */
  getFields(): FieldDefinition[] {
    return FIELD_REGISTRY;
  }

  /**
   * Get fields by category
   */
  getFieldsByCategory(category: FieldDefinition['category']): FieldDefinition[] {
    return FIELD_REGISTRY.filter(f => f.category === category);
  }

  /**
   * Get operators for a specific field
   */
  getOperatorsForField(fieldPath: string): OperatorDefinition[] {
    const field = FIELD_REGISTRY.find(f => f.path === fieldPath);
    if (!field) return [];

    return OPERATOR_REGISTRY.filter(op =>
      field.operators.includes(op.value) &&
      op.compatibleTypes.includes(field.dataType)
    );
  }

  /**
   * Get all operators
   */
  getAllOperators(): OperatorDefinition[] {
    return OPERATOR_REGISTRY;
  }

  /**
   * Build PolicyDefinition from visual blocks
   */
  buildPolicy(visual: VisualPolicyBlock): { policy: PolicyDefinition; validation: BuilderValidationResult } {
    const startTime = Date.now();

    // Validate first
    const validation = this.validateVisualPolicy(visual);

    // Build even if there are warnings (but not errors)
    const rules: PolicyRule[] = visual.rules.map(rule => this.convertRule(rule));

    const target: PolicyTarget | undefined = visual.target ? {
      intentTypes: visual.target.intentTypes,
      entityTypes: visual.target.entityTypes,
      trustLevels: visual.target.trustLevels as TrustLevel[] | undefined,
      namespaces: visual.target.namespaces,
    } : undefined;

    const policy: PolicyDefinition = {
      version: '1.0',
      target,
      rules,
      defaultAction: visual.defaultAction,
      defaultReason: visual.defaultReason,
      metadata: {
        builtWith: 'visual-builder',
        templateId: visual.templateId,
        parentPolicyId: visual.parentPolicyId,
      },
    };

    const durationMs = Date.now() - startTime;
    policyBuildDuration.observe(durationMs / 1000);

    if (validation.valid) {
      policiesBuilt.inc();
    }

    logger.debug({ rulesCount: rules.length, durationMs, valid: validation.valid }, 'Policy built from visual blocks');

    return { policy, validation };
  }

  /**
   * Convert PolicyDefinition to visual blocks
   */
  toVisualBlocks(policy: PolicyDefinition, name: string, description?: string): VisualPolicyBlock {
    const rules: VisualRuleBlock[] = policy.rules.map(rule => ({
      id: rule.id,
      name: rule.name,
      description: rule.description,
      priority: rule.priority,
      enabled: rule.enabled,
      condition: this.conditionToVisual(rule.when),
      action: {
        action: rule.then.action,
        reason: rule.then.reason,
        escalateTo: rule.then.escalation?.to,
        escalationTimeout: rule.then.escalation?.timeout,
        requireJustification: rule.then.escalation?.requireJustification,
        constraints: rule.then.constraints,
      },
    }));

    return {
      name,
      description,
      target: policy.target ? {
        intentTypes: policy.target.intentTypes,
        entityTypes: policy.target.entityTypes,
        trustLevels: policy.target.trustLevels,
        namespaces: policy.target.namespaces,
      } : undefined,
      rules,
      defaultAction: policy.defaultAction,
      defaultReason: policy.defaultReason,
      parentPolicyId: policy.metadata?.parentPolicyId as string | undefined,
      templateId: policy.metadata?.templateId as string | undefined,
    };
  }

  /**
   * Validate a visual policy
   */
  validateVisualPolicy(visual: VisualPolicyBlock): BuilderValidationResult {
    const errors: BuilderValidationError[] = [];
    const warnings: BuilderValidationError[] = [];

    // Validate name
    if (!visual.name || visual.name.trim().length === 0) {
      errors.push({
        blockId: 'policy',
        field: 'name',
        message: 'Policy name is required',
        severity: 'error',
      });
    }

    // Validate at least one rule
    if (visual.rules.length === 0) {
      warnings.push({
        blockId: 'policy',
        field: 'rules',
        message: 'Policy has no rules - only default action will apply',
        severity: 'warning',
      });
    }

    // Validate each rule
    for (const rule of visual.rules) {
      this.validateRule(rule, errors, warnings);
    }

    // Check for duplicate priorities
    const priorities = visual.rules.map(r => r.priority);
    const duplicates = priorities.filter((p, i) => priorities.indexOf(p) !== i);
    if (duplicates.length > 0) {
      warnings.push({
        blockId: 'policy',
        field: 'rules',
        message: `Duplicate rule priorities found: ${[...new Set(duplicates)].join(', ')}`,
        severity: 'warning',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Create an empty visual rule block
   */
  createEmptyRule(): VisualRuleBlock {
    return {
      id: randomUUID(),
      name: 'New Rule',
      priority: 100,
      enabled: true,
      condition: {
        id: randomUUID(),
        type: 'field',
      },
      action: {
        action: 'deny',
      },
    };
  }

  /**
   * Create a condition group (AND/OR)
   */
  createConditionGroup(operator: 'and' | 'or'): VisualConditionBlock {
    return {
      id: randomUUID(),
      type: 'group',
      operator,
      children: [],
    };
  }

  /**
   * Create a field condition
   */
  createFieldCondition(fieldPath: string): VisualConditionBlock {
    const field = FIELD_REGISTRY.find(f => f.path === fieldPath);
    const defaultOperator = field?.operators[0] ?? 'equals';

    return {
      id: randomUUID(),
      type: 'field',
      field: fieldPath,
      operator: defaultOperator,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private convertRule(visual: VisualRuleBlock): PolicyRule {
    const action: PolicyAction = {
      action: visual.action.action,
      reason: visual.action.reason,
    };

    if (visual.action.escalateTo) {
      action.escalation = {
        to: visual.action.escalateTo,
        timeout: visual.action.escalationTimeout ?? 'PT1H',
        requireJustification: visual.action.requireJustification,
      };
    }

    if (visual.action.constraints) {
      action.constraints = visual.action.constraints;
    }

    return {
      id: visual.id,
      name: visual.name,
      description: visual.description,
      priority: visual.priority,
      enabled: visual.enabled,
      when: this.convertCondition(visual.condition),
      then: action,
    };
  }

  private convertCondition(visual: VisualConditionBlock): PolicyCondition {
    if (visual.type === 'group') {
      return {
        type: 'compound',
        operator: visual.operator as LogicalOperator,
        conditions: (visual.children ?? []).map(c => this.convertCondition(c)),
      } as CompoundCondition;
    }

    if (visual.type === 'trust') {
      return {
        type: 'trust',
        level: visual.value as TrustLevel,
        operator: visual.operator as TrustCondition['operator'],
      } as TrustCondition;
    }

    if (visual.type === 'time') {
      return {
        type: 'time',
        field: this.extractTimeField(visual.field ?? ''),
        operator: visual.operator as ConditionOperator,
        value: visual.value as number | number[] | string,
      } as TimeCondition;
    }

    // Default to field condition
    return {
      type: 'field',
      field: visual.field ?? '',
      operator: visual.operator as ConditionOperator ?? 'equals',
      value: visual.value,
    } as FieldCondition;
  }

  private conditionToVisual(condition: PolicyCondition): VisualConditionBlock {
    if (condition.type === 'compound') {
      return {
        id: randomUUID(),
        type: 'group',
        operator: condition.operator,
        children: condition.conditions.map(c => this.conditionToVisual(c)),
      };
    }

    if (condition.type === 'trust') {
      return {
        id: randomUUID(),
        type: 'trust',
        field: 'trust.level',
        operator: condition.operator,
        value: condition.level,
      };
    }

    if (condition.type === 'time') {
      return {
        id: randomUUID(),
        type: 'time',
        field: `time.${condition.field}`,
        operator: condition.operator,
        value: condition.value,
      };
    }

    // Field condition
    return {
      id: randomUUID(),
      type: 'field',
      field: condition.field,
      operator: condition.operator,
      value: condition.value,
    };
  }

  private extractTimeField(fieldPath: string): 'hour' | 'dayOfWeek' | 'date' {
    if (fieldPath.includes('hour')) return 'hour';
    if (fieldPath.includes('day')) return 'dayOfWeek';
    return 'date';
  }

  private validateRule(
    rule: VisualRuleBlock,
    errors: BuilderValidationError[],
    warnings: BuilderValidationError[]
  ): void {
    // Validate name
    if (!rule.name || rule.name.trim().length === 0) {
      errors.push({
        blockId: rule.id,
        field: 'name',
        message: 'Rule name is required',
        severity: 'error',
      });
    }

    // Validate priority
    if (rule.priority < 0 || rule.priority > 10000) {
      errors.push({
        blockId: rule.id,
        field: 'priority',
        message: 'Priority must be between 0 and 10000',
        severity: 'error',
      });
    }

    // Validate condition
    this.validateCondition(rule.condition, rule.id, errors, warnings);

    // Validate action
    if (rule.action.action === 'escalate' && !rule.action.escalateTo) {
      errors.push({
        blockId: rule.id,
        field: 'action.escalateTo',
        message: 'Escalation target is required when action is "escalate"',
        severity: 'error',
      });
    }
  }

  private validateCondition(
    condition: VisualConditionBlock,
    ruleId: string,
    errors: BuilderValidationError[],
    warnings: BuilderValidationError[]
  ): void {
    if (condition.type === 'group') {
      if (!condition.children || condition.children.length === 0) {
        warnings.push({
          blockId: condition.id,
          field: 'children',
          message: 'Condition group is empty',
          severity: 'warning',
        });
      } else {
        for (const child of condition.children) {
          this.validateCondition(child, ruleId, errors, warnings);
        }
      }
      return;
    }

    // Validate field condition
    if (!condition.field) {
      errors.push({
        blockId: condition.id,
        field: 'field',
        message: 'Condition field is required',
        severity: 'error',
      });
    }

    if (!condition.operator) {
      errors.push({
        blockId: condition.id,
        field: 'operator',
        message: 'Condition operator is required',
        severity: 'error',
      });
    }

    // Check if value is required (for non-unary operators)
    const operator = OPERATOR_REGISTRY.find(op => op.value === condition.operator);
    if (operator && operator.arity === 2 && condition.value === undefined) {
      errors.push({
        blockId: condition.id,
        field: 'value',
        message: 'Condition value is required',
        severity: 'error',
      });
    }

    // Validate field exists in registry
    if (condition.field) {
      const fieldDef = FIELD_REGISTRY.find(f => f.path === condition.field);
      if (!fieldDef) {
        warnings.push({
          blockId: condition.id,
          field: 'field',
          message: `Unknown field: ${condition.field}. It may still work if it exists at runtime.`,
          severity: 'warning',
        });
      }
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a visual policy builder instance
 */
export function createVisualPolicyBuilder(): VisualPolicyBuilder {
  return new VisualPolicyBuilder();
}
