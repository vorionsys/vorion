/**
 * Policy Engine
 *
 * Core engine for evaluating enforcement policies against intents.
 * Supports constraint templates, runtime policy updates, and versioning.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import { withSpan, type TraceSpan } from '../common/trace.js';
import type {
  Intent,
  ControlAction,
  ID,
  Timestamp,
  TrustLevel,
  TrustScore,
} from '../common/types.js';

const logger = createLogger({ component: 'policy-engine' });

// =============================================================================
// POLICY TYPES
// =============================================================================

/**
 * Policy version metadata
 */
export interface PolicyVersion {
  /** Version number */
  version: string;
  /** Who created this version */
  createdBy: string;
  /** When this version was created */
  createdAt: Timestamp;
  /** Change description */
  description?: string;
  /** Previous version ID (for rollback) */
  previousVersionId?: ID;
}

/**
 * Constraint template for reusable policy patterns
 */
export interface ConstraintTemplate {
  /** Unique template identifier */
  id: ID;
  /** Template name */
  name: string;
  /** Template description */
  description: string;
  /** Parameters that can be customized */
  parameters: TemplateParameter[];
  /** The constraint expression template */
  expression: string;
  /** Tags for categorization */
  tags: string[];
  /** Template version */
  version: string;
}

/**
 * Template parameter definition
 */
export interface TemplateParameter {
  /** Parameter name */
  name: string;
  /** Parameter type */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  /** Default value */
  defaultValue?: unknown;
  /** Whether parameter is required */
  required: boolean;
  /** Description */
  description?: string;
  /** Validation constraints */
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: unknown[];
  };
}

/**
 * Enforcement policy definition
 */
export interface EnforcementPolicy {
  /** Unique policy identifier */
  id: ID;
  /** Policy name */
  name: string;
  /** Policy description */
  description?: string;
  /** Policy rules */
  rules: PolicyRule[];
  /** Default action when no rules match */
  defaultAction: ControlAction;
  /** Policy priority (lower = higher priority) */
  priority: number;
  /** Whether policy is enabled */
  enabled: boolean;
  /** Policy conditions for applicability */
  conditions?: PolicyConditions;
  /** Version information */
  version: PolicyVersion;
  /** Metadata */
  metadata?: Record<string, unknown>;
  /** Creation timestamp */
  createdAt: Timestamp;
  /** Last update timestamp */
  updatedAt: Timestamp;
}

/**
 * Policy rule definition
 */
export interface PolicyRule {
  /** Rule identifier */
  id: ID;
  /** Rule name */
  name: string;
  /** Condition expression */
  condition: RuleCondition;
  /** Action when condition matches */
  action: ControlAction;
  /** Additional constraints to apply */
  constraints?: string[];
  /** Rule priority within policy */
  priority: number;
  /** Whether rule is enabled */
  enabled: boolean;
}

/**
 * Rule condition definition
 */
export interface RuleCondition {
  /** Condition type */
  type: 'expression' | 'template' | 'composite';
  /** Expression string (for expression type) */
  expression?: string;
  /** Template reference (for template type) */
  templateId?: ID;
  /** Template parameters */
  templateParams?: Record<string, unknown>;
  /** Sub-conditions (for composite type) */
  conditions?: RuleCondition[];
  /** Logic for combining sub-conditions */
  logic?: 'AND' | 'OR';
}

/**
 * Policy conditions for when policy applies
 */
export interface PolicyConditions {
  /** Required trust levels */
  trustLevels?: TrustLevel[];
  /** Action patterns to match */
  actionPatterns?: string[];
  /** Resource patterns to match */
  resourcePatterns?: string[];
  /** Intent type patterns */
  intentTypes?: string[];
  /** Entity types */
  entityTypes?: string[];
  /** Time-based conditions */
  timeConditions?: TimeCondition[];
}

/**
 * Time-based condition
 */
export interface TimeCondition {
  /** Start hour (0-23) */
  startHour?: number;
  /** End hour (0-23) */
  endHour?: number;
  /** Days of week (0 = Sunday) */
  daysOfWeek?: number[];
  /** Timezone */
  timezone?: string;
}

/**
 * Policy evaluation result
 */
export interface PolicyEvaluationResult {
  /** Policy that was evaluated */
  policyId: ID;
  /** Policy name */
  policyName: string;
  /** Whether policy matched */
  matched: boolean;
  /** Resulting action */
  action: ControlAction;
  /** Rules that were evaluated */
  rulesEvaluated: RuleEvaluationResult[];
  /** Matched rules */
  matchedRules: RuleEvaluationResult[];
  /** Applied constraints */
  appliedConstraints: string[];
  /** Evaluation duration */
  durationMs: number;
  /** Evaluation timestamp */
  evaluatedAt: Timestamp;
}

/**
 * Rule evaluation result
 */
export interface RuleEvaluationResult {
  /** Rule ID */
  ruleId: ID;
  /** Rule name */
  ruleName: string;
  /** Whether rule matched */
  matched: boolean;
  /** Resulting action */
  action: ControlAction;
  /** Reason for result */
  reason?: string;
  /** Evaluation details */
  details?: Record<string, unknown>;
}

// =============================================================================
// EVALUATION CONTEXT
// =============================================================================

/**
 * Context for policy evaluation
 */
export interface PolicyEvaluationContext {
  /** The intent being evaluated */
  intent: Intent;
  /** Trust score */
  trustScore: TrustScore;
  /** Trust level */
  trustLevel: TrustLevel;
  /** Additional context data */
  context?: Record<string, unknown>;
  /** Environment data */
  environment?: {
    timestamp: Timestamp;
    timezone: string;
  };
}

// =============================================================================
// POLICY ENGINE OPTIONS
// =============================================================================

/**
 * Policy engine configuration options
 */
export interface PolicyEngineOptions {
  /** Default action when no policies match */
  defaultAction?: ControlAction;
  /** Enable OpenTelemetry tracing */
  enableTracing?: boolean;
  /** Maximum policies to evaluate */
  maxPolicies?: number;
  /** Enable policy caching */
  enableCaching?: boolean;
  /** Cache TTL in milliseconds */
  cacheTtlMs?: number;
}

// =============================================================================
// POLICY ENGINE
// =============================================================================

/**
 * PolicyEngine class for evaluating enforcement policies
 */
export class PolicyEngine {
  private policies: Map<ID, EnforcementPolicy> = new Map();
  private templates: Map<ID, ConstraintTemplate> = new Map();
  private policyVersions: Map<ID, PolicyVersion[]> = new Map();
  private options: Required<PolicyEngineOptions>;
  private updateListeners: Array<(policyId: ID, action: 'add' | 'update' | 'remove') => void> = [];

  constructor(options: PolicyEngineOptions = {}) {
    this.options = {
      defaultAction: options.defaultAction ?? 'deny',
      enableTracing: options.enableTracing ?? true,
      maxPolicies: options.maxPolicies ?? 1000,
      enableCaching: options.enableCaching ?? true,
      cacheTtlMs: options.cacheTtlMs ?? 60000,
    };

    logger.info({
      defaultAction: this.options.defaultAction,
      enableTracing: this.options.enableTracing,
      maxPolicies: this.options.maxPolicies,
    }, 'Policy engine initialized');
  }

  /**
   * Evaluate an intent against all applicable policies
   */
  evaluate(context: PolicyEvaluationContext): PolicyEvaluationResult[] {
    const startTime = performance.now();
    const results: PolicyEvaluationResult[] = [];

    // Get applicable policies sorted by priority
    const applicablePolicies = this.getApplicablePolicies(context);

    for (const policy of applicablePolicies) {
      const result = this.evaluatePolicy(policy, context);
      results.push(result);

      // Short-circuit on deny
      if (result.matched && result.action === 'deny') {
        logger.debug({
          policyId: policy.id,
          intentId: context.intent.id,
        }, 'Deny policy matched - short-circuiting');
        break;
      }
    }

    const durationMs = performance.now() - startTime;

    logger.info({
      intentId: context.intent.id,
      policiesEvaluated: results.length,
      matchedPolicies: results.filter(r => r.matched).length,
      durationMs,
    }, 'Policy evaluation completed');

    return results;
  }

  /**
   * Evaluate with OpenTelemetry tracing
   */
  async evaluateWithTracing(context: PolicyEvaluationContext): Promise<PolicyEvaluationResult[]> {
    if (!this.options.enableTracing) {
      return this.evaluate(context);
    }

    return withSpan(
      'enforce.evaluatePolicies',
      async (span: TraceSpan) => {
        span.attributes['intent.id'] = context.intent.id;
        span.attributes['intent.goal'] = context.intent.goal;
        span.attributes['trust.level'] = context.trustLevel;
        span.attributes['trust.score'] = context.trustScore;

        const results = this.evaluate(context);

        span.attributes['policies.evaluated'] = results.length;
        span.attributes['policies.matched'] = results.filter(r => r.matched).length;

        const finalAction = this.determineFinalAction(results);
        span.attributes['result.action'] = finalAction;

        return results;
      },
      { 'tenant.id': context.intent.tenantId }
    );
  }

  /**
   * Determine the final action from evaluation results
   */
  determineFinalAction(results: PolicyEvaluationResult[]): ControlAction {
    const matchedResults = results.filter(r => r.matched);

    if (matchedResults.length === 0) {
      return this.options.defaultAction;
    }

    // Deny overrides all
    if (matchedResults.some(r => r.action === 'deny')) {
      return 'deny';
    }

    // Escalate if any require escalation
    if (matchedResults.some(r => r.action === 'escalate')) {
      return 'escalate';
    }

    // Limit if any require limiting
    if (matchedResults.some(r => r.action === 'limit')) {
      return 'limit';
    }

    // Monitor if any require monitoring
    if (matchedResults.some(r => r.action === 'monitor')) {
      return 'monitor';
    }

    return 'allow';
  }

  /**
   * Evaluate a single policy
   */
  private evaluatePolicy(
    policy: EnforcementPolicy,
    context: PolicyEvaluationContext
  ): PolicyEvaluationResult {
    const startTime = performance.now();
    const rulesEvaluated: RuleEvaluationResult[] = [];
    const matchedRules: RuleEvaluationResult[] = [];
    const appliedConstraints: string[] = [];

    // Sort rules by priority
    const sortedRules = [...policy.rules]
      .filter(r => r.enabled)
      .sort((a, b) => a.priority - b.priority);

    let finalAction: ControlAction = policy.defaultAction;
    let matched = false;

    for (const rule of sortedRules) {
      const ruleResult = this.evaluateRule(rule, context);
      rulesEvaluated.push(ruleResult);

      if (ruleResult.matched) {
        matched = true;
        matchedRules.push(ruleResult);
        finalAction = ruleResult.action;

        if (rule.constraints) {
          appliedConstraints.push(...rule.constraints);
        }

        // Short-circuit on deny
        if (ruleResult.action === 'deny') {
          break;
        }
      }
    }

    const durationMs = performance.now() - startTime;

    return {
      policyId: policy.id,
      policyName: policy.name,
      matched,
      action: finalAction,
      rulesEvaluated,
      matchedRules,
      appliedConstraints: [...new Set(appliedConstraints)],
      durationMs,
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Evaluate a single rule
   */
  private evaluateRule(
    rule: PolicyRule,
    context: PolicyEvaluationContext
  ): RuleEvaluationResult {
    try {
      const matched = this.evaluateCondition(rule.condition, context);

      return {
        ruleId: rule.id,
        ruleName: rule.name,
        matched,
        action: rule.action,
        reason: matched ? 'Condition matched' : 'Condition not matched',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.warn({ ruleId: rule.id, error: message }, 'Rule evaluation failed');

      return {
        ruleId: rule.id,
        ruleName: rule.name,
        matched: false,
        action: rule.action,
        reason: `Evaluation error: ${message}`,
      };
    }
  }

  /**
   * Evaluate a condition
   */
  private evaluateCondition(
    condition: RuleCondition,
    context: PolicyEvaluationContext
  ): boolean {
    switch (condition.type) {
      case 'expression':
        return this.evaluateExpression(condition.expression ?? '', context);

      case 'template':
        return this.evaluateTemplate(
          condition.templateId ?? '',
          condition.templateParams ?? {},
          context
        );

      case 'composite':
        return this.evaluateComposite(
          condition.conditions ?? [],
          condition.logic ?? 'AND',
          context
        );

      default:
        logger.warn({ type: condition.type }, 'Unknown condition type');
        return false;
    }
  }

  /**
   * Evaluate an expression condition
   */
  private evaluateExpression(
    expression: string,
    context: PolicyEvaluationContext
  ): boolean {
    // Simple expression evaluator
    // Supports: field.path == value, field.path != value, field.path > value, etc.
    const parts = expression.match(/^([\w.]+)\s*(==|!=|>|<|>=|<=|contains|matches)\s*(.+)$/);
    if (!parts) {
      logger.warn({ expression }, 'Invalid expression format');
      return false;
    }

    const [, fieldPath, operator, rawValue] = parts;
    const actualValue = this.resolveFieldPath(fieldPath!, context);
    const expectedValue = this.parseValue(rawValue!.trim());

    return this.compareValues(actualValue, operator!, expectedValue);
  }

  /**
   * Evaluate a template-based condition
   */
  private evaluateTemplate(
    templateId: ID,
    params: Record<string, unknown>,
    context: PolicyEvaluationContext
  ): boolean {
    const template = this.templates.get(templateId);
    if (!template) {
      logger.warn({ templateId }, 'Template not found');
      return false;
    }

    // Interpolate parameters into expression
    let expression = template.expression;
    for (const [key, value] of Object.entries(params)) {
      expression = expression.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
    }

    return this.evaluateExpression(expression, context);
  }

  /**
   * Evaluate composite conditions
   */
  private evaluateComposite(
    conditions: RuleCondition[],
    logic: 'AND' | 'OR',
    context: PolicyEvaluationContext
  ): boolean {
    if (conditions.length === 0) {
      return logic === 'AND'; // Empty AND = true, empty OR = false
    }

    if (logic === 'AND') {
      return conditions.every(c => this.evaluateCondition(c, context));
    } else {
      return conditions.some(c => this.evaluateCondition(c, context));
    }
  }

  /**
   * Resolve a field path from context
   */
  private resolveFieldPath(path: string, context: PolicyEvaluationContext): unknown {
    const parts = path.split('.');
    let current: unknown = context;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Parse a value string into its proper type
   */
  private parseValue(value: string): unknown {
    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }

    // Try number
    const num = Number(value);
    if (!isNaN(num)) {
      return num;
    }

    // Try boolean
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;

    // Try JSON
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  /**
   * Compare values using operator
   */
  private compareValues(actual: unknown, operator: string, expected: unknown): boolean {
    switch (operator) {
      case '==':
        return actual === expected;
      case '!=':
        return actual !== expected;
      case '>':
        return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
      case '<':
        return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
      case '>=':
        return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
      case '<=':
        return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
      case 'contains':
        return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
      case 'matches':
        if (typeof actual !== 'string' || typeof expected !== 'string') return false;
        try {
          return new RegExp(expected).test(actual);
        } catch {
          return false;
        }
      default:
        return false;
    }
  }

  /**
   * Get applicable policies for context
   */
  private getApplicablePolicies(context: PolicyEvaluationContext): EnforcementPolicy[] {
    const applicable: EnforcementPolicy[] = [];

    for (const policy of this.policies.values()) {
      if (!policy.enabled) continue;

      if (this.isPolicyApplicable(policy, context)) {
        applicable.push(policy);
      }
    }

    // Sort by priority (lower = higher priority)
    return applicable.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Check if a policy is applicable to the context
   */
  private isPolicyApplicable(
    policy: EnforcementPolicy,
    context: PolicyEvaluationContext
  ): boolean {
    if (!policy.conditions) return true;

    const { trustLevels, actionPatterns, resourcePatterns, intentTypes, timeConditions } = policy.conditions;

    // Check trust level
    if (trustLevels && trustLevels.length > 0) {
      if (!trustLevels.includes(context.trustLevel)) {
        return false;
      }
    }

    // Check action patterns
    if (actionPatterns && actionPatterns.length > 0) {
      const matches = actionPatterns.some(pattern =>
        this.matchPattern(context.intent.goal, pattern)
      );
      if (!matches) return false;
    }

    // Check resource patterns
    if (resourcePatterns && resourcePatterns.length > 0) {
      const resource = (context.intent.context as Record<string, unknown>)?.resource as string | undefined;
      if (!resource) return false;
      const matches = resourcePatterns.some(pattern =>
        this.matchPattern(resource, pattern)
      );
      if (!matches) return false;
    }

    // Check intent types
    if (intentTypes && intentTypes.length > 0) {
      const intentType = context.intent.intentType;
      if (!intentType) return false;
      const matches = intentTypes.some(pattern =>
        this.matchPattern(intentType, pattern)
      );
      if (!matches) return false;
    }

    // Check time conditions
    if (timeConditions && timeConditions.length > 0) {
      const matchesTime = timeConditions.some(tc => this.checkTimeCondition(tc, context));
      if (!matchesTime) return false;
    }

    return true;
  }

  /**
   * Match a value against a pattern (supports wildcards)
   */
  private matchPattern(value: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) {
      return value.startsWith(pattern.slice(0, -1));
    }
    if (pattern.startsWith('*')) {
      return value.endsWith(pattern.slice(1));
    }
    return value === pattern;
  }

  /**
   * Check time-based condition
   */
  private checkTimeCondition(condition: TimeCondition, context: PolicyEvaluationContext): boolean {
    const now = context.environment?.timestamp
      ? new Date(context.environment.timestamp)
      : new Date();

    // Check hour range
    if (condition.startHour !== undefined && condition.endHour !== undefined) {
      const hour = now.getHours();
      if (condition.startHour <= condition.endHour) {
        if (hour < condition.startHour || hour > condition.endHour) {
          return false;
        }
      } else {
        // Wrapping (e.g., 22:00 to 06:00)
        if (hour < condition.startHour && hour > condition.endHour) {
          return false;
        }
      }
    }

    // Check day of week
    if (condition.daysOfWeek && condition.daysOfWeek.length > 0) {
      const day = now.getDay();
      if (!condition.daysOfWeek.includes(day)) {
        return false;
      }
    }

    return true;
  }

  // =============================================================================
  // POLICY MANAGEMENT
  // =============================================================================

  /**
   * Add a policy
   */
  addPolicy(policy: EnforcementPolicy): void {
    if (this.policies.size >= this.options.maxPolicies) {
      throw new Error(`Maximum policy limit (${this.options.maxPolicies}) reached`);
    }

    this.policies.set(policy.id, policy);

    // Track version
    const versions = this.policyVersions.get(policy.id) ?? [];
    versions.push(policy.version);
    this.policyVersions.set(policy.id, versions);

    logger.info({ policyId: policy.id, policyName: policy.name }, 'Policy added');
    this.notifyListeners(policy.id, 'add');
  }

  /**
   * Update a policy (creates new version)
   */
  updatePolicy(policyId: ID, updates: Partial<EnforcementPolicy>, versionInfo: Omit<PolicyVersion, 'previousVersionId'>): void {
    const existing = this.policies.get(policyId);
    if (!existing) {
      throw new Error(`Policy not found: ${policyId}`);
    }

    const newVersion: PolicyVersion = {
      ...versionInfo,
      previousVersionId: existing.version.version,
    };

    const updated: EnforcementPolicy = {
      ...existing,
      ...updates,
      version: newVersion,
      updatedAt: new Date().toISOString(),
    };

    this.policies.set(policyId, updated);

    // Track version
    const versions = this.policyVersions.get(policyId) ?? [];
    versions.push(newVersion);
    this.policyVersions.set(policyId, versions);

    logger.info({ policyId, version: newVersion.version }, 'Policy updated');
    this.notifyListeners(policyId, 'update');
  }

  /**
   * Remove a policy
   */
  removePolicy(policyId: ID): boolean {
    const removed = this.policies.delete(policyId);
    if (removed) {
      logger.info({ policyId }, 'Policy removed');
      this.notifyListeners(policyId, 'remove');
    }
    return removed;
  }

  /**
   * Get a policy by ID
   */
  getPolicy(policyId: ID): EnforcementPolicy | undefined {
    return this.policies.get(policyId);
  }

  /**
   * Get all policies
   */
  getAllPolicies(): EnforcementPolicy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Get enabled policies
   */
  getEnabledPolicies(): EnforcementPolicy[] {
    return Array.from(this.policies.values()).filter(p => p.enabled);
  }

  /**
   * Get policy version history
   */
  getPolicyVersions(policyId: ID): PolicyVersion[] {
    return this.policyVersions.get(policyId) ?? [];
  }

  /**
   * Rollback policy to previous version
   */
  rollbackPolicy(policyId: ID): boolean {
    const versions = this.policyVersions.get(policyId);
    if (!versions || versions.length < 2) {
      return false;
    }

    const currentPolicy = this.policies.get(policyId);
    if (!currentPolicy) {
      return false;
    }

    // Pop current version
    versions.pop();
    const previousVersion = versions[versions.length - 1];

    if (!previousVersion) {
      return false;
    }

    // Update policy with previous version info
    const rolledBack: EnforcementPolicy = {
      ...currentPolicy,
      version: previousVersion,
      updatedAt: new Date().toISOString(),
    };

    this.policies.set(policyId, rolledBack);
    logger.info({ policyId, version: previousVersion.version }, 'Policy rolled back');
    this.notifyListeners(policyId, 'update');

    return true;
  }

  // =============================================================================
  // TEMPLATE MANAGEMENT
  // =============================================================================

  /**
   * Add a constraint template
   */
  addTemplate(template: ConstraintTemplate): void {
    this.templates.set(template.id, template);
    logger.info({ templateId: template.id, templateName: template.name }, 'Template added');
  }

  /**
   * Remove a template
   */
  removeTemplate(templateId: ID): boolean {
    const removed = this.templates.delete(templateId);
    if (removed) {
      logger.info({ templateId }, 'Template removed');
    }
    return removed;
  }

  /**
   * Get a template by ID
   */
  getTemplate(templateId: ID): ConstraintTemplate | undefined {
    return this.templates.get(templateId);
  }

  /**
   * Get all templates
   */
  getAllTemplates(): ConstraintTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Find templates by tag
   */
  findTemplatesByTag(tag: string): ConstraintTemplate[] {
    return Array.from(this.templates.values()).filter(t => t.tags.includes(tag));
  }

  // =============================================================================
  // UPDATE LISTENERS
  // =============================================================================

  /**
   * Register an update listener
   */
  onPolicyUpdate(listener: (policyId: ID, action: 'add' | 'update' | 'remove') => void): () => void {
    this.updateListeners.push(listener);
    return () => {
      const index = this.updateListeners.indexOf(listener);
      if (index !== -1) {
        this.updateListeners.splice(index, 1);
      }
    };
  }

  /**
   * Notify listeners of policy updates
   */
  private notifyListeners(policyId: ID, action: 'add' | 'update' | 'remove'): void {
    for (const listener of this.updateListeners) {
      try {
        listener(policyId, action);
      } catch (error) {
        logger.error({ error }, 'Policy update listener error');
      }
    }
  }

  /**
   * Clear all policies and templates
   */
  clear(): void {
    this.policies.clear();
    this.templates.clear();
    this.policyVersions.clear();
    logger.info('Policy engine cleared');
  }

  /**
   * Get engine statistics
   */
  getStats(): {
    totalPolicies: number;
    enabledPolicies: number;
    totalTemplates: number;
    totalVersions: number;
  } {
    let totalVersions = 0;
    for (const versions of this.policyVersions.values()) {
      totalVersions += versions.length;
    }

    return {
      totalPolicies: this.policies.size,
      enabledPolicies: Array.from(this.policies.values()).filter(p => p.enabled).length,
      totalTemplates: this.templates.size,
      totalVersions,
    };
  }
}

/**
 * Create a new policy engine instance
 */
export function createPolicyEngine(options?: PolicyEngineOptions): PolicyEngine {
  return new PolicyEngine(options);
}

/**
 * Create a new enforcement policy with defaults
 */
export function createEnforcementPolicy(
  partial: Partial<EnforcementPolicy> & Pick<EnforcementPolicy, 'id' | 'name' | 'rules'>
): EnforcementPolicy {
  const now = new Date().toISOString();
  return {
    description: '',
    defaultAction: 'deny',
    priority: 100,
    enabled: true,
    version: {
      version: '1.0.0',
      createdBy: 'system',
      createdAt: now,
    },
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}
