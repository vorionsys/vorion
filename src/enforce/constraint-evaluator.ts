/**
 * Constraint Evaluator
 *
 * Evaluates complex constraint logic with support for:
 * - Rate limiting
 * - Time windows
 * - Resource caps
 * - Dependencies
 * - Constraint composition (AND, OR, NOT)
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

const logger = createLogger({ component: 'constraint-evaluator' });

// =============================================================================
// CONSTRAINT TYPES
// =============================================================================

/**
 * Supported constraint types
 */
export type ConstraintType = 'rate-limit' | 'time-window' | 'resource-cap' | 'dependency' | 'custom';

/**
 * Base constraint interface
 */
export interface BaseConstraint {
  /** Unique constraint identifier */
  id: ID;
  /** Constraint name */
  name: string;
  /** Constraint description */
  description?: string;
  /** Constraint type */
  type: ConstraintType;
  /** Whether constraint is enabled */
  enabled: boolean;
  /** Action when constraint is violated */
  violationAction: ControlAction;
  /** Priority for evaluation order */
  priority: number;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Rate limit constraint
 */
export interface RateLimitConstraint extends BaseConstraint {
  type: 'rate-limit';
  /** Rate limit configuration */
  config: {
    /** Maximum requests allowed */
    limit: number;
    /** Window duration in milliseconds */
    windowMs: number;
    /** Key for rate limiting (e.g., 'entityId', 'tenantId', 'action') */
    keyBy: string | string[];
    /** Whether to count successful requests only */
    successOnly?: boolean;
    /** Burst allowance (temporary spike over limit) */
    burstAllowance?: number;
  };
}

/**
 * Time window constraint
 */
export interface TimeWindowConstraint extends BaseConstraint {
  type: 'time-window';
  /** Time window configuration */
  config: {
    /** Allowed start time (HH:MM format or ISO) */
    allowedStart?: string;
    /** Allowed end time (HH:MM format or ISO) */
    allowedEnd?: string;
    /** Allowed days of week (0 = Sunday) */
    allowedDays?: number[];
    /** Timezone */
    timezone?: string;
    /** Blackout periods (deny during these times) */
    blackoutPeriods?: Array<{
      start: string;
      end: string;
      reason?: string;
    }>;
  };
}

/**
 * Resource cap constraint
 */
export interface ResourceCapConstraint extends BaseConstraint {
  type: 'resource-cap';
  /** Resource cap configuration */
  config: {
    /** Resource identifier */
    resourceId: string;
    /** Maximum concurrent usage */
    maxConcurrent?: number;
    /** Maximum total usage */
    maxTotal?: number;
    /** Current usage tracking key */
    usageKey: string;
    /** Reset period in milliseconds (for total) */
    resetPeriodMs?: number;
    /** Resource allocation strategy */
    allocationStrategy?: 'fifo' | 'priority' | 'fair';
  };
}

/**
 * Dependency constraint
 */
export interface DependencyConstraint extends BaseConstraint {
  type: 'dependency';
  /** Dependency configuration */
  config: {
    /** Required intent types that must complete first */
    requiredIntents?: string[];
    /** Required approval from */
    requiredApprovals?: string[];
    /** Maximum age of dependency fulfillment in ms */
    maxAgeMs?: number;
    /** Whether dependencies must be from same entity */
    sameEntity?: boolean;
    /** Dependency relationship */
    relationship: 'all' | 'any';
  };
}

/**
 * Custom constraint
 */
export interface CustomConstraint extends BaseConstraint {
  type: 'custom';
  /** Custom constraint configuration */
  config: {
    /** Expression to evaluate */
    expression: string;
    /** Custom function name */
    evaluatorFn?: string;
    /** Additional parameters */
    params?: Record<string, unknown>;
  };
}

/**
 * Union type for all constraints
 */
export type Constraint =
  | RateLimitConstraint
  | TimeWindowConstraint
  | ResourceCapConstraint
  | DependencyConstraint
  | CustomConstraint;

// =============================================================================
// COMPOSITE CONSTRAINTS
// =============================================================================

/**
 * Composite constraint logic
 */
export type CompositeLogic = 'AND' | 'OR' | 'NOT';

/**
 * Composite constraint for combining multiple constraints
 */
export interface CompositeConstraint {
  /** Unique identifier */
  id: ID;
  /** Constraint name */
  name: string;
  /** Logic to apply */
  logic: CompositeLogic;
  /** Child constraints */
  constraints: (Constraint | CompositeConstraint)[];
  /** Whether enabled */
  enabled: boolean;
  /** Action when composite fails */
  violationAction: ControlAction;
}

// =============================================================================
// EVALUATION CONTEXT
// =============================================================================

/**
 * Context for constraint evaluation
 */
export interface ConstraintEvaluationContext {
  /** The intent being evaluated */
  intent: Intent;
  /** Trust score */
  trustScore: TrustScore;
  /** Trust level */
  trustLevel: TrustLevel;
  /** Additional context */
  context?: Record<string, unknown>;
  /** Environment data */
  environment?: {
    timestamp: Timestamp;
    timezone: string;
  };
}

/**
 * State provider interface for external state lookup
 */
export interface StateProvider {
  /** Get current rate count */
  getRateCount(key: string, windowMs: number): Promise<number>;
  /** Increment rate count */
  incrementRateCount(key: string, windowMs: number): Promise<number>;
  /** Get current resource usage */
  getResourceUsage(resourceId: string): Promise<{ concurrent: number; total: number }>;
  /** Check if dependency is fulfilled */
  checkDependency(entityId: ID, intentTypes: string[], maxAgeMs?: number): Promise<boolean>;
  /** Check if approval exists */
  checkApproval(intentId: ID, approvers: string[]): Promise<boolean>;
}

// =============================================================================
// EVALUATION RESULT
// =============================================================================

/**
 * Result of evaluating a constraint
 */
export interface ConstraintEvaluationResult {
  /** Constraint that was evaluated */
  constraintId: ID;
  /** Constraint name */
  constraintName: string;
  /** Whether constraint passed */
  passed: boolean;
  /** Resulting action */
  action: ControlAction;
  /** Reason for result */
  reason: string;
  /** Additional details */
  details: Record<string, unknown>;
  /** Evaluation duration in ms */
  durationMs: number;
  /** Evaluation timestamp */
  evaluatedAt: Timestamp;
}

// =============================================================================
// CONSTRAINT EVALUATOR OPTIONS
// =============================================================================

/**
 * Constraint evaluator options
 */
export interface ConstraintEvaluatorOptions {
  /** Enable OpenTelemetry tracing */
  enableTracing?: boolean;
  /** Default violation action */
  defaultViolationAction?: ControlAction;
  /** Custom evaluator functions */
  customEvaluators?: Map<string, (constraint: CustomConstraint, context: ConstraintEvaluationContext) => Promise<boolean>>;
}

// =============================================================================
// DEFAULT STATE PROVIDER
// =============================================================================

/**
 * In-memory state provider for testing/development
 */
export class InMemoryStateProvider implements StateProvider {
  private rateCounts: Map<string, { count: number; resetAt: number }> = new Map();
  private resourceUsage: Map<string, { concurrent: number; total: number }> = new Map();
  private dependencies: Map<string, Array<{ type: string; timestamp: number }>> = new Map();
  private approvals: Map<string, string[]> = new Map();

  async getRateCount(key: string, windowMs: number): Promise<number> {
    const entry = this.rateCounts.get(key);
    if (!entry || Date.now() >= entry.resetAt) {
      return 0;
    }
    return entry.count;
  }

  async incrementRateCount(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    const entry = this.rateCounts.get(key);

    if (!entry || now >= entry.resetAt) {
      this.rateCounts.set(key, { count: 1, resetAt: now + windowMs });
      return 1;
    }

    entry.count++;
    return entry.count;
  }

  async getResourceUsage(resourceId: string): Promise<{ concurrent: number; total: number }> {
    return this.resourceUsage.get(resourceId) ?? { concurrent: 0, total: 0 };
  }

  async checkDependency(entityId: ID, intentTypes: string[], maxAgeMs?: number): Promise<boolean> {
    const deps = this.dependencies.get(entityId) ?? [];
    const now = Date.now();

    for (const intentType of intentTypes) {
      const found = deps.find(d => {
        if (d.type !== intentType) return false;
        if (maxAgeMs && now - d.timestamp > maxAgeMs) return false;
        return true;
      });
      if (!found) return false;
    }

    return true;
  }

  async checkApproval(intentId: ID, approvers: string[]): Promise<boolean> {
    const existingApprovals = this.approvals.get(intentId) ?? [];
    return approvers.some(a => existingApprovals.includes(a));
  }

  // Test helpers
  setRateCount(key: string, count: number, windowMs: number): void {
    this.rateCounts.set(key, { count, resetAt: Date.now() + windowMs });
  }

  setResourceUsage(resourceId: string, concurrent: number, total: number): void {
    this.resourceUsage.set(resourceId, { concurrent, total });
  }

  addDependency(entityId: ID, intentType: string): void {
    const deps = this.dependencies.get(entityId) ?? [];
    deps.push({ type: intentType, timestamp: Date.now() });
    this.dependencies.set(entityId, deps);
  }

  addApproval(intentId: ID, approver: string): void {
    const approvals = this.approvals.get(intentId) ?? [];
    approvals.push(approver);
    this.approvals.set(intentId, approvals);
  }

  clear(): void {
    this.rateCounts.clear();
    this.resourceUsage.clear();
    this.dependencies.clear();
    this.approvals.clear();
  }
}

// =============================================================================
// CONSTRAINT EVALUATOR
// =============================================================================

/**
 * ConstraintEvaluator class for evaluating constraints
 */
export class ConstraintEvaluator {
  private constraints: Map<ID, Constraint | CompositeConstraint> = new Map();
  private stateProvider: StateProvider;
  private options: Required<ConstraintEvaluatorOptions>;
  private customEvaluators: Map<string, (constraint: CustomConstraint, context: ConstraintEvaluationContext) => Promise<boolean>>;

  constructor(
    stateProvider?: StateProvider,
    options: ConstraintEvaluatorOptions = {}
  ) {
    this.stateProvider = stateProvider ?? new InMemoryStateProvider();
    this.options = {
      enableTracing: options.enableTracing ?? true,
      defaultViolationAction: options.defaultViolationAction ?? 'deny',
      customEvaluators: options.customEvaluators ?? new Map(),
    };
    this.customEvaluators = this.options.customEvaluators;

    logger.info({
      enableTracing: this.options.enableTracing,
      defaultViolationAction: this.options.defaultViolationAction,
    }, 'Constraint evaluator initialized');
  }

  /**
   * Evaluate all applicable constraints
   */
  async evaluateAll(context: ConstraintEvaluationContext): Promise<ConstraintEvaluationResult[]> {
    const results: ConstraintEvaluationResult[] = [];

    // Sort constraints by priority
    const sortedConstraints = Array.from(this.constraints.values())
      .filter(c => c.enabled)
      .sort((a, b) => {
        const priorityA = 'priority' in a ? a.priority : 0;
        const priorityB = 'priority' in b ? b.priority : 0;
        return priorityA - priorityB;
      });

    for (const constraint of sortedConstraints) {
      const result = await this.evaluate(constraint, context);
      results.push(result);

      // Short-circuit on violation with deny action
      if (!result.passed && result.action === 'deny') {
        logger.debug({
          constraintId: constraint.id,
          intentId: context.intent.id,
        }, 'Constraint violation - short-circuiting');
        break;
      }
    }

    return results;
  }

  /**
   * Evaluate all constraints with tracing
   */
  async evaluateAllWithTracing(context: ConstraintEvaluationContext): Promise<ConstraintEvaluationResult[]> {
    if (!this.options.enableTracing) {
      return this.evaluateAll(context);
    }

    return withSpan(
      'enforce.evaluateConstraints',
      async (span: TraceSpan) => {
        span.attributes['intent.id'] = context.intent.id;
        span.attributes['constraints.total'] = this.constraints.size;

        const results = await this.evaluateAll(context);

        span.attributes['constraints.evaluated'] = results.length;
        span.attributes['constraints.passed'] = results.filter(r => r.passed).length;
        span.attributes['constraints.failed'] = results.filter(r => !r.passed).length;

        return results;
      },
      { 'tenant.id': context.intent.tenantId }
    );
  }

  /**
   * Evaluate a single constraint
   */
  async evaluate(
    constraint: Constraint | CompositeConstraint,
    context: ConstraintEvaluationContext
  ): Promise<ConstraintEvaluationResult> {
    const startTime = performance.now();

    try {
      // Handle composite constraints
      if ('logic' in constraint) {
        return this.evaluateComposite(constraint, context, startTime);
      }

      // Handle specific constraint types
      switch (constraint.type) {
        case 'rate-limit':
          return this.evaluateRateLimit(constraint, context, startTime);
        case 'time-window':
          return this.evaluateTimeWindow(constraint, context, startTime);
        case 'resource-cap':
          return this.evaluateResourceCap(constraint, context, startTime);
        case 'dependency':
          return this.evaluateDependency(constraint, context, startTime);
        case 'custom':
          return this.evaluateCustom(constraint, context, startTime);
        default:
          return this.createResult(
            constraint,
            false,
            'Unknown constraint type',
            {},
            startTime
          );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ constraintId: constraint.id, error: message }, 'Constraint evaluation error');

      return this.createResult(
        constraint,
        false,
        `Evaluation error: ${message}`,
        { error: message },
        startTime
      );
    }
  }

  /**
   * Evaluate rate limit constraint
   */
  private async evaluateRateLimit(
    constraint: RateLimitConstraint,
    context: ConstraintEvaluationContext,
    startTime: number
  ): Promise<ConstraintEvaluationResult> {
    const { limit, windowMs, keyBy, burstAllowance } = constraint.config;

    // Build rate limit key
    const keyParts = Array.isArray(keyBy) ? keyBy : [keyBy];
    const keyValues = keyParts.map(k => this.resolveKey(k, context));
    const key = `rate:${constraint.id}:${keyValues.join(':')}`;

    const currentCount = await this.stateProvider.getRateCount(key, windowMs);
    const effectiveLimit = limit + (burstAllowance ?? 0);

    const passed = currentCount < effectiveLimit;

    logger.debug({
      constraintId: constraint.id,
      key,
      currentCount,
      limit: effectiveLimit,
      passed,
    }, 'Rate limit evaluated');

    return this.createResult(
      constraint,
      passed,
      passed ? 'Within rate limit' : `Rate limit exceeded: ${currentCount}/${limit}`,
      { currentCount, limit, key },
      startTime
    );
  }

  /**
   * Evaluate time window constraint
   */
  private async evaluateTimeWindow(
    constraint: TimeWindowConstraint,
    context: ConstraintEvaluationContext,
    startTime: number
  ): Promise<ConstraintEvaluationResult> {
    const { allowedStart, allowedEnd, allowedDays, blackoutPeriods } = constraint.config;
    const now = context.environment?.timestamp
      ? new Date(context.environment.timestamp)
      : new Date();

    // Check blackout periods first
    if (blackoutPeriods && blackoutPeriods.length > 0) {
      for (const period of blackoutPeriods) {
        const blackoutStart = this.parseTime(period.start, now);
        const blackoutEnd = this.parseTime(period.end, now);

        if (now >= blackoutStart && now <= blackoutEnd) {
          return this.createResult(
            constraint,
            false,
            `In blackout period: ${period.reason ?? 'Maintenance'}`,
            { blackoutPeriod: period },
            startTime
          );
        }
      }
    }

    // Check allowed days
    if (allowedDays && allowedDays.length > 0) {
      const day = now.getDay();
      if (!allowedDays.includes(day)) {
        return this.createResult(
          constraint,
          false,
          `Day ${day} not in allowed days`,
          { currentDay: day, allowedDays },
          startTime
        );
      }
    }

    // Check allowed time range
    if (allowedStart && allowedEnd) {
      const startParts = allowedStart.split(':').map(Number);
      const endParts = allowedEnd.split(':').map(Number);
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const startMinutes = (startParts[0] ?? 0) * 60 + (startParts[1] ?? 0);
      const endMinutes = (endParts[0] ?? 0) * 60 + (endParts[1] ?? 0);

      let inWindow: boolean;
      if (startMinutes <= endMinutes) {
        inWindow = currentMinutes >= startMinutes && currentMinutes <= endMinutes;
      } else {
        // Wrapping time (e.g., 22:00 to 06:00)
        inWindow = currentMinutes >= startMinutes || currentMinutes <= endMinutes;
      }

      if (!inWindow) {
        return this.createResult(
          constraint,
          false,
          `Time ${now.toTimeString().slice(0, 5)} not in allowed window ${allowedStart}-${allowedEnd}`,
          { currentTime: now.toISOString(), allowedStart, allowedEnd },
          startTime
        );
      }
    }

    return this.createResult(
      constraint,
      true,
      'Within allowed time window',
      { currentTime: now.toISOString() },
      startTime
    );
  }

  /**
   * Evaluate resource cap constraint
   */
  private async evaluateResourceCap(
    constraint: ResourceCapConstraint,
    context: ConstraintEvaluationContext,
    startTime: number
  ): Promise<ConstraintEvaluationResult> {
    const { resourceId, maxConcurrent, maxTotal } = constraint.config;
    const usage = await this.stateProvider.getResourceUsage(resourceId);

    // Check concurrent limit
    if (maxConcurrent !== undefined && usage.concurrent >= maxConcurrent) {
      return this.createResult(
        constraint,
        false,
        `Concurrent resource limit exceeded: ${usage.concurrent}/${maxConcurrent}`,
        { usage, maxConcurrent },
        startTime
      );
    }

    // Check total limit
    if (maxTotal !== undefined && usage.total >= maxTotal) {
      return this.createResult(
        constraint,
        false,
        `Total resource limit exceeded: ${usage.total}/${maxTotal}`,
        { usage, maxTotal },
        startTime
      );
    }

    return this.createResult(
      constraint,
      true,
      'Within resource limits',
      { usage, maxConcurrent, maxTotal },
      startTime
    );
  }

  /**
   * Evaluate dependency constraint
   */
  private async evaluateDependency(
    constraint: DependencyConstraint,
    context: ConstraintEvaluationContext,
    startTime: number
  ): Promise<ConstraintEvaluationResult> {
    const { requiredIntents, requiredApprovals, maxAgeMs, relationship } = constraint.config;
    const entityId = context.intent.entityId;
    const intentId = context.intent.id;

    // Check required intents
    if (requiredIntents && requiredIntents.length > 0) {
      if (relationship === 'all') {
        const fulfilled = await this.stateProvider.checkDependency(entityId, requiredIntents, maxAgeMs);
        if (!fulfilled) {
          return this.createResult(
            constraint,
            false,
            `Required intents not fulfilled: ${requiredIntents.join(', ')}`,
            { requiredIntents, maxAgeMs },
            startTime
          );
        }
      } else {
        // any
        let anyFulfilled = false;
        for (const intentType of requiredIntents) {
          const fulfilled = await this.stateProvider.checkDependency(entityId, [intentType], maxAgeMs);
          if (fulfilled) {
            anyFulfilled = true;
            break;
          }
        }
        if (!anyFulfilled) {
          return this.createResult(
            constraint,
            false,
            `None of required intents fulfilled: ${requiredIntents.join(', ')}`,
            { requiredIntents, maxAgeMs },
            startTime
          );
        }
      }
    }

    // Check required approvals
    if (requiredApprovals && requiredApprovals.length > 0) {
      const hasApproval = await this.stateProvider.checkApproval(intentId, requiredApprovals);
      if (!hasApproval) {
        return this.createResult(
          constraint,
          false,
          `Required approval not found from: ${requiredApprovals.join(', ')}`,
          { requiredApprovals },
          startTime
        );
      }
    }

    return this.createResult(
      constraint,
      true,
      'All dependencies satisfied',
      { requiredIntents, requiredApprovals },
      startTime
    );
  }

  /**
   * Evaluate custom constraint
   */
  private async evaluateCustom(
    constraint: CustomConstraint,
    context: ConstraintEvaluationContext,
    startTime: number
  ): Promise<ConstraintEvaluationResult> {
    const { expression, evaluatorFn, params } = constraint.config;

    // Try custom evaluator function first
    if (evaluatorFn) {
      const evaluator = this.customEvaluators.get(evaluatorFn);
      if (evaluator) {
        const passed = await evaluator(constraint, context);
        return this.createResult(
          constraint,
          passed,
          passed ? 'Custom evaluator passed' : 'Custom evaluator failed',
          { evaluatorFn, params },
          startTime
        );
      }
      logger.warn({ evaluatorFn }, 'Custom evaluator not found');
    }

    // Fall back to expression evaluation
    if (expression) {
      const passed = this.evaluateExpression(expression, context);
      return this.createResult(
        constraint,
        passed,
        passed ? 'Expression evaluated to true' : 'Expression evaluated to false',
        { expression },
        startTime
      );
    }

    return this.createResult(
      constraint,
      false,
      'No evaluator or expression provided',
      {},
      startTime
    );
  }

  /**
   * Evaluate composite constraint
   */
  private async evaluateComposite(
    constraint: CompositeConstraint,
    context: ConstraintEvaluationContext,
    startTime: number
  ): Promise<ConstraintEvaluationResult> {
    const results: Array<{ id: ID; passed: boolean }> = [];

    for (const child of constraint.constraints) {
      const result = await this.evaluate(child, context);
      results.push({ id: child.id, passed: result.passed });
    }

    let passed: boolean;
    switch (constraint.logic) {
      case 'AND':
        passed = results.every(r => r.passed);
        break;
      case 'OR':
        passed = results.some(r => r.passed);
        break;
      case 'NOT':
        // NOT applies to the first constraint only
        passed = results.length > 0 ? !results[0]!.passed : true;
        break;
      default:
        passed = false;
    }

    return {
      constraintId: constraint.id,
      constraintName: constraint.name,
      passed,
      action: passed ? 'allow' : constraint.violationAction,
      reason: passed
        ? `Composite (${constraint.logic}) passed`
        : `Composite (${constraint.logic}) failed`,
      details: { logic: constraint.logic, childResults: results },
      durationMs: performance.now() - startTime,
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Evaluate a simple expression
   */
  private evaluateExpression(expression: string, context: ConstraintEvaluationContext): boolean {
    // Simple expression evaluator supporting: field.path == value
    const parts = expression.match(/^([\w.]+)\s*(==|!=|>|<|>=|<=)\s*(.+)$/);
    if (!parts) {
      logger.warn({ expression }, 'Invalid expression format');
      return false;
    }

    const [, fieldPath, operator, rawValue] = parts;
    const actualValue = this.resolveFieldPath(fieldPath!, context);
    const expectedValue = this.parseValue(rawValue!.trim());

    switch (operator) {
      case '==':
        return actualValue === expectedValue;
      case '!=':
        return actualValue !== expectedValue;
      case '>':
        return typeof actualValue === 'number' && typeof expectedValue === 'number' && actualValue > expectedValue;
      case '<':
        return typeof actualValue === 'number' && typeof expectedValue === 'number' && actualValue < expectedValue;
      case '>=':
        return typeof actualValue === 'number' && typeof expectedValue === 'number' && actualValue >= expectedValue;
      case '<=':
        return typeof actualValue === 'number' && typeof expectedValue === 'number' && actualValue <= expectedValue;
      default:
        return false;
    }
  }

  /**
   * Resolve a field path from context
   */
  private resolveFieldPath(path: string, context: ConstraintEvaluationContext): unknown {
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
   * Resolve a key from context
   */
  private resolveKey(key: string, context: ConstraintEvaluationContext): string {
    const value = this.resolveFieldPath(`intent.${key}`, context) ??
                  this.resolveFieldPath(key, context);
    return String(value ?? 'unknown');
  }

  /**
   * Parse a value string
   */
  private parseValue(value: string): unknown {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    const num = Number(value);
    if (!isNaN(num)) return num;
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    return value;
  }

  /**
   * Parse time string to Date
   */
  private parseTime(timeStr: string, reference: Date): Date {
    if (timeStr.includes('T') || timeStr.includes('-')) {
      return new Date(timeStr);
    }
    // Assume HH:MM format
    const [hours, minutes] = timeStr.split(':').map(Number);
    const date = new Date(reference);
    date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
    return date;
  }

  /**
   * Create evaluation result
   */
  private createResult(
    constraint: Constraint | CompositeConstraint,
    passed: boolean,
    reason: string,
    details: Record<string, unknown>,
    startTime: number
  ): ConstraintEvaluationResult {
    const violationAction = 'violationAction' in constraint
      ? constraint.violationAction
      : this.options.defaultViolationAction;

    return {
      constraintId: constraint.id,
      constraintName: constraint.name,
      passed,
      action: passed ? 'allow' : violationAction,
      reason,
      details,
      durationMs: performance.now() - startTime,
      evaluatedAt: new Date().toISOString(),
    };
  }

  // =============================================================================
  // CONSTRAINT MANAGEMENT
  // =============================================================================

  /**
   * Add a constraint
   */
  addConstraint(constraint: Constraint | CompositeConstraint): void {
    this.constraints.set(constraint.id, constraint);
    logger.info({ constraintId: constraint.id, constraintName: constraint.name }, 'Constraint added');
  }

  /**
   * Remove a constraint
   */
  removeConstraint(constraintId: ID): boolean {
    const removed = this.constraints.delete(constraintId);
    if (removed) {
      logger.info({ constraintId }, 'Constraint removed');
    }
    return removed;
  }

  /**
   * Get a constraint by ID
   */
  getConstraint(constraintId: ID): Constraint | CompositeConstraint | undefined {
    return this.constraints.get(constraintId);
  }

  /**
   * Get all constraints
   */
  getAllConstraints(): Array<Constraint | CompositeConstraint> {
    return Array.from(this.constraints.values());
  }

  /**
   * Get enabled constraints
   */
  getEnabledConstraints(): Array<Constraint | CompositeConstraint> {
    return Array.from(this.constraints.values()).filter(c => c.enabled);
  }

  /**
   * Register custom evaluator
   */
  registerCustomEvaluator(
    name: string,
    evaluator: (constraint: CustomConstraint, context: ConstraintEvaluationContext) => Promise<boolean>
  ): void {
    this.customEvaluators.set(name, evaluator);
    logger.info({ name }, 'Custom evaluator registered');
  }

  /**
   * Set state provider
   */
  setStateProvider(provider: StateProvider): void {
    this.stateProvider = provider;
    logger.info('State provider updated');
  }

  /**
   * Clear all constraints
   */
  clear(): void {
    this.constraints.clear();
    logger.info('Constraint evaluator cleared');
  }

  /**
   * Get evaluator statistics
   */
  getStats(): {
    totalConstraints: number;
    enabledConstraints: number;
    byType: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    let enabled = 0;

    for (const constraint of this.constraints.values()) {
      if (constraint.enabled) enabled++;
      const type = 'type' in constraint ? constraint.type : 'composite';
      byType[type] = (byType[type] ?? 0) + 1;
    }

    return {
      totalConstraints: this.constraints.size,
      enabledConstraints: enabled,
      byType,
    };
  }
}

/**
 * Create a new constraint evaluator instance
 */
export function createConstraintEvaluator(
  stateProvider?: StateProvider,
  options?: ConstraintEvaluatorOptions
): ConstraintEvaluator {
  return new ConstraintEvaluator(stateProvider, options);
}

/**
 * Create a rate limit constraint
 */
export function createRateLimitConstraint(
  id: ID,
  name: string,
  limit: number,
  windowMs: number,
  keyBy: string | string[],
  options?: Partial<RateLimitConstraint>
): RateLimitConstraint {
  return {
    id,
    name,
    type: 'rate-limit',
    enabled: true,
    violationAction: 'deny',
    priority: 100,
    config: {
      limit,
      windowMs,
      keyBy,
      ...options?.config,
    },
    ...options,
  };
}

/**
 * Create a time window constraint
 */
export function createTimeWindowConstraint(
  id: ID,
  name: string,
  options?: Partial<TimeWindowConstraint>
): TimeWindowConstraint {
  return {
    id,
    name,
    type: 'time-window',
    enabled: true,
    violationAction: 'deny',
    priority: 100,
    config: {
      ...options?.config,
    },
    ...options,
  };
}

/**
 * Create a resource cap constraint
 */
export function createResourceCapConstraint(
  id: ID,
  name: string,
  resourceId: string,
  options?: Partial<ResourceCapConstraint>
): ResourceCapConstraint {
  return {
    id,
    name,
    type: 'resource-cap',
    enabled: true,
    violationAction: 'deny',
    priority: 100,
    config: {
      resourceId,
      usageKey: resourceId,
      ...options?.config,
    },
    ...options,
  };
}

/**
 * Create a dependency constraint
 */
export function createDependencyConstraint(
  id: ID,
  name: string,
  options?: Partial<DependencyConstraint>
): DependencyConstraint {
  return {
    id,
    name,
    type: 'dependency',
    enabled: true,
    violationAction: 'deny',
    priority: 100,
    config: {
      relationship: 'all',
      ...options?.config,
    },
    ...options,
  };
}

/**
 * Create a composite constraint
 */
export function createCompositeConstraint(
  id: ID,
  name: string,
  logic: CompositeLogic,
  constraints: (Constraint | CompositeConstraint)[],
  options?: Partial<CompositeConstraint>
): CompositeConstraint {
  return {
    id,
    name,
    logic,
    constraints,
    enabled: true,
    violationAction: 'deny',
    ...options,
  };
}
