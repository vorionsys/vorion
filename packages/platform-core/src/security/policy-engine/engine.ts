/**
 * Security Policy Engine
 *
 * Core engine for evaluating dynamic security policies.
 * Provides policy management, evaluation, and enforcement capabilities.
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../../common/logger.js';
import { withSpan, type TraceSpan } from '../../common/trace.js';
import {
  ConditionEvaluator,
  type ConditionEvaluatorOptions,
  type CustomExpressionEvaluator,
} from './condition-evaluator.js';
import {
  RuleEvaluator,
  type RuleEvaluatorOptions,
  type RateLimiter,
  type GeoLocationProvider,
  type CustomRuleHandler,
} from './rule-evaluator.js';
import type {
  SecurityPolicy,
  PolicyContext,
  PolicyDecision,
  PolicyEvaluationResult,
  PolicyAction,
  DecisionOutcome,
  PolicyCondition,
  ConditionEvaluationResult,
  RuleEvaluationResult,
  PolicyVersionRecord,
  PolicyValidationResult,
  PolicyValidationError,
  PolicySimulationRequest,
  PolicySimulationResult,
} from './types.js';
import { securityPolicySchema } from './types.js';

const logger = createLogger({ component: 'security-policy-engine' });

/**
 * Policy update listener
 */
export type PolicyUpdateListener = (
  policyId: string,
  action: 'add' | 'update' | 'remove',
  policy?: SecurityPolicy
) => void;

/**
 * Break-glass validator
 */
export type BreakGlassValidator = (token: string, context: PolicyContext) => Promise<{
  valid: boolean;
  reason?: string;
  expiresAt?: string;
  grantedBy?: string;
}>;

/**
 * Security policy engine options
 */
export interface SecurityPolicyEngineOptions {
  /** Condition evaluator options */
  conditionEvaluator?: ConditionEvaluatorOptions;
  /** Rule evaluator options */
  ruleEvaluator?: RuleEvaluatorOptions;
  /** Enable OpenTelemetry tracing */
  enableTracing?: boolean;
  /** Maximum policies to evaluate per request */
  maxPoliciesToEvaluate?: number;
  /** Enable policy caching */
  enableCaching?: boolean;
  /** Cache TTL in milliseconds */
  cacheTtlMs?: number;
  /** Break-glass token validator */
  breakGlassValidator?: BreakGlassValidator;
  /** Default decision when no policies match */
  defaultDecision?: DecisionOutcome;
  /** Enable policy versioning */
  enableVersioning?: boolean;
  /** Maximum versions to keep per policy */
  maxVersionsPerPolicy?: number;
}

/**
 * SecurityPolicyEngine class
 */
export class SecurityPolicyEngine {
  private policies: Map<string, SecurityPolicy> = new Map();
  private policyVersions: Map<string, PolicyVersionRecord[]> = new Map();
  private updateListeners: PolicyUpdateListener[] = [];
  private conditionEvaluator: ConditionEvaluator;
  private ruleEvaluator: RuleEvaluator;
  private breakGlassValidator?: BreakGlassValidator;
  private options: Required<Omit<SecurityPolicyEngineOptions, 'conditionEvaluator' | 'ruleEvaluator' | 'breakGlassValidator'>>;

  constructor(options: SecurityPolicyEngineOptions = {}) {
    this.conditionEvaluator = new ConditionEvaluator(options.conditionEvaluator);
    this.ruleEvaluator = new RuleEvaluator(options.ruleEvaluator);
    this.breakGlassValidator = options.breakGlassValidator;

    this.options = {
      enableTracing: options.enableTracing ?? true,
      maxPoliciesToEvaluate: options.maxPoliciesToEvaluate ?? 100,
      enableCaching: options.enableCaching ?? true,
      cacheTtlMs: options.cacheTtlMs ?? 60000,
      defaultDecision: options.defaultDecision ?? 'deny', // SECURITY: default-deny posture
      enableVersioning: options.enableVersioning ?? true,
      maxVersionsPerPolicy: options.maxVersionsPerPolicy ?? 10,
    };

    // SECURITY WARNING: Log if default-allow is explicitly configured
    if (this.options.defaultDecision === 'allow') {
      logger.warn(
        { defaultDecision: 'allow' },
        'Security policy engine configured with default-ALLOW. This is not recommended for production.'
      );
    }

    logger.info({
      enableTracing: this.options.enableTracing,
      maxPoliciesToEvaluate: this.options.maxPoliciesToEvaluate,
      defaultDecision: this.options.defaultDecision,
    }, 'Security policy engine initialized');
  }

  /**
   * Evaluate all applicable policies against the context
   */
  async evaluate(context: PolicyContext): Promise<PolicyDecision> {
    const startTime = performance.now();
    const decisionId = randomUUID();
    const requestId = context.request.id;

    logger.debug({ requestId, decisionId }, 'Starting policy evaluation');

    // Check for break-glass override
    if (context.breakGlassToken && this.breakGlassValidator) {
      const breakGlassResult = await this.breakGlassValidator(context.breakGlassToken, context);
      if (breakGlassResult.valid) {
        logger.warn({
          requestId,
          decisionId,
          grantedBy: breakGlassResult.grantedBy,
        }, 'Break-glass override used');

        return this.createDecision({
          id: decisionId,
          requestId,
          outcome: 'allow',
          reason: 'Break-glass override granted',
          actions: [],
          evaluatedPolicies: [],
          matchedPolicies: [],
          breakGlassUsed: true,
          totalDurationMs: performance.now() - startTime,
          metadata: {
            breakGlassGrantedBy: breakGlassResult.grantedBy,
            breakGlassExpiresAt: breakGlassResult.expiresAt,
          },
        });
      }
    }

    // Get applicable policies
    const applicablePolicies = this.getApplicablePolicies(context);

    if (applicablePolicies.length === 0) {
      logger.debug({ requestId, decisionId }, 'No applicable policies found');

      return this.createDecision({
        id: decisionId,
        requestId,
        outcome: this.options.defaultDecision,
        reason: 'No applicable policies',
        actions: [],
        evaluatedPolicies: [],
        matchedPolicies: [],
        breakGlassUsed: false,
        totalDurationMs: performance.now() - startTime,
      });
    }

    // Evaluate policies in priority order
    const evaluatedPolicies: PolicyEvaluationResult[] = [];
    const matchedPolicies: PolicyEvaluationResult[] = [];
    const allActions: PolicyAction[] = [];

    for (const policy of applicablePolicies.slice(0, this.options.maxPoliciesToEvaluate)) {
      const result = await this.evaluatePolicy(policy, context);
      evaluatedPolicies.push(result);

      if (result.matched) {
        matchedPolicies.push(result);
        allActions.push(...result.actions);

        // Check for immediate deny actions
        const hasDeny = result.actions.some(a => a.type === 'deny');
        if (hasDeny) {
          const denyAction = result.actions.find(a => a.type === 'deny');
          logger.info({
            requestId,
            decisionId,
            policyId: policy.id,
            reason: (denyAction as { reason: string } | undefined)?.reason,
          }, 'Policy denied request');

          return this.createDecision({
            id: decisionId,
            requestId,
            outcome: 'deny',
            reason: (denyAction as { reason: string } | undefined)?.reason ?? 'Access denied by policy',
            actions: result.actions,
            evaluatedPolicies,
            matchedPolicies,
            breakGlassUsed: false,
            totalDurationMs: performance.now() - startTime,
          });
        }
      }
    }

    // Determine final outcome
    const outcome = this.determineOutcome(matchedPolicies, allActions);
    const reason = this.determineReason(outcome, matchedPolicies);

    const decision = this.createDecision({
      id: decisionId,
      requestId,
      outcome,
      reason,
      actions: allActions,
      evaluatedPolicies,
      matchedPolicies,
      breakGlassUsed: false,
      totalDurationMs: performance.now() - startTime,
    });

    logger.info({
      requestId,
      decisionId,
      outcome,
      policiesEvaluated: evaluatedPolicies.length,
      policiesMatched: matchedPolicies.length,
      durationMs: decision.totalDurationMs,
    }, 'Policy evaluation completed');

    return decision;
  }

  /**
   * Evaluate with OpenTelemetry tracing
   */
  async evaluateWithTracing(context: PolicyContext): Promise<PolicyDecision> {
    if (!this.options.enableTracing) {
      return this.evaluate(context);
    }

    return withSpan(
      'security.policy.evaluate',
      async (span: TraceSpan) => {
        span.attributes['request.id'] = context.request.id;
        span.attributes['request.method'] = context.request.method;
        span.attributes['request.path'] = context.request.path;

        if (context.user) {
          span.attributes['user.id'] = context.user.id;
          span.attributes['user.role'] = context.user.role ?? 'unknown';
        }

        const decision = await this.evaluate(context);

        span.attributes['decision.outcome'] = decision.outcome;
        span.attributes['decision.policies_evaluated'] = decision.evaluatedPolicies.length;
        span.attributes['decision.policies_matched'] = decision.matchedPolicies.length;
        span.attributes['decision.break_glass'] = decision.breakGlassUsed;
        span.attributes['decision.duration_ms'] = decision.totalDurationMs;

        return decision;
      },
      { 'component': 'security-policy-engine' }
    );
  }

  /**
   * Evaluate a single policy
   */
  private async evaluatePolicy(
    policy: SecurityPolicy,
    context: PolicyContext
  ): Promise<PolicyEvaluationResult> {
    const startTime = performance.now();

    // Evaluate conditions
    const conditionResults: ConditionEvaluationResult[] = [];
    let conditionsMatched = true;

    for (const condition of policy.conditions) {
      const result = this.conditionEvaluator.evaluate(condition, context);
      conditionResults.push(result);

      if (!result.matched) {
        conditionsMatched = false;
        break; // Conditions are AND by default
      }
    }

    // If conditions don't match, policy doesn't apply
    if (!conditionsMatched) {
      return {
        policyId: policy.id,
        policyName: policy.name,
        policyVersion: policy.version,
        matched: false,
        conditionResults,
        ruleResults: [],
        actions: [],
        durationMs: performance.now() - startTime,
        evaluatedAt: new Date().toISOString(),
      };
    }

    // Evaluate rules
    const ruleResults = await this.ruleEvaluator.evaluateAll(policy.rules, context);

    // Determine if all enforced rules passed
    const allRulesPassed = ruleResults
      .filter(r => r.enforced)
      .every(r => r.passed);

    return {
      policyId: policy.id,
      policyName: policy.name,
      policyVersion: policy.version,
      matched: conditionsMatched,
      conditionResults,
      ruleResults,
      actions: allRulesPassed ? policy.actions : this.getFailedRuleActions(ruleResults, policy),
      durationMs: performance.now() - startTime,
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get actions for failed rules
   */
  private getFailedRuleActions(
    ruleResults: RuleEvaluationResult[],
    policy: SecurityPolicy
  ): PolicyAction[] {
    const actions: PolicyAction[] = [];
    const failedRules = ruleResults.filter(r => r.enforced && !r.passed);

    for (const failedRule of failedRules) {
      // Map rule type to appropriate action
      switch (failedRule.ruleType) {
        case 'require_mfa':
          actions.push({
            type: 'challenge',
            method: 'mfa',
            timeout: (failedRule.metadata?.timeout as number) ?? 300,
          });
          break;
        case 'require_approval':
          actions.push({
            type: 'challenge',
            method: 'approval',
            timeout: (failedRule.metadata?.timeout as number) ?? 3600,
          });
          break;
        case 'block_access':
          actions.push({
            type: 'deny',
            reason: failedRule.reason ?? 'Access blocked',
            errorCode: (failedRule.metadata?.errorCode as string) ?? 'ACCESS_BLOCKED',
          });
          break;
        case 'rate_limit':
          actions.push({
            type: 'deny',
            reason: 'Rate limit exceeded',
            errorCode: 'RATE_LIMIT_EXCEEDED',
            httpStatus: 429,
            retryable: true,
            retryAfter: (failedRule.metadata?.retryAfter as number) ?? 60,
          });
          break;
        case 'step_up_auth':
          actions.push({
            type: 'challenge',
            method: (failedRule.metadata?.method as 'mfa' | 'password') ?? 'mfa',
            timeout: (failedRule.metadata?.timeout as number) ?? 300,
          });
          break;
        case 'session_timeout':
          actions.push({
            type: 'challenge',
            method: 'password',
            timeout: 300,
          });
          break;
        case 'geo_restriction':
          actions.push({
            type: 'deny',
            reason: failedRule.reason ?? 'Geo restriction',
            errorCode: 'GEO_RESTRICTED',
          });
          break;
        default:
          actions.push({
            type: 'deny',
            reason: failedRule.reason ?? 'Policy rule failed',
            errorCode: 'RULE_FAILED',
          });
      }
    }

    // Include policy-defined actions
    actions.push(...policy.actions);

    return actions;
  }

  /**
   * Determine final outcome from matched policies
   */
  private determineOutcome(
    matchedPolicies: PolicyEvaluationResult[],
    allActions: PolicyAction[]
  ): DecisionOutcome {
    if (matchedPolicies.length === 0) {
      return this.options.defaultDecision;
    }

    // Check for any deny actions
    if (allActions.some(a => a.type === 'deny')) {
      return 'deny';
    }

    // Check for challenge actions
    if (allActions.some(a => a.type === 'challenge')) {
      return 'challenge';
    }

    // Check for pending actions (like approval)
    const hasPendingApproval = matchedPolicies.some(p =>
      p.ruleResults.some(r =>
        r.ruleType === 'require_approval' && !r.passed
      )
    );

    if (hasPendingApproval) {
      return 'pending';
    }

    return 'allow';
  }

  /**
   * Determine reason for decision
   */
  private determineReason(
    outcome: DecisionOutcome,
    matchedPolicies: PolicyEvaluationResult[]
  ): string {
    switch (outcome) {
      case 'deny':
        const denyPolicy = matchedPolicies.find(p =>
          p.actions.some(a => a.type === 'deny')
        );
        return denyPolicy
          ? `Denied by policy: ${denyPolicy.policyName}`
          : 'Access denied';

      case 'challenge':
        const challengePolicy = matchedPolicies.find(p =>
          p.actions.some(a => a.type === 'challenge')
        );
        return challengePolicy
          ? `Challenge required by policy: ${challengePolicy.policyName}`
          : 'Additional verification required';

      case 'pending':
        return 'Awaiting approval';

      case 'allow':
        return matchedPolicies.length > 0
          ? `Allowed by ${matchedPolicies.length} policies`
          : 'No restrictions';

      default:
        return 'Unknown decision';
    }
  }

  /**
   * Create a policy decision
   */
  private createDecision(params: {
    id: string;
    requestId: string;
    outcome: DecisionOutcome;
    reason: string;
    actions: PolicyAction[];
    evaluatedPolicies: PolicyEvaluationResult[];
    matchedPolicies: PolicyEvaluationResult[];
    breakGlassUsed: boolean;
    totalDurationMs: number;
    metadata?: Record<string, unknown>;
  }): PolicyDecision {
    return {
      ...params,
      decidedAt: new Date().toISOString(),
    };
  }

  /**
   * Get applicable policies for the context
   */
  getApplicablePolicies(context: PolicyContext): SecurityPolicy[] {
    const applicable: SecurityPolicy[] = [];
    const policies = Array.from(this.policies.values());

    for (const policy of policies) {
      if (!policy.enabled) continue;

      // Quick pre-check for basic applicability
      if (this.isPolicyApplicable(policy, context)) {
        applicable.push(policy);
      }
    }

    // Sort by priority (higher priority first)
    return applicable.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Check if a policy is applicable based on basic criteria
   */
  private isPolicyApplicable(policy: SecurityPolicy, context: PolicyContext): boolean {
    // If no conditions, policy applies to everything
    if (policy.conditions.length === 0) {
      return true;
    }

    // Check first condition as a quick filter
    // Full evaluation happens in evaluatePolicy
    return true;
  }

  // =============================================================================
  // POLICY MANAGEMENT
  // =============================================================================

  /**
   * Add a policy
   */
  addPolicy(policy: SecurityPolicy): void {
    // Validate policy
    const validation = this.validatePolicy(policy);
    if (!validation.valid) {
      throw new Error(`Invalid policy: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    this.policies.set(policy.id, policy);

    // Track version
    if (this.options.enableVersioning) {
      this.addPolicyVersion(policy);
    }

    logger.info({ policyId: policy.id, policyName: policy.name }, 'Policy added');
    this.notifyListeners(policy.id, 'add', policy);
  }

  /**
   * Remove a policy
   */
  removePolicy(policyId: string): boolean {
    const removed = this.policies.delete(policyId);

    if (removed) {
      logger.info({ policyId }, 'Policy removed');
      this.notifyListeners(policyId, 'remove');
    }

    return removed;
  }

  /**
   * Update a policy
   */
  updatePolicy(policyId: string, updates: Partial<SecurityPolicy>): SecurityPolicy {
    const existing = this.policies.get(policyId);
    if (!existing) {
      throw new Error(`Policy not found: ${policyId}`);
    }

    const updated: SecurityPolicy = {
      ...existing,
      ...updates,
      id: policyId, // Ensure ID doesn't change
      updatedAt: new Date().toISOString(),
    };

    // Validate updated policy
    const validation = this.validatePolicy(updated);
    if (!validation.valid) {
      throw new Error(`Invalid policy update: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    this.policies.set(policyId, updated);

    // Track version
    if (this.options.enableVersioning) {
      this.addPolicyVersion(updated);
    }

    logger.info({ policyId, policyName: updated.name }, 'Policy updated');
    this.notifyListeners(policyId, 'update', updated);

    return updated;
  }

  /**
   * Get a policy by ID
   */
  getPolicy(policyId: string): SecurityPolicy | undefined {
    return this.policies.get(policyId);
  }

  /**
   * Get all policies
   */
  getAllPolicies(): SecurityPolicy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Get enabled policies
   */
  getEnabledPolicies(): SecurityPolicy[] {
    return Array.from(this.policies.values()).filter(p => p.enabled);
  }

  /**
   * Enable a policy
   */
  enablePolicy(policyId: string): boolean {
    const policy = this.policies.get(policyId);
    if (!policy) return false;

    policy.enabled = true;
    policy.updatedAt = new Date().toISOString();
    this.notifyListeners(policyId, 'update', policy);
    return true;
  }

  /**
   * Disable a policy
   */
  disablePolicy(policyId: string): boolean {
    const policy = this.policies.get(policyId);
    if (!policy) return false;

    policy.enabled = false;
    policy.updatedAt = new Date().toISOString();
    this.notifyListeners(policyId, 'update', policy);
    return true;
  }

  // =============================================================================
  // POLICY VERSIONING
  // =============================================================================

  /**
   * Add a policy version
   */
  private addPolicyVersion(policy: SecurityPolicy): void {
    const versions = this.policyVersions.get(policy.id) ?? [];

    const versionRecord: PolicyVersionRecord = {
      id: randomUUID(),
      policyId: policy.id,
      version: policy.version,
      policy: { ...policy },
      createdBy: policy.updatedBy ?? policy.createdBy,
      createdAt: new Date().toISOString(),
    };

    versions.push(versionRecord);

    // Keep only max versions
    while (versions.length > this.options.maxVersionsPerPolicy) {
      versions.shift();
    }

    this.policyVersions.set(policy.id, versions);
  }

  /**
   * Get policy versions
   */
  getPolicyVersions(policyId: string): PolicyVersionRecord[] {
    return this.policyVersions.get(policyId) ?? [];
  }

  /**
   * Rollback policy to a previous version
   */
  rollbackPolicy(policyId: string, versionId: string): SecurityPolicy | null {
    const versions = this.policyVersions.get(policyId);
    if (!versions) return null;

    const version = versions.find(v => v.id === versionId);
    if (!version) return null;

    const rolledBack: SecurityPolicy = {
      ...version.policy,
      version: this.incrementVersion(version.policy.version),
      updatedAt: new Date().toISOString(),
    };

    this.policies.set(policyId, rolledBack);
    this.addPolicyVersion(rolledBack);

    logger.info({ policyId, versionId, newVersion: rolledBack.version }, 'Policy rolled back');
    this.notifyListeners(policyId, 'update', rolledBack);

    return rolledBack;
  }

  /**
   * Increment version number
   */
  private incrementVersion(version: string): string {
    const parts = version.split('.');
    if (parts.length !== 3) return '1.0.0';

    const patch = parseInt(parts[2]!, 10) + 1;
    return `${parts[0]}.${parts[1]}.${patch}`;
  }

  // =============================================================================
  // VALIDATION
  // =============================================================================

  /**
   * Validate a policy
   */
  validatePolicy(policy: unknown): PolicyValidationResult {
    const errors: PolicyValidationError[] = [];
    const warnings: string[] = [];

    try {
      securityPolicySchema.parse(policy);
    } catch (error) {
      if (error instanceof Error && 'issues' in error) {
        const zodError = error as { issues: Array<{ path: (string | number)[]; message: string }> };
        for (const issue of zodError.issues) {
          errors.push({
            path: issue.path.join('.'),
            message: issue.message,
            code: 'VALIDATION_ERROR',
          });
        }
      } else {
        errors.push({
          path: '',
          message: error instanceof Error ? error.message : 'Unknown validation error',
          code: 'UNKNOWN_ERROR',
        });
      }
    }

    // Additional validation
    const p = policy as SecurityPolicy;

    // Check for conflicting actions
    if (p.actions) {
      const hasAllow = p.actions.some(a => a.type === 'allow');
      const hasDeny = p.actions.some(a => a.type === 'deny');
      if (hasAllow && hasDeny) {
        warnings.push('Policy has both allow and deny actions, which may cause unexpected behavior');
      }
    }

    // Check for empty conditions with high priority
    if (p.conditions?.length === 0 && p.priority > 100) {
      warnings.push('High-priority policy with no conditions will apply to all requests');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // =============================================================================
  // SIMULATION
  // =============================================================================

  /**
   * Simulate policy evaluation (dry-run)
   */
  async simulate(request: PolicySimulationRequest): Promise<PolicySimulationResult> {
    // Get policies to evaluate
    let policiesToEvaluate: SecurityPolicy[];

    if (request.policies) {
      policiesToEvaluate = request.policies
        .map(id => this.policies.get(id))
        .filter((p): p is SecurityPolicy => p !== undefined);
    } else {
      policiesToEvaluate = request.includeDisabled
        ? this.getAllPolicies()
        : this.getEnabledPolicies();
    }

    // Evaluate with current context
    const decision = await this.evaluate(request.context);

    // Build what-if analysis
    const whatIf: PolicySimulationResult['whatIf'] = {};

    if (request.verbose) {
      // What if each policy was disabled
      for (const policy of decision.matchedPolicies) {
        const originalEnabled = this.policies.get(policy.policyId)?.enabled;
        if (originalEnabled) {
          this.policies.get(policy.policyId)!.enabled = false;
          whatIf.withoutPolicy = whatIf.withoutPolicy ?? {};
          whatIf.withoutPolicy[policy.policyId] = await this.evaluate(request.context);
          this.policies.get(policy.policyId)!.enabled = true;
        }
      }
    }

    // Generate recommendations
    const recommendations: string[] = [];

    if (decision.outcome === 'deny') {
      recommendations.push('Consider adding break-glass procedures for emergency access');
    }

    if (decision.matchedPolicies.length === 0) {
      recommendations.push('No policies matched - consider adding default security policies');
    }

    return {
      decision,
      whatIf,
      recommendations,
    };
  }

  // =============================================================================
  // UPDATE LISTENERS
  // =============================================================================

  /**
   * Register an update listener
   */
  onPolicyUpdate(listener: PolicyUpdateListener): () => void {
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
  private notifyListeners(
    policyId: string,
    action: 'add' | 'update' | 'remove',
    policy?: SecurityPolicy
  ): void {
    for (const listener of this.updateListeners) {
      try {
        listener(policyId, action, policy);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ error: message }, 'Policy update listener error');
      }
    }
  }

  // =============================================================================
  // CONFIGURATION
  // =============================================================================

  /**
   * Register a custom condition expression evaluator
   */
  registerConditionEvaluator(language: string, evaluator: CustomExpressionEvaluator): void {
    this.conditionEvaluator.registerCustomEvaluator(language, evaluator);
  }

  /**
   * Register a custom rule handler
   */
  registerRuleHandler(name: string, handler: CustomRuleHandler): void {
    this.ruleEvaluator.registerCustomHandler(name, handler);
  }

  /**
   * Set rate limiter
   */
  setRateLimiter(rateLimiter: RateLimiter): void {
    this.ruleEvaluator.setRateLimiter(rateLimiter);
  }

  /**
   * Set geo location provider
   */
  setGeoLocationProvider(provider: GeoLocationProvider): void {
    this.ruleEvaluator.setGeoLocationProvider(provider);
  }

  /**
   * Set break-glass validator
   */
  setBreakGlassValidator(validator: BreakGlassValidator): void {
    this.breakGlassValidator = validator;
  }

  // =============================================================================
  // STATISTICS
  // =============================================================================

  /**
   * Get engine statistics
   */
  getStats(): {
    totalPolicies: number;
    enabledPolicies: number;
    totalVersions: number;
    policiesByTag: Record<string, number>;
  } {
    let totalVersions = 0;
    const allVersions = Array.from(this.policyVersions.values());
    for (const versions of allVersions) {
      totalVersions += versions.length;
    }

    const policiesByTag: Record<string, number> = {};
    const allPolicies = Array.from(this.policies.values());
    for (const policy of allPolicies) {
      for (const tag of policy.tags ?? []) {
        policiesByTag[tag] = (policiesByTag[tag] ?? 0) + 1;
      }
    }

    return {
      totalPolicies: this.policies.size,
      enabledPolicies: allPolicies.filter(p => p.enabled).length,
      totalVersions,
      policiesByTag,
    };
  }

  /**
   * Clear all policies
   */
  clear(): void {
    this.policies.clear();
    this.policyVersions.clear();
    logger.info('Security policy engine cleared');
  }
}

/**
 * Create a security policy engine instance
 */
export function createSecurityPolicyEngine(options?: SecurityPolicyEngineOptions): SecurityPolicyEngine {
  return new SecurityPolicyEngine(options);
}
