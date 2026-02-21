/**
 * Condition Evaluator
 *
 * Evaluates policy conditions against the policy context.
 * Supports all condition types: user, request, time, risk, resource, composite, custom.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import type {
  PolicyCondition,
  PolicyContext,
  ConditionEvaluationResult,
  UserAttributeCondition,
  RequestAttributeCondition,
  TimeBasedCondition,
  RiskBasedCondition,
  ResourceAttributeCondition,
  CompositeCondition,
  CustomCondition,
  ConditionOperator,
  LogicalOperator,
} from './types.js';

const logger = createLogger({ component: 'condition-evaluator' });

/**
 * Custom expression evaluator function type
 */
export type CustomExpressionEvaluator = (
  expression: string,
  language: string,
  context: PolicyContext,
  params?: Record<string, unknown>
) => boolean;

/**
 * Condition evaluator options
 */
export interface ConditionEvaluatorOptions {
  /** Custom expression evaluators */
  customEvaluators?: Map<string, CustomExpressionEvaluator>;
  /** Default timezone for time-based conditions */
  defaultTimezone?: string;
  /** Holiday calendar provider */
  holidayCalendarProvider?: (calendarId: string, date: Date) => boolean;
}

/**
 * ConditionEvaluator class
 */
export class ConditionEvaluator {
  private customEvaluators: Map<string, CustomExpressionEvaluator>;
  private defaultTimezone: string;
  private holidayCalendarProvider?: (calendarId: string, date: Date) => boolean;

  constructor(options: ConditionEvaluatorOptions = {}) {
    this.customEvaluators = options.customEvaluators ?? new Map();
    this.defaultTimezone = options.defaultTimezone ?? 'UTC';
    this.holidayCalendarProvider = options.holidayCalendarProvider;
  }

  /**
   * Evaluate a condition against the context
   */
  evaluate(condition: PolicyCondition, context: PolicyContext): ConditionEvaluationResult {
    try {
      switch (condition.type) {
        case 'user_attribute':
          return this.evaluateUserAttribute(condition, context);
        case 'request_attribute':
          return this.evaluateRequestAttribute(condition, context);
        case 'time_based':
          return this.evaluateTimeBased(condition, context);
        case 'risk_based':
          return this.evaluateRiskBased(condition, context);
        case 'resource_attribute':
          return this.evaluateResourceAttribute(condition, context);
        case 'composite':
          return this.evaluateComposite(condition, context);
        case 'custom':
          return this.evaluateCustom(condition, context);
        default:
          return {
            conditionType: 'custom',
            matched: false,
            error: `Unknown condition type: ${(condition as PolicyCondition).type}`,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.warn({ condition, error: message }, 'Condition evaluation failed');
      return {
        conditionType: condition.type,
        matched: false,
        error: message,
      };
    }
  }

  /**
   * Evaluate all conditions and return combined result
   */
  evaluateAll(
    conditions: PolicyCondition[],
    context: PolicyContext,
    logic: LogicalOperator = 'and'
  ): { matched: boolean; results: ConditionEvaluationResult[] } {
    const results: ConditionEvaluationResult[] = [];

    for (const condition of conditions) {
      const result = this.evaluate(condition, context);
      results.push(result);

      // Short-circuit for OR (if any matches)
      if (logic === 'or' && result.matched) {
        return { matched: true, results };
      }

      // Short-circuit for AND (if any fails)
      if (logic === 'and' && !result.matched) {
        return { matched: false, results };
      }
    }

    // Final result based on logic
    const matched = logic === 'and'
      ? results.every(r => r.matched)
      : logic === 'or'
        ? results.some(r => r.matched)
        : !results[0]?.matched; // NOT

    return { matched, results };
  }

  /**
   * Evaluate user attribute condition
   */
  private evaluateUserAttribute(
    condition: UserAttributeCondition,
    context: PolicyContext
  ): ConditionEvaluationResult {
    const user = context.user;
    if (!user) {
      return {
        conditionType: 'user_attribute',
        field: condition.field,
        operator: condition.operator,
        expected: condition.value,
        actual: undefined,
        matched: condition.operator === 'not_exists',
      };
    }

    let actual: unknown;

    switch (condition.field) {
      case 'role':
        actual = user.role;
        break;
      case 'department':
        actual = user.department;
        break;
      case 'tenant':
        actual = user.tenant;
        break;
      case 'groups':
        actual = user.groups;
        break;
      case 'permissions':
        actual = user.permissions;
        break;
      case 'email_domain':
        actual = user.email?.split('@')[1];
        break;
      case 'custom':
        actual = condition.customField
          ? this.getNestedValue(user.attributes, condition.customField)
          : undefined;
        break;
      default:
        actual = undefined;
    }

    const matched = this.compareValues(actual, condition.operator, condition.value);

    return {
      conditionType: 'user_attribute',
      field: condition.field,
      operator: condition.operator,
      expected: condition.value,
      actual,
      matched,
    };
  }

  /**
   * Evaluate request attribute condition
   */
  private evaluateRequestAttribute(
    condition: RequestAttributeCondition,
    context: PolicyContext
  ): ConditionEvaluationResult {
    const request = context.request;
    let actual: unknown;

    switch (condition.field) {
      case 'ip':
        actual = request.ip;
        break;
      case 'user_agent':
        actual = request.userAgent;
        break;
      case 'path':
        actual = request.path;
        break;
      case 'method':
        actual = request.method;
        break;
      case 'header':
        actual = condition.headerName
          ? request.headers?.[condition.headerName.toLowerCase()]
          : undefined;
        break;
      case 'query':
        actual = condition.queryParam
          ? request.query?.[condition.queryParam]
          : undefined;
        break;
      case 'body':
        actual = condition.bodyPath
          ? this.getNestedValue(request.body, condition.bodyPath)
          : request.body;
        break;
      case 'origin':
        actual = request.origin;
        break;
      case 'referer':
        actual = request.referer;
        break;
      case 'custom':
        actual = condition.customField
          ? this.getNestedValue(request, condition.customField)
          : undefined;
        break;
      default:
        actual = undefined;
    }

    const matched = this.compareValues(actual, condition.operator, condition.value);

    return {
      conditionType: 'request_attribute',
      field: condition.field,
      operator: condition.operator,
      expected: condition.value,
      actual,
      matched,
    };
  }

  /**
   * Evaluate time-based condition
   */
  private evaluateTimeBased(
    condition: TimeBasedCondition,
    context: PolicyContext
  ): ConditionEvaluationResult {
    const timezone = condition.timezone ?? context.environment?.timezone ?? this.defaultTimezone;
    const now = context.environment?.timestamp
      ? new Date(context.environment.timestamp)
      : new Date();

    let actual: unknown;
    let matched = false;

    switch (condition.field) {
      case 'hour': {
        const hour = this.getHourInTimezone(now, timezone);
        actual = hour;
        matched = this.compareValues(hour, condition.operator, condition.value);
        break;
      }
      case 'day_of_week': {
        const dayOfWeek = this.getDayOfWeekInTimezone(now, timezone);
        actual = dayOfWeek;
        matched = this.compareValues(dayOfWeek, condition.operator, condition.value);
        break;
      }
      case 'date': {
        const dateStr = this.getDateStringInTimezone(now, timezone);
        actual = dateStr;
        matched = this.compareValues(dateStr, condition.operator, condition.value);
        break;
      }
      case 'business_hours': {
        const startHour = condition.startHour ?? 9;
        const endHour = condition.endHour ?? 17;
        const daysOfWeek = condition.daysOfWeek ?? [1, 2, 3, 4, 5]; // Mon-Fri
        const hour = this.getHourInTimezone(now, timezone);
        const dayOfWeek = this.getDayOfWeekInTimezone(now, timezone);
        const isBusinessHours = daysOfWeek.includes(dayOfWeek) && hour >= startHour && hour < endHour;
        actual = isBusinessHours;
        matched = this.compareValues(isBusinessHours, condition.operator, condition.value);
        break;
      }
      case 'weekend': {
        const dayOfWeek = this.getDayOfWeekInTimezone(now, timezone);
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        actual = isWeekend;
        matched = this.compareValues(isWeekend, condition.operator, condition.value);
        break;
      }
      case 'holiday': {
        if (this.holidayCalendarProvider && condition.holidayCalendar) {
          const isHoliday = this.holidayCalendarProvider(condition.holidayCalendar, now);
          actual = isHoliday;
          matched = this.compareValues(isHoliday, condition.operator, condition.value);
        } else {
          actual = context.environment?.isHoliday ?? false;
          matched = this.compareValues(actual, condition.operator, condition.value);
        }
        break;
      }
      case 'custom': {
        actual = undefined;
        matched = false;
        break;
      }
    }

    return {
      conditionType: 'time_based',
      field: condition.field,
      operator: condition.operator,
      expected: condition.value,
      actual,
      matched,
    };
  }

  /**
   * Evaluate risk-based condition
   */
  private evaluateRiskBased(
    condition: RiskBasedCondition,
    context: PolicyContext
  ): ConditionEvaluationResult {
    const risk = context.risk;
    let actual: unknown;

    switch (condition.field) {
      case 'user_risk_score':
        actual = risk?.userRiskScore ?? context.user?.riskScore;
        break;
      case 'ip_reputation':
        actual = risk?.ipReputation;
        break;
      case 'device_trust':
        actual = risk?.deviceTrust;
        break;
      case 'session_risk':
        actual = risk?.sessionRisk;
        break;
      case 'anomaly_score':
        actual = risk?.anomalyScore;
        break;
      case 'threat_level':
        actual = risk?.threatLevel;
        break;
      case 'custom':
        actual = condition.customField
          ? this.getNestedValue(risk, condition.customField)
          : undefined;
        break;
      default:
        actual = undefined;
    }

    const matched = this.compareValues(actual, condition.operator, condition.value);

    return {
      conditionType: 'risk_based',
      field: condition.field,
      operator: condition.operator,
      expected: condition.value,
      actual,
      matched,
    };
  }

  /**
   * Evaluate resource attribute condition
   */
  private evaluateResourceAttribute(
    condition: ResourceAttributeCondition,
    context: PolicyContext
  ): ConditionEvaluationResult {
    const resource = context.resource;
    if (!resource) {
      return {
        conditionType: 'resource_attribute',
        field: condition.field,
        operator: condition.operator,
        expected: condition.value,
        actual: undefined,
        matched: condition.operator === 'not_exists',
      };
    }

    let actual: unknown;

    switch (condition.field) {
      case 'sensitivity_level':
        actual = resource.sensitivityLevel;
        break;
      case 'data_type':
        actual = resource.dataType;
        break;
      case 'classification':
        actual = resource.classification;
        break;
      case 'owner':
        actual = resource.owner;
        break;
      case 'department':
        actual = resource.department;
        break;
      case 'region':
        actual = resource.region;
        break;
      case 'tags':
        actual = resource.tags;
        break;
      case 'custom':
        actual = condition.customField
          ? this.getNestedValue(resource.attributes, condition.customField)
          : undefined;
        break;
      default:
        actual = undefined;
    }

    const matched = this.compareValues(actual, condition.operator, condition.value);

    return {
      conditionType: 'resource_attribute',
      field: condition.field,
      operator: condition.operator,
      expected: condition.value,
      actual,
      matched,
    };
  }

  /**
   * Evaluate composite condition
   */
  private evaluateComposite(
    condition: CompositeCondition,
    context: PolicyContext
  ): ConditionEvaluationResult {
    const results: ConditionEvaluationResult[] = [];

    for (const subCondition of condition.conditions) {
      const result = this.evaluate(subCondition, context);
      results.push(result);

      // Short-circuit for OR
      if (condition.operator === 'or' && result.matched) {
        return {
          conditionType: 'composite',
          operator: condition.operator,
          matched: true,
        };
      }

      // Short-circuit for AND
      if (condition.operator === 'and' && !result.matched) {
        return {
          conditionType: 'composite',
          operator: condition.operator,
          matched: false,
        };
      }
    }

    let matched: boolean;

    switch (condition.operator) {
      case 'and':
        matched = results.every(r => r.matched);
        break;
      case 'or':
        matched = results.some(r => r.matched);
        break;
      case 'not':
        matched = results.length > 0 ? !results[0]!.matched : true;
        break;
      default:
        matched = false;
    }

    return {
      conditionType: 'composite',
      operator: condition.operator,
      matched,
    };
  }

  /**
   * Evaluate custom condition
   */
  private evaluateCustom(
    condition: CustomCondition,
    context: PolicyContext
  ): ConditionEvaluationResult {
    const language = condition.language ?? 'custom';
    const evaluator = this.customEvaluators.get(language);

    if (!evaluator) {
      return {
        conditionType: 'custom',
        matched: false,
        error: `No evaluator registered for language: ${language}`,
      };
    }

    try {
      const matched = evaluator(condition.expression, language, context, condition.params);
      return {
        conditionType: 'custom',
        matched,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        conditionType: 'custom',
        matched: false,
        error: message,
      };
    }
  }

  /**
   * Compare values using the specified operator
   */
  private compareValues(actual: unknown, operator: ConditionOperator, expected: unknown): boolean {
    switch (operator) {
      case 'equals':
        return this.equals(actual, expected);
      case 'not_equals':
        return !this.equals(actual, expected);
      case 'greater_than':
        return this.isNumber(actual) && this.isNumber(expected) && actual > expected;
      case 'less_than':
        return this.isNumber(actual) && this.isNumber(expected) && actual < expected;
      case 'greater_than_or_equal':
        return this.isNumber(actual) && this.isNumber(expected) && actual >= expected;
      case 'less_than_or_equal':
        return this.isNumber(actual) && this.isNumber(expected) && actual <= expected;
      case 'in':
        return this.isIn(actual, expected);
      case 'not_in':
        return !this.isIn(actual, expected);
      case 'contains':
        return this.contains(actual, expected);
      case 'not_contains':
        return !this.contains(actual, expected);
      case 'starts_with':
        return typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected);
      case 'ends_with':
        return typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected);
      case 'matches':
        return this.matchesPattern(actual, expected);
      case 'exists':
        return actual !== undefined && actual !== null;
      case 'not_exists':
        return actual === undefined || actual === null;
      case 'between':
        return this.isBetween(actual, expected);
      default:
        return false;
    }
  }

  /**
   * Check equality (deep for objects)
   */
  private equals(actual: unknown, expected: unknown): boolean {
    if (actual === expected) return true;
    if (typeof actual !== typeof expected) return false;

    if (Array.isArray(actual) && Array.isArray(expected)) {
      if (actual.length !== expected.length) return false;
      return actual.every((v, i) => this.equals(v, expected[i]));
    }

    if (typeof actual === 'object' && actual !== null && expected !== null) {
      const actualKeys = Object.keys(actual as Record<string, unknown>);
      const expectedKeys = Object.keys(expected as Record<string, unknown>);
      if (actualKeys.length !== expectedKeys.length) return false;
      return actualKeys.every(k =>
        this.equals(
          (actual as Record<string, unknown>)[k],
          (expected as Record<string, unknown>)[k]
        )
      );
    }

    return false;
  }

  /**
   * Check if value is in array
   */
  private isIn(actual: unknown, expected: unknown): boolean {
    if (!Array.isArray(expected)) return false;
    return expected.some(e => this.equals(actual, e));
  }

  /**
   * Check if value contains another value
   */
  private contains(actual: unknown, expected: unknown): boolean {
    if (typeof actual === 'string' && typeof expected === 'string') {
      return actual.includes(expected);
    }
    if (Array.isArray(actual)) {
      return actual.some(a => this.equals(a, expected));
    }
    return false;
  }

  /**
   * Check if value matches pattern
   */
  private matchesPattern(actual: unknown, pattern: unknown): boolean {
    if (typeof actual !== 'string' || typeof pattern !== 'string') return false;
    try {
      const regex = new RegExp(pattern);
      return regex.test(actual);
    } catch {
      return false;
    }
  }

  /**
   * Check if value is between range
   */
  private isBetween(actual: unknown, expected: unknown): boolean {
    if (!this.isNumber(actual)) return false;
    if (!Array.isArray(expected) || expected.length !== 2) return false;
    const [min, max] = expected;
    if (!this.isNumber(min) || !this.isNumber(max)) return false;
    return actual >= min && actual <= max;
  }

  /**
   * Type guard for numbers
   */
  private isNumber(value: unknown): value is number {
    return typeof value === 'number' && !isNaN(value);
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: unknown, path: string): unknown {
    if (obj === null || obj === undefined) return undefined;

    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Get hour in specified timezone
   */
  private getHourInTimezone(date: Date, timezone: string): number {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: timezone,
      });
      const hourStr = formatter.format(date);
      return parseInt(hourStr, 10);
    } catch {
      return date.getUTCHours();
    }
  }

  /**
   * Get day of week in specified timezone (0 = Sunday)
   */
  private getDayOfWeekInTimezone(date: Date, timezone: string): number {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        timeZone: timezone,
      });
      const dayStr = formatter.format(date);
      const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      return days[dayStr] ?? date.getUTCDay();
    } catch {
      return date.getUTCDay();
    }
  }

  /**
   * Get date string in specified timezone
   */
  private getDateStringInTimezone(date: Date, timezone: string): string {
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: timezone,
      });
      return formatter.format(date);
    } catch {
      return date.toISOString().split('T')[0]!;
    }
  }

  /**
   * Register a custom expression evaluator
   */
  registerCustomEvaluator(language: string, evaluator: CustomExpressionEvaluator): void {
    this.customEvaluators.set(language, evaluator);
  }

  /**
   * Unregister a custom expression evaluator
   */
  unregisterCustomEvaluator(language: string): boolean {
    return this.customEvaluators.delete(language);
  }
}

/**
 * Create a condition evaluator instance
 */
export function createConditionEvaluator(options?: ConditionEvaluatorOptions): ConditionEvaluator {
  return new ConditionEvaluator(options);
}
