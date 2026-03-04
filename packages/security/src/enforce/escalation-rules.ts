/**
 * Escalation Rules Engine
 *
 * Automatic escalation based on risk score, action type, and resource sensitivity.
 * Supports escalation routing and notification management.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import { withSpan, type TraceSpan } from '../common/trace.js';
import { secureRandomString } from '../common/random.js';
import type {
  Intent,
  ControlAction,
  ID,
  Timestamp,
  TrustLevel,
  TrustScore,
  EscalationRequest,
} from '../common/types.js';

const logger = createLogger({ component: 'escalation-rules' });

// =============================================================================
// ESCALATION TYPES
// =============================================================================

/**
 * Risk score thresholds
 */
export interface RiskThresholds {
  /** Low risk threshold */
  low: number;
  /** Medium risk threshold */
  medium: number;
  /** High risk threshold */
  high: number;
  /** Critical risk threshold */
  critical: number;
}

/**
 * Default risk thresholds
 */
export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  low: 200,
  medium: 400,
  high: 600,
  critical: 800,
};

/**
 * Risk level classification
 */
export type RiskLevel = 'minimal' | 'low' | 'medium' | 'high' | 'critical';

/**
 * Resource sensitivity levels
 */
export type ResourceSensitivity = 'public' | 'internal' | 'confidential' | 'restricted' | 'top-secret';

/**
 * Escalation target definition
 */
export interface EscalationTarget {
  /** Target identifier (user, role, group, or channel) */
  id: ID;
  /** Target type */
  type: 'user' | 'role' | 'group' | 'channel' | 'webhook';
  /** Target name */
  name: string;
  /** Notification channels */
  channels: NotificationChannel[];
  /** Whether target can approve/reject */
  canDecide: boolean;
  /** Priority for notification order */
  priority: number;
  /** Availability schedule */
  availability?: AvailabilitySchedule;
}

/**
 * Notification channel definition
 */
export interface NotificationChannel {
  /** Channel type */
  type: 'email' | 'slack' | 'teams' | 'webhook' | 'pagerduty' | 'sms';
  /** Channel-specific address/endpoint */
  address: string;
  /** Whether to use for urgent notifications */
  urgent?: boolean;
}

/**
 * Availability schedule for escalation targets
 */
export interface AvailabilitySchedule {
  /** Timezone */
  timezone: string;
  /** Available hours (HH:MM format) */
  availableHours?: {
    start: string;
    end: string;
  };
  /** Available days (0 = Sunday) */
  availableDays?: number[];
  /** Out of office periods */
  outOfOffice?: Array<{
    start: Timestamp;
    end: Timestamp;
    reason?: string;
    delegate?: ID;
  }>;
}

/**
 * Escalation rule definition
 */
export interface EscalationRule {
  /** Unique rule identifier */
  id: ID;
  /** Rule name */
  name: string;
  /** Rule description */
  description?: string;
  /** Whether rule is enabled */
  enabled: boolean;
  /** Rule priority (lower = higher priority) */
  priority: number;
  /** Conditions that trigger this rule */
  conditions: EscalationConditions;
  /** Escalation configuration */
  escalation: EscalationConfig;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Conditions that trigger escalation
 */
export interface EscalationConditions {
  /** Risk score threshold (escalate if above) */
  riskScoreThreshold?: number;
  /** Risk level (escalate if matches or higher) */
  riskLevel?: RiskLevel;
  /** Action types that trigger escalation */
  actionTypes?: string[];
  /** Resource patterns that trigger escalation */
  resourcePatterns?: string[];
  /** Resource sensitivity levels that trigger escalation */
  resourceSensitivity?: ResourceSensitivity[];
  /** Intent types that trigger escalation */
  intentTypes?: string[];
  /** Trust levels that trigger escalation (escalate if below) */
  trustLevelBelow?: TrustLevel;
  /** Entity types that trigger escalation */
  entityTypes?: string[];
  /** Custom condition expression */
  customExpression?: string;
}

/**
 * Escalation configuration
 */
export interface EscalationConfig {
  /** Primary escalation targets */
  targets: EscalationTarget[];
  /** Timeout before auto-action */
  timeout: string;
  /** Action to take on timeout */
  timeoutAction: 'deny' | 'allow' | 're-escalate';
  /** Whether justification is required */
  requireJustification: boolean;
  /** Required number of approvals */
  requiredApprovals: number;
  /** Maximum escalation chain depth */
  maxChainDepth: number;
  /** Reminder intervals */
  reminderIntervals?: string[];
  /** Re-escalation targets (if primary doesn't respond) */
  reEscalationTargets?: EscalationTarget[];
  /** Re-escalation delay */
  reEscalationDelay?: string;
}

/**
 * Escalation match result
 */
export interface EscalationMatchResult {
  /** Rule that matched */
  rule: EscalationRule;
  /** Whether rule matched */
  matched: boolean;
  /** Match reason */
  reason: string;
  /** Computed risk score */
  riskScore: number;
  /** Computed risk level */
  riskLevel: RiskLevel;
  /** Selected targets */
  selectedTargets: EscalationTarget[];
  /** Match details */
  details: Record<string, unknown>;
}

/**
 * Escalation request with full context
 */
export interface EscalationRequestFull extends EscalationRequest {
  /** Associated rule ID */
  ruleId: ID;
  /** Risk score */
  riskScore: number;
  /** Risk level */
  riskLevel: RiskLevel;
  /** Selected targets */
  targets: EscalationTarget[];
  /** Justification (if provided) */
  justification?: string;
  /** Approvals received */
  approvals: EscalationApproval[];
  /** Rejections received */
  rejections: EscalationRejection[];
  /** Reminder count */
  remindersSent: number;
  /** Chain depth */
  chainDepth: number;
}

/**
 * Escalation approval record
 */
export interface EscalationApproval {
  /** Approver ID */
  approverId: ID;
  /** Approver name */
  approverName: string;
  /** Approval timestamp */
  approvedAt: Timestamp;
  /** Comments */
  comments?: string;
  /** Any conditions on approval */
  conditions?: string[];
}

/**
 * Escalation rejection record
 */
export interface EscalationRejection {
  /** Rejecter ID */
  rejecterId: ID;
  /** Rejecter name */
  rejecterName: string;
  /** Rejection timestamp */
  rejectedAt: Timestamp;
  /** Reason for rejection */
  reason: string;
}

// =============================================================================
// ESCALATION CONTEXT
// =============================================================================

/**
 * Context for escalation evaluation
 */
export interface EscalationContext {
  /** The intent being evaluated */
  intent: Intent;
  /** Trust score */
  trustScore: TrustScore;
  /** Trust level */
  trustLevel: TrustLevel;
  /** Computed risk score */
  riskScore?: number;
  /** Resource sensitivity (if known) */
  resourceSensitivity?: ResourceSensitivity;
  /** Additional context */
  context?: Record<string, unknown>;
  /** Environment data */
  environment?: {
    timestamp: Timestamp;
    timezone: string;
  };
}

// =============================================================================
// ESCALATION ENGINE OPTIONS
// =============================================================================

/**
 * Escalation engine options
 */
export interface EscalationEngineOptions {
  /** Enable OpenTelemetry tracing */
  enableTracing?: boolean;
  /** Risk thresholds */
  riskThresholds?: RiskThresholds;
  /** Default timeout */
  defaultTimeout?: string;
  /** Default timeout action */
  defaultTimeoutAction?: 'deny' | 'allow' | 're-escalate';
  /** Notification handler */
  notificationHandler?: NotificationHandler;
}

/**
 * Notification handler interface
 */
export interface NotificationHandler {
  /** Send notification to target */
  notify(
    target: EscalationTarget,
    request: EscalationRequestFull,
    type: 'initial' | 'reminder' | 're-escalation'
  ): Promise<boolean>;
}

/**
 * Default notification handler (logs notifications)
 */
export class LoggingNotificationHandler implements NotificationHandler {
  async notify(
    target: EscalationTarget,
    request: EscalationRequestFull,
    type: 'initial' | 'reminder' | 're-escalation'
  ): Promise<boolean> {
    logger.info({
      targetId: target.id,
      targetName: target.name,
      intentId: request.intentId,
      type,
      riskLevel: request.riskLevel,
    }, 'Escalation notification (logged)');
    return true;
  }
}

// =============================================================================
// ESCALATION RULE ENGINE
// =============================================================================

/**
 * EscalationRuleEngine for automatic escalation management
 */
export class EscalationRuleEngine {
  private rules: Map<ID, EscalationRule> = new Map();
  private activeEscalations: Map<ID, EscalationRequestFull> = new Map();
  private options: Required<EscalationEngineOptions>;
  private notificationHandler: NotificationHandler;

  constructor(options: EscalationEngineOptions = {}) {
    this.options = {
      enableTracing: options.enableTracing ?? true,
      riskThresholds: options.riskThresholds ?? DEFAULT_RISK_THRESHOLDS,
      defaultTimeout: options.defaultTimeout ?? 'PT1H',
      defaultTimeoutAction: options.defaultTimeoutAction ?? 'deny',
      notificationHandler: options.notificationHandler ?? new LoggingNotificationHandler(),
    };
    this.notificationHandler = this.options.notificationHandler;

    logger.info({
      enableTracing: this.options.enableTracing,
      defaultTimeout: this.options.defaultTimeout,
      defaultTimeoutAction: this.options.defaultTimeoutAction,
    }, 'Escalation rule engine initialized');
  }

  /**
   * Evaluate whether escalation is needed
   */
  evaluate(context: EscalationContext): EscalationMatchResult | null {
    const startTime = performance.now();

    // Compute risk score if not provided
    const riskScore = context.riskScore ?? this.computeRiskScore(context);
    const riskLevel = this.classifyRiskLevel(riskScore);

    // Get applicable rules sorted by priority
    const sortedRules = Array.from(this.rules.values())
      .filter(r => r.enabled)
      .sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
      const matchResult = this.evaluateRule(rule, context, riskScore, riskLevel);
      if (matchResult.matched) {
        const durationMs = performance.now() - startTime;
        logger.info({
          ruleId: rule.id,
          ruleName: rule.name,
          intentId: context.intent.id,
          riskScore,
          riskLevel,
          durationMs,
        }, 'Escalation rule matched');
        return matchResult;
      }
    }

    logger.debug({
      intentId: context.intent.id,
      riskScore,
      riskLevel,
      rulesEvaluated: sortedRules.length,
    }, 'No escalation rule matched');

    return null;
  }

  /**
   * Evaluate with OpenTelemetry tracing
   */
  async evaluateWithTracing(context: EscalationContext): Promise<EscalationMatchResult | null> {
    if (!this.options.enableTracing) {
      return this.evaluate(context);
    }

    return withSpan(
      'enforce.evaluateEscalation',
      async (span: TraceSpan) => {
        span.attributes['intent.id'] = context.intent.id;
        span.attributes['trust.level'] = context.trustLevel;
        span.attributes['trust.score'] = context.trustScore;

        const result = this.evaluate(context);

        if (result) {
          span.attributes['escalation.matched'] = true;
          span.attributes['escalation.ruleId'] = result.rule.id;
          span.attributes['escalation.riskLevel'] = result.riskLevel;
        } else {
          span.attributes['escalation.matched'] = false;
        }

        return result;
      },
      { 'tenant.id': context.intent.tenantId }
    );
  }

  /**
   * Create an escalation request from match result
   */
  async createEscalation(
    context: EscalationContext,
    matchResult: EscalationMatchResult
  ): Promise<EscalationRequestFull> {
    const now = new Date().toISOString();
    const escalationId = `esc-${Date.now()}-${secureRandomString(9)}`;

    // Select available targets
    const selectedTargets = this.selectAvailableTargets(
      matchResult.rule.escalation.targets,
      context.environment?.timestamp
    );

    const request: EscalationRequestFull = {
      id: escalationId,
      intentId: context.intent.id,
      reason: matchResult.reason,
      escalatedTo: selectedTargets.map(t => t.name).join(', '),
      timeout: matchResult.rule.escalation.timeout,
      status: 'pending',
      createdAt: now,
      ruleId: matchResult.rule.id,
      riskScore: matchResult.riskScore,
      riskLevel: matchResult.riskLevel,
      targets: selectedTargets,
      approvals: [],
      rejections: [],
      remindersSent: 0,
      chainDepth: 0,
    };

    this.activeEscalations.set(escalationId, request);

    // Send notifications
    await this.sendNotifications(request, 'initial');

    logger.info({
      escalationId,
      intentId: context.intent.id,
      targets: selectedTargets.map(t => t.id),
      riskLevel: matchResult.riskLevel,
    }, 'Escalation created');

    return request;
  }

  /**
   * Process an approval
   */
  processApproval(
    escalationId: ID,
    approval: Omit<EscalationApproval, 'approvedAt'>
  ): EscalationRequestFull | null {
    const request = this.activeEscalations.get(escalationId);
    if (!request) {
      logger.warn({ escalationId }, 'Escalation not found');
      return null;
    }

    if (request.status !== 'pending') {
      logger.warn({ escalationId, status: request.status }, 'Escalation not pending');
      return null;
    }

    request.approvals.push({
      ...approval,
      approvedAt: new Date().toISOString(),
    });

    const rule = this.rules.get(request.ruleId);
    const requiredApprovals = rule?.escalation.requiredApprovals ?? 1;

    if (request.approvals.length >= requiredApprovals) {
      request.status = 'approved';
      logger.info({
        escalationId,
        approvals: request.approvals.length,
        required: requiredApprovals,
      }, 'Escalation approved');
    }

    return request;
  }

  /**
   * Process a rejection
   */
  processRejection(
    escalationId: ID,
    rejection: Omit<EscalationRejection, 'rejectedAt'>
  ): EscalationRequestFull | null {
    const request = this.activeEscalations.get(escalationId);
    if (!request) {
      logger.warn({ escalationId }, 'Escalation not found');
      return null;
    }

    if (request.status !== 'pending') {
      logger.warn({ escalationId, status: request.status }, 'Escalation not pending');
      return null;
    }

    request.rejections.push({
      ...rejection,
      rejectedAt: new Date().toISOString(),
    });

    request.status = 'rejected';

    logger.info({
      escalationId,
      reason: rejection.reason,
    }, 'Escalation rejected');

    return request;
  }

  /**
   * Process timeout
   */
  processTimeout(escalationId: ID): { request: EscalationRequestFull; action: ControlAction } | null {
    const request = this.activeEscalations.get(escalationId);
    if (!request) {
      return null;
    }

    if (request.status !== 'pending') {
      return null;
    }

    const rule = this.rules.get(request.ruleId);
    const timeoutAction = rule?.escalation.timeoutAction ?? this.options.defaultTimeoutAction;

    if (timeoutAction === 're-escalate') {
      // Handle re-escalation
      if (rule?.escalation.reEscalationTargets && request.chainDepth < (rule.escalation.maxChainDepth ?? 3)) {
        request.targets = this.selectAvailableTargets(rule.escalation.reEscalationTargets);
        request.chainDepth++;
        request.remindersSent = 0;
        this.sendNotifications(request, 're-escalation');
        logger.info({ escalationId, chainDepth: request.chainDepth }, 'Escalation re-escalated');
        return { request, action: 'escalate' };
      }
      // Fall back to deny if can't re-escalate
      request.status = 'timeout';
      return { request, action: 'deny' };
    }

    request.status = 'timeout';
    const action: ControlAction = timeoutAction === 'allow' ? 'allow' : 'deny';

    logger.info({
      escalationId,
      action,
    }, 'Escalation timeout');

    return { request, action };
  }

  /**
   * Send reminder
   */
  async sendReminder(escalationId: ID): Promise<boolean> {
    const request = this.activeEscalations.get(escalationId);
    if (!request || request.status !== 'pending') {
      return false;
    }

    request.remindersSent++;
    await this.sendNotifications(request, 'reminder');

    logger.info({
      escalationId,
      reminderCount: request.remindersSent,
    }, 'Escalation reminder sent');

    return true;
  }

  /**
   * Evaluate a single rule
   */
  private evaluateRule(
    rule: EscalationRule,
    context: EscalationContext,
    riskScore: number,
    riskLevel: RiskLevel
  ): EscalationMatchResult {
    const conditions = rule.conditions;
    const details: Record<string, unknown> = {};
    let matched = true;
    const reasons: string[] = [];

    // Check risk score threshold
    if (conditions.riskScoreThreshold !== undefined) {
      if (riskScore < conditions.riskScoreThreshold) {
        matched = false;
      } else {
        reasons.push(`Risk score ${riskScore} >= threshold ${conditions.riskScoreThreshold}`);
      }
      details.riskScoreThreshold = conditions.riskScoreThreshold;
    }

    // Check risk level
    if (matched && conditions.riskLevel) {
      const levelOrder: RiskLevel[] = ['minimal', 'low', 'medium', 'high', 'critical'];
      const requiredIndex = levelOrder.indexOf(conditions.riskLevel);
      const actualIndex = levelOrder.indexOf(riskLevel);
      if (actualIndex < requiredIndex) {
        matched = false;
      } else {
        reasons.push(`Risk level ${riskLevel} >= required ${conditions.riskLevel}`);
      }
      details.riskLevelCondition = conditions.riskLevel;
    }

    // Check action types
    if (matched && conditions.actionTypes && conditions.actionTypes.length > 0) {
      const actionMatches = conditions.actionTypes.some(pattern =>
        this.matchPattern(context.intent.goal, pattern)
      );
      if (!actionMatches) {
        matched = false;
      } else {
        reasons.push(`Action ${context.intent.goal} matches patterns`);
      }
      details.actionTypes = conditions.actionTypes;
    }

    // Check resource patterns
    if (matched && conditions.resourcePatterns && conditions.resourcePatterns.length > 0) {
      const resource = (context.intent.context as Record<string, unknown>)?.resource as string | undefined;
      if (resource) {
        const resourceMatches = conditions.resourcePatterns.some(pattern =>
          this.matchPattern(resource, pattern)
        );
        if (!resourceMatches) {
          matched = false;
        } else {
          reasons.push(`Resource ${resource} matches patterns`);
        }
      } else {
        matched = false;
      }
      details.resourcePatterns = conditions.resourcePatterns;
    }

    // Check resource sensitivity
    if (matched && conditions.resourceSensitivity && conditions.resourceSensitivity.length > 0) {
      if (context.resourceSensitivity) {
        if (!conditions.resourceSensitivity.includes(context.resourceSensitivity)) {
          matched = false;
        } else {
          reasons.push(`Resource sensitivity ${context.resourceSensitivity} in required levels`);
        }
      } else {
        matched = false;
      }
      details.resourceSensitivity = conditions.resourceSensitivity;
    }

    // Check intent types
    if (matched && conditions.intentTypes && conditions.intentTypes.length > 0) {
      const intentType = context.intent.intentType;
      if (intentType) {
        const typeMatches = conditions.intentTypes.some(pattern =>
          this.matchPattern(intentType, pattern)
        );
        if (!typeMatches) {
          matched = false;
        } else {
          reasons.push(`Intent type ${intentType} matches patterns`);
        }
      } else {
        matched = false;
      }
      details.intentTypes = conditions.intentTypes;
    }

    // Check trust level
    if (matched && conditions.trustLevelBelow !== undefined) {
      if (context.trustLevel >= conditions.trustLevelBelow) {
        matched = false;
      } else {
        reasons.push(`Trust level ${context.trustLevel} < threshold ${conditions.trustLevelBelow}`);
      }
      details.trustLevelBelow = conditions.trustLevelBelow;
    }

    // Check entity types
    if (matched && conditions.entityTypes && conditions.entityTypes.length > 0) {
      const entityType = (context.intent.context as Record<string, unknown>)?.entityType as string | undefined;
      if (entityType && !conditions.entityTypes.includes(entityType)) {
        matched = false;
      }
      details.entityTypes = conditions.entityTypes;
    }

    // Check custom expression
    if (matched && conditions.customExpression) {
      const exprResult = this.evaluateExpression(conditions.customExpression, context);
      if (!exprResult) {
        matched = false;
      } else {
        reasons.push('Custom expression matched');
      }
      details.customExpression = conditions.customExpression;
    }

    const selectedTargets = matched
      ? this.selectAvailableTargets(rule.escalation.targets)
      : [];

    return {
      rule,
      matched,
      reason: matched ? reasons.join('; ') : 'Conditions not met',
      riskScore,
      riskLevel,
      selectedTargets,
      details,
    };
  }

  /**
   * Compute risk score from context
   */
  private computeRiskScore(context: EscalationContext): number {
    let score = 0;

    // Base score from inverse trust (lower trust = higher risk)
    score += (1000 - context.trustScore) * 0.3;

    // Add risk based on trust level
    const trustRisk: Record<TrustLevel, number> = {
      0: 300,
      1: 200,
      2: 100,
      3: 50,
      4: 25,
      5: 10,
      6: 5,
      7: 0,
    };
    score += trustRisk[context.trustLevel] ?? 0;

    // Add risk based on resource sensitivity
    const sensitivityRisk: Record<ResourceSensitivity, number> = {
      'public': 0,
      'internal': 50,
      'confidential': 150,
      'restricted': 300,
      'top-secret': 500,
    };
    if (context.resourceSensitivity) {
      score += sensitivityRisk[context.resourceSensitivity] ?? 0;
    }

    // Clamp to 0-1000
    return Math.min(1000, Math.max(0, Math.round(score)));
  }

  /**
   * Classify risk level from score
   */
  private classifyRiskLevel(score: number): RiskLevel {
    const thresholds = this.options.riskThresholds;
    if (score >= thresholds.critical) return 'critical';
    if (score >= thresholds.high) return 'high';
    if (score >= thresholds.medium) return 'medium';
    if (score >= thresholds.low) return 'low';
    return 'minimal';
  }

  /**
   * Select available targets based on schedule
   */
  private selectAvailableTargets(
    targets: EscalationTarget[],
    timestamp?: Timestamp
  ): EscalationTarget[] {
    const now = timestamp ? new Date(timestamp) : new Date();
    const available: EscalationTarget[] = [];

    for (const target of targets) {
      if (this.isTargetAvailable(target, now)) {
        available.push(target);
      }
    }

    // Sort by priority
    return available.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Check if target is available
   */
  private isTargetAvailable(target: EscalationTarget, now: Date): boolean {
    if (!target.availability) return true;

    const { availableHours, availableDays, outOfOffice } = target.availability;

    // Check out of office
    if (outOfOffice) {
      for (const period of outOfOffice) {
        const start = new Date(period.start);
        const end = new Date(period.end);
        if (now >= start && now <= end) {
          return false;
        }
      }
    }

    // Check available days
    if (availableDays && availableDays.length > 0) {
      if (!availableDays.includes(now.getDay())) {
        return false;
      }
    }

    // Check available hours
    if (availableHours) {
      const [startHour, startMin] = availableHours.start.split(':').map(Number);
      const [endHour, endMin] = availableHours.end.split(':').map(Number);
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const startMinutes = (startHour ?? 0) * 60 + (startMin ?? 0);
      const endMinutes = (endHour ?? 0) * 60 + (endMin ?? 0);

      if (currentMinutes < startMinutes || currentMinutes > endMinutes) {
        return false;
      }
    }

    return true;
  }

  /**
   * Send notifications to all targets
   */
  private async sendNotifications(
    request: EscalationRequestFull,
    type: 'initial' | 'reminder' | 're-escalation'
  ): Promise<void> {
    for (const target of request.targets) {
      try {
        await this.notificationHandler.notify(target, request, type);
      } catch (error) {
        logger.error({
          targetId: target.id,
          escalationId: request.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        }, 'Failed to send notification');
      }
    }
  }

  /**
   * Match value against pattern
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
   * Evaluate simple expression
   */
  private evaluateExpression(expression: string, context: EscalationContext): boolean {
    // Simple expression evaluator
    const parts = expression.match(/^([\w.]+)\s*(==|!=|>|<|>=|<=)\s*(.+)$/);
    if (!parts) return false;

    const [, fieldPath, operator, rawValue] = parts;
    const actualValue = this.resolveFieldPath(fieldPath!, context);
    const expectedValue = this.parseValue(rawValue!.trim());

    switch (operator) {
      case '==': return actualValue === expectedValue;
      case '!=': return actualValue !== expectedValue;
      case '>': return typeof actualValue === 'number' && typeof expectedValue === 'number' && actualValue > expectedValue;
      case '<': return typeof actualValue === 'number' && typeof expectedValue === 'number' && actualValue < expectedValue;
      case '>=': return typeof actualValue === 'number' && typeof expectedValue === 'number' && actualValue >= expectedValue;
      case '<=': return typeof actualValue === 'number' && typeof expectedValue === 'number' && actualValue <= expectedValue;
      default: return false;
    }
  }

  /**
   * Resolve field path from context
   */
  private resolveFieldPath(path: string, context: EscalationContext): unknown {
    const parts = path.split('.');
    let current: unknown = context;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Parse value string
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
    return value;
  }

  // =============================================================================
  // RULE MANAGEMENT
  // =============================================================================

  /**
   * Add an escalation rule
   */
  addRule(rule: EscalationRule): void {
    this.rules.set(rule.id, rule);
    logger.info({ ruleId: rule.id, ruleName: rule.name }, 'Escalation rule added');
  }

  /**
   * Remove a rule
   */
  removeRule(ruleId: ID): boolean {
    const removed = this.rules.delete(ruleId);
    if (removed) {
      logger.info({ ruleId }, 'Escalation rule removed');
    }
    return removed;
  }

  /**
   * Get a rule by ID
   */
  getRule(ruleId: ID): EscalationRule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * Get all rules
   */
  getAllRules(): EscalationRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get enabled rules
   */
  getEnabledRules(): EscalationRule[] {
    return Array.from(this.rules.values()).filter(r => r.enabled);
  }

  /**
   * Get active escalation by ID
   */
  getEscalation(escalationId: ID): EscalationRequestFull | undefined {
    return this.activeEscalations.get(escalationId);
  }

  /**
   * Get all active escalations
   */
  getActiveEscalations(): EscalationRequestFull[] {
    return Array.from(this.activeEscalations.values()).filter(e => e.status === 'pending');
  }

  /**
   * Set notification handler
   */
  setNotificationHandler(handler: NotificationHandler): void {
    this.notificationHandler = handler;
    logger.info('Notification handler updated');
  }

  /**
   * Clear all rules and escalations
   */
  clear(): void {
    this.rules.clear();
    this.activeEscalations.clear();
    logger.info('Escalation rule engine cleared');
  }

  /**
   * Get engine statistics
   */
  getStats(): {
    totalRules: number;
    enabledRules: number;
    activeEscalations: number;
    pendingEscalations: number;
  } {
    return {
      totalRules: this.rules.size,
      enabledRules: Array.from(this.rules.values()).filter(r => r.enabled).length,
      activeEscalations: this.activeEscalations.size,
      pendingEscalations: Array.from(this.activeEscalations.values()).filter(e => e.status === 'pending').length,
    };
  }
}

/**
 * Create a new escalation rule engine instance
 */
export function createEscalationRuleEngine(options?: EscalationEngineOptions): EscalationRuleEngine {
  return new EscalationRuleEngine(options);
}

/**
 * Create an escalation rule with defaults
 */
export function createEscalationRule(
  partial: Partial<EscalationRule> & Pick<EscalationRule, 'id' | 'name' | 'conditions' | 'escalation'>
): EscalationRule {
  return {
    description: '',
    enabled: true,
    priority: 100,
    ...partial,
  };
}

/**
 * Create an escalation target
 */
export function createEscalationTarget(
  partial: Partial<EscalationTarget> & Pick<EscalationTarget, 'id' | 'type' | 'name'>
): EscalationTarget {
  return {
    channels: [],
    canDecide: true,
    priority: 100,
    ...partial,
  };
}
