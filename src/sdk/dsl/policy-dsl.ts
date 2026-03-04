/**
 * Vorion Security SDK - Policy DSL
 * Fluent API for policy definition
 */

import {
  PolicyDefinition,
  PolicyCondition,
  PolicyRequirement,
  PolicyAction,
  PolicyOutcome,
  EvaluationContext,
} from '../types';

// ============================================================================
// Field Builders
// ============================================================================

/**
 * Field condition builder for creating type-safe conditions
 */
export class FieldCondition<T = unknown> {
  constructor(private fieldPath: string) {}

  /**
   * Check if field equals a value
   */
  equals(value: T): ConditionExpression {
    return new ConditionExpression({
      type: 'equals',
      field: this.fieldPath,
      value,
    });
  }

  /**
   * Check if field does not equal a value
   */
  notEquals(value: T): ConditionExpression {
    return new ConditionExpression({
      type: 'notEquals',
      field: this.fieldPath,
      value,
    });
  }

  /**
   * Check if field contains a value (for arrays/strings)
   */
  contains(value: unknown): ConditionExpression {
    return new ConditionExpression({
      type: 'contains',
      field: this.fieldPath,
      value,
    });
  }

  /**
   * Check if field is in a list of values
   */
  in(values: T[]): ConditionExpression {
    return new ConditionExpression({
      type: 'contains',
      field: this.fieldPath,
      value: values,
    });
  }

  /**
   * Check if field matches a regex pattern
   */
  matches(pattern: string | RegExp): ConditionExpression {
    return new ConditionExpression({
      type: 'matches',
      field: this.fieldPath,
      value: pattern instanceof RegExp ? pattern.source : pattern,
    });
  }

  /**
   * Check if IP/value is in a CIDR range
   */
  inRange(range: string): ConditionExpression {
    return new ConditionExpression({
      type: 'inRange',
      field: this.fieldPath,
      value: range,
    });
  }

  /**
   * Check if value exists (is not null/undefined)
   */
  exists(): ConditionExpression {
    return new ConditionExpression({
      type: 'custom',
      field: this.fieldPath,
      value: { check: 'exists' },
    });
  }

  /**
   * Check if value is truthy
   */
  isTrue(): ConditionExpression {
    return new ConditionExpression({
      type: 'equals',
      field: this.fieldPath,
      value: true,
    });
  }

  /**
   * Check if value is falsy
   */
  isFalse(): ConditionExpression {
    return new ConditionExpression({
      type: 'equals',
      field: this.fieldPath,
      value: false,
    });
  }
}

/**
 * Time field with special time-based operations
 */
export class TimeField {
  /**
   * Check if current time is between two times
   */
  between(start: string, end: string, timezone?: string): ConditionExpression {
    return new ConditionExpression({
      type: 'between',
      field: 'time.current',
      value: { start, end, timezone },
    });
  }

  /**
   * Check if current time is within business hours
   */
  isBusinessHours(timezone?: string): ConditionExpression {
    return this.between('09:00', '17:00', timezone);
  }

  /**
   * Check if current day is a weekday
   */
  isWeekday(): ConditionExpression {
    return new ConditionExpression({
      type: 'custom',
      field: 'time.dayOfWeek',
      value: { check: 'weekday', days: [1, 2, 3, 4, 5] },
    });
  }

  /**
   * Check if current day is a weekend
   */
  isWeekend(): ConditionExpression {
    return new ConditionExpression({
      type: 'custom',
      field: 'time.dayOfWeek',
      value: { check: 'weekend', days: [0, 6] },
    });
  }

  /**
   * Access hour field
   */
  get hour(): FieldCondition<number> {
    return new FieldCondition('time.hour');
  }

  /**
   * Access day of week field
   */
  get dayOfWeek(): FieldCondition<number> {
    return new FieldCondition('time.dayOfWeek');
  }
}

// ============================================================================
// Context Proxies
// ============================================================================

/**
 * User context proxy for fluent access
 */
export const user = {
  id: new FieldCondition<string>('user.id'),
  email: new FieldCondition<string>('user.email'),
  role: new FieldCondition<string>('user.role'),
  roles: new FieldCondition<string[]>('user.roles'),
  permissions: new FieldCondition<string[]>('user.permissions'),
  groups: new FieldCondition<string[]>('user.groups'),
  mfaVerified: new FieldCondition<boolean>('user.mfaVerified'),
  authMethod: new FieldCondition<string>('user.authMethod'),
  attr: (name: string) => new FieldCondition(`user.attributes.${name}`),
};

/**
 * Request context proxy for fluent access
 */
export const request = {
  ip: new FieldCondition<string>('request.ip'),
  userAgent: new FieldCondition<string>('request.userAgent'),
  method: new FieldCondition<string>('request.method'),
  path: new FieldCondition<string>('request.path'),
  geo: {
    country: new FieldCondition<string>('request.geo.country'),
    region: new FieldCondition<string>('request.geo.region'),
    city: new FieldCondition<string>('request.geo.city'),
  },
  header: (name: string) => new FieldCondition(`request.headers.${name}`),
  query: (name: string) => new FieldCondition(`request.query.${name}`),
};

/**
 * Time context
 */
export const time = new TimeField();

/**
 * Resource context proxy
 */
export const resource = {
  type: new FieldCondition<string>('resource.type'),
  id: new FieldCondition<string>('resource.id'),
  owner: new FieldCondition<string>('resource.owner'),
  attr: (name: string) => new FieldCondition(`resource.attributes.${name}`),
};

/**
 * Environment context proxy
 */
export const env = {
  get: (name: string) => new FieldCondition(`environment.${name}`),
};

// ============================================================================
// Condition Expression
// ============================================================================

export class ConditionExpression {
  constructor(public readonly condition: PolicyCondition) {}

  /**
   * Combine with AND operator
   */
  and(other: ConditionExpression): CombinedCondition {
    return new CombinedCondition([this.condition, other.condition], 'and');
  }

  /**
   * Combine with OR operator
   */
  or(other: ConditionExpression): CombinedCondition {
    return new CombinedCondition([this.condition, other.condition], 'or');
  }
}

export class CombinedCondition {
  constructor(
    public readonly conditions: PolicyCondition[],
    public readonly operator: 'and' | 'or'
  ) {}

  /**
   * Add another condition with AND
   */
  and(other: ConditionExpression | CombinedCondition): CombinedCondition {
    if (other instanceof ConditionExpression) {
      return new CombinedCondition(
        [...this.conditions, { ...other.condition, operator: 'and' }],
        this.operator
      );
    }
    return new CombinedCondition(
      [...this.conditions, ...other.conditions.map((c) => ({ ...c, operator: 'and' as const }))],
      this.operator
    );
  }

  /**
   * Add another condition with OR
   */
  or(other: ConditionExpression | CombinedCondition): CombinedCondition {
    if (other instanceof ConditionExpression) {
      return new CombinedCondition(
        [...this.conditions, { ...other.condition, operator: 'or' }],
        'or'
      );
    }
    return new CombinedCondition(
      [...this.conditions, ...other.conditions.map((c) => ({ ...c, operator: 'or' as const }))],
      'or'
    );
  }
}

// ============================================================================
// Requirement Builders
// ============================================================================

/**
 * MFA requirement builder
 */
export const mfa = {
  /**
   * Require MFA verification
   */
  verified(): RequirementBuilder {
    return new RequirementBuilder({
      type: 'mfa',
      config: { verified: true },
    });
  },

  /**
   * Require specific MFA method
   */
  method(method: 'totp' | 'sms' | 'email' | 'webauthn'): RequirementBuilder {
    return new RequirementBuilder({
      type: 'mfa',
      config: { method },
    });
  },
};

/**
 * Approval requirement builder
 */
export const approval = {
  /**
   * Require approval from specific approvers
   */
  from(approvers: string[]): RequirementBuilder {
    return new RequirementBuilder({
      type: 'approval',
      config: { approvers, minApprovals: 1 },
    });
  },

  /**
   * Require N-of-M approval
   */
  nOf(n: number, approvers: string[]): RequirementBuilder {
    return new RequirementBuilder({
      type: 'approval',
      config: { approvers, minApprovals: n },
    });
  },
};

/**
 * Permission requirement builder
 */
export const permission = {
  /**
   * Require specific permission
   */
  has(perm: string): RequirementBuilder {
    return new RequirementBuilder({
      type: 'permission',
      config: { permission: perm },
    });
  },

  /**
   * Require any of the permissions
   */
  anyOf(perms: string[]): RequirementBuilder {
    return new RequirementBuilder({
      type: 'permission',
      config: { permissions: perms, mode: 'any' },
    });
  },

  /**
   * Require all permissions
   */
  allOf(perms: string[]): RequirementBuilder {
    return new RequirementBuilder({
      type: 'permission',
      config: { permissions: perms, mode: 'all' },
    });
  },
};

export class RequirementBuilder {
  constructor(public readonly requirement: PolicyRequirement) {}

  /**
   * Set expiration for the requirement
   */
  expiresIn(duration: string): RequirementBuilder {
    return new RequirementBuilder({
      ...this.requirement,
      config: { ...this.requirement.config, expiresIn: duration },
    });
  }

  /**
   * Add notification channels
   */
  notify(channels: string[]): RequirementBuilder {
    return new RequirementBuilder({
      ...this.requirement,
      config: { ...this.requirement.config, notifyChannels: channels },
    });
  }
}

// ============================================================================
// Action Builders
// ============================================================================

/**
 * Allow action
 */
export function allow(metadata?: Record<string, unknown>): PolicyAction {
  return { type: 'allow', metadata };
}

/**
 * Deny action with optional message
 */
export function deny(message?: string, metadata?: Record<string, unknown>): PolicyAction {
  return { type: 'deny', message, metadata };
}

/**
 * Challenge action (require additional verification)
 */
export function challenge(message?: string, metadata?: Record<string, unknown>): PolicyAction {
  return { type: 'challenge', message, metadata };
}

/**
 * Audit action (allow but log)
 */
export function audit(message?: string, metadata?: Record<string, unknown>): PolicyAction {
  return { type: 'audit', message, metadata };
}

// ============================================================================
// Policy Builder
// ============================================================================

export class PolicyBuilder {
  private _id: string;
  private _name: string;
  private _description?: string;
  private _version: string = '1.0.0';
  private _conditions: PolicyCondition[] = [];
  private _requirements: PolicyRequirement[] = [];
  private _action: PolicyAction = allow();
  private _fallbackAction: PolicyAction = deny('Policy conditions not met');
  private _priority: number = 100;
  private _enabled: boolean = true;
  private _tags: string[] = [];

  private constructor(id: string) {
    this._id = id;
    this._name = id;
  }

  /**
   * Create a new policy builder
   */
  static create(id: string): PolicyBuilder {
    return new PolicyBuilder(id);
  }

  /**
   * Set policy name
   */
  name(name: string): PolicyBuilder {
    this._name = name;
    return this;
  }

  /**
   * Set policy description
   */
  description(description: string): PolicyBuilder {
    this._description = description;
    return this;
  }

  /**
   * Set policy version
   */
  version(version: string): PolicyBuilder {
    this._version = version;
    return this;
  }

  /**
   * Add initial condition
   */
  when(condition: ConditionExpression | CombinedCondition): PolicyBuilder {
    if (condition instanceof ConditionExpression) {
      this._conditions.push(condition.condition);
    } else {
      this._conditions.push(...condition.conditions);
    }
    return this;
  }

  /**
   * Add AND condition
   */
  and(condition: ConditionExpression | CombinedCondition): PolicyBuilder {
    if (condition instanceof ConditionExpression) {
      this._conditions.push({ ...condition.condition, operator: 'and' });
    } else {
      this._conditions.push(
        ...condition.conditions.map((c) => ({ ...c, operator: 'and' as const }))
      );
    }
    return this;
  }

  /**
   * Add OR condition
   */
  or(condition: ConditionExpression | CombinedCondition): PolicyBuilder {
    if (condition instanceof ConditionExpression) {
      this._conditions.push({ ...condition.condition, operator: 'or' });
    } else {
      this._conditions.push(
        ...condition.conditions.map((c) => ({ ...c, operator: 'or' as const }))
      );
    }
    return this;
  }

  /**
   * Add requirement
   */
  require(requirement: RequirementBuilder): PolicyBuilder {
    this._requirements.push(requirement.requirement);
    return this;
  }

  /**
   * Set success action
   */
  then(action: PolicyAction): PolicyBuilder {
    this._action = action;
    return this;
  }

  /**
   * Set fallback action
   */
  otherwise(action: PolicyAction): PolicyBuilder {
    this._fallbackAction = action;
    return this;
  }

  /**
   * Set policy priority (lower = higher priority)
   */
  priority(priority: number): PolicyBuilder {
    this._priority = priority;
    return this;
  }

  /**
   * Enable or disable the policy
   */
  enabled(enabled: boolean): PolicyBuilder {
    this._enabled = enabled;
    return this;
  }

  /**
   * Add tags to the policy
   */
  tags(...tags: string[]): PolicyBuilder {
    this._tags.push(...tags);
    return this;
  }

  /**
   * Build the policy definition
   */
  build(): PolicyDefinition {
    return {
      id: this._id,
      name: this._name,
      description: this._description,
      version: this._version,
      conditions: this._conditions,
      requirements: this._requirements,
      action: this._action,
      fallbackAction: this._fallbackAction,
      priority: this._priority,
      enabled: this._enabled,
      tags: this._tags,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Convert to JSON
   */
  toJSON(): string {
    return JSON.stringify(this.build(), null, 2);
  }
}

// Convenience alias
export const Policy = PolicyBuilder;

// ============================================================================
// Policy Evaluation
// ============================================================================

/**
 * Evaluate a policy against a context
 */
export async function evaluatePolicy(
  policy: PolicyDefinition,
  context: EvaluationContext
): Promise<{ outcome: PolicyOutcome; reason?: string }> {
  // Check if policy is enabled
  if (!policy.enabled) {
    return { outcome: 'allow', reason: 'Policy is disabled' };
  }

  // Evaluate all conditions
  const conditionsMet = evaluateConditions(policy.conditions, context);

  if (!conditionsMet) {
    return {
      outcome: policy.fallbackAction.type,
      reason: policy.fallbackAction.message,
    };
  }

  // Check requirements
  for (const requirement of policy.requirements) {
    const requirementMet = await evaluateRequirement(requirement, context);
    if (!requirementMet) {
      return {
        outcome: 'challenge',
        reason: `Requirement not met: ${requirement.type}`,
      };
    }
  }

  return {
    outcome: policy.action.type,
    reason: policy.action.message,
  };
}

function evaluateConditions(
  conditions: PolicyCondition[],
  context: EvaluationContext
): boolean {
  if (conditions.length === 0) return true;

  let result = evaluateSingleCondition(conditions[0], context);

  for (let i = 1; i < conditions.length; i++) {
    const condition = conditions[i];
    const conditionResult = evaluateSingleCondition(condition, context);

    if (condition.operator === 'or') {
      result = result || conditionResult;
    } else {
      result = result && conditionResult;
    }
  }

  return result;
}

function evaluateSingleCondition(
  condition: PolicyCondition,
  context: EvaluationContext
): boolean {
  const value = getFieldValue(condition.field, context);

  switch (condition.type) {
    case 'equals':
      return value === condition.value;

    case 'notEquals':
      return value !== condition.value;

    case 'contains':
      if (Array.isArray(value)) {
        if (Array.isArray(condition.value)) {
          return condition.value.some((v) => value.includes(v));
        }
        return value.includes(condition.value);
      }
      if (typeof value === 'string') {
        return value.includes(String(condition.value));
      }
      return false;

    case 'inRange':
      return isInCIDRRange(String(value), String(condition.value));

    case 'between':
      if (typeof condition.value === 'object' && condition.value !== null) {
        const { start, end } = condition.value as { start: string; end: string };
        return isTimeBetween(start, end);
      }
      return false;

    case 'matches':
      if (typeof value === 'string') {
        const regex = new RegExp(String(condition.value));
        return regex.test(value);
      }
      return false;

    case 'custom':
      // Custom conditions need to be handled by the policy engine
      return true;

    default:
      return false;
  }
}

function getFieldValue(path: string, context: EvaluationContext): unknown {
  const parts = path.split('.');
  let current: unknown = context;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function isInCIDRRange(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split('/');
  if (!bits) return ip === range;

  const mask = parseInt(bits, 10);
  const ipParts = ip.split('.').map(Number);
  const rangeParts = range.split('.').map(Number);

  const ipNum =
    (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
  const rangeNum =
    (rangeParts[0] << 24) |
    (rangeParts[1] << 16) |
    (rangeParts[2] << 8) |
    rangeParts[3];
  const maskNum = ~((1 << (32 - mask)) - 1);

  return (ipNum & maskNum) === (rangeNum & maskNum);
}

function isTimeBetween(start: string, end: string): boolean {
  const now = new Date();
  const [startHour, startMin] = start.split(':').map(Number);
  const [endHour, endMin] = end.split(':').map(Number);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

async function evaluateRequirement(
  requirement: PolicyRequirement,
  context: EvaluationContext
): Promise<boolean> {
  switch (requirement.type) {
    case 'mfa':
      return context.user.mfaVerified === true;

    case 'permission':
      const reqPerm = requirement.config.permission as string;
      return context.user.permissions?.includes(reqPerm) ?? false;

    case 'approval':
      // Approval requirements are handled externally
      return true;

    default:
      return true;
  }
}

// Classes are exported inline with their definitions above
