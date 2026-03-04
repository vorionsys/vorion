/**
 * ENFORCE - Policy Decision Point
 *
 * Makes enforcement decisions based on rule evaluations, trust levels,
 * policy evaluation, constraint checking, and escalation rules.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import { withSpan, type TraceSpan } from '../common/trace.js';
import type {
  Intent,
  Decision,
  ControlAction,
  TrustLevel,
  TrustScore,
  ID,
  Timestamp,
} from '../common/types.js';
import type { EvaluationResult, RuleResult } from '../basis/types.js';

// Re-export all submodules
export * from './policy-engine.js';
export * from './constraint-evaluator.js';
export * from './escalation-rules.js';
export * from './decision-aggregator.js';
export * from './runtime-config.js';

// Import submodules for orchestration
import {
  PolicyEngine,
  createPolicyEngine,
  type PolicyEngineOptions,
  type PolicyEvaluationContext,
  type PolicyEvaluationResult,
  type EnforcementPolicy,
} from './policy-engine.js';
import {
  ConstraintEvaluator,
  createConstraintEvaluator,
  type ConstraintEvaluatorOptions,
  type ConstraintEvaluationContext,
  type ConstraintEvaluationResult,
  type Constraint,
  type StateProvider,
  InMemoryStateProvider,
} from './constraint-evaluator.js';
import {
  EscalationRuleEngine,
  createEscalationRuleEngine,
  type EscalationEngineOptions,
  type EscalationContext,
  type EscalationMatchResult,
  type EscalationRule,
} from './escalation-rules.js';
import {
  DecisionAggregator,
  createDecisionAggregator,
  type DecisionAggregatorOptions,
  type SourceDecision,
  type AggregatedDecision,
  type ConflictStrategy,
  createSourceDecision,
} from './decision-aggregator.js';
import {
  RuntimeConfig,
  createRuntimeConfig,
  type RuntimeConfigOptions,
  type EnforcementMode,
} from './runtime-config.js';

const logger = createLogger({ component: 'enforce' });

// =============================================================================
// LEGACY TYPES (maintained for backwards compatibility)
// =============================================================================

/**
 * Enforcement context combining intent and evaluation results
 */
export interface EnforcementContext {
  intent: Intent;
  evaluation: EvaluationResult;
  trustScore: TrustScore;
  trustLevel: TrustLevel;
}

/**
 * Legacy enforcement policy configuration
 * @deprecated Use EnforcementPolicy from policy-engine instead
 */
export interface LegacyEnforcementPolicy {
  defaultAction: ControlAction;
  requireMinTrustLevel?: TrustLevel;
  escalationRules?: LegacyEscalationRule[];
}

/**
 * Legacy escalation rule definition
 * @deprecated Use EscalationRule from escalation-rules instead
 */
export interface LegacyEscalationRule {
  condition: string;
  escalateTo: string;
  timeout: string;
}

// =============================================================================
// ENFORCEMENT SERVICE OPTIONS
// =============================================================================

/**
 * Options for the unified enforcement service
 */
export interface EnforcementServiceOptions {
  /** Policy engine options */
  policyEngine?: PolicyEngineOptions;
  /** Constraint evaluator options */
  constraintEvaluator?: ConstraintEvaluatorOptions;
  /** Escalation engine options */
  escalationEngine?: EscalationEngineOptions;
  /** Decision aggregator options */
  decisionAggregator?: DecisionAggregatorOptions;
  /** Runtime config options */
  runtimeConfig?: RuntimeConfigOptions;
  /** State provider for constraints */
  stateProvider?: StateProvider;
  /** Default conflict resolution strategy */
  conflictStrategy?: ConflictStrategy;
  /** Enable OpenTelemetry tracing */
  enableTracing?: boolean;
  /** Legacy policy (for backwards compatibility) */
  legacyPolicy?: LegacyEnforcementPolicy;
}

// =============================================================================
// ENFORCEMENT SERVICE
// =============================================================================

/**
 * Unified EnforcementService that orchestrates all enforcement components
 */
export class EnforcementService {
  private policyEngine: PolicyEngine;
  private constraintEvaluator: ConstraintEvaluator;
  private escalationEngine: EscalationRuleEngine;
  private decisionAggregator: DecisionAggregator;
  private runtimeConfig: RuntimeConfig;
  private legacyPolicy: LegacyEnforcementPolicy;
  private options: Required<Pick<EnforcementServiceOptions, 'conflictStrategy' | 'enableTracing'>>;

  constructor(options: EnforcementServiceOptions = {}) {
    this.policyEngine = createPolicyEngine(options.policyEngine);
    this.constraintEvaluator = createConstraintEvaluator(
      options.stateProvider ?? new InMemoryStateProvider(),
      options.constraintEvaluator
    );
    this.escalationEngine = createEscalationRuleEngine(options.escalationEngine);
    this.decisionAggregator = createDecisionAggregator(options.decisionAggregator);
    this.runtimeConfig = createRuntimeConfig(options.runtimeConfig);
    this.legacyPolicy = options.legacyPolicy ?? { defaultAction: 'deny' };
    this.options = {
      conflictStrategy: options.conflictStrategy ?? 'deny-overrides',
      enableTracing: options.enableTracing ?? true,
    };

    logger.info({
      conflictStrategy: this.options.conflictStrategy,
      enableTracing: this.options.enableTracing,
    }, 'Enforcement service initialized');
  }

  /**
   * Make an enforcement decision using all components
   */
  async decide(context: EnforcementContext): Promise<Decision> {
    const startTime = performance.now();
    const { intent, evaluation, trustScore, trustLevel } = context;

    // Check enforcement mode
    const mode = this.runtimeConfig.getEnforcementMode();
    if (mode === 'disabled') {
      return this.createDecision(
        intent.id,
        'allow',
        evaluation.rulesEvaluated,
        trustScore,
        trustLevel
      );
    }

    // Collect decisions from all sources
    const sourceDecisions: SourceDecision[] = [];

    // 1. Legacy policy evaluation
    const legacyDecision = this.evaluateLegacyPolicy(context);
    sourceDecisions.push(createSourceDecision({
      sourceId: 'legacy-policy',
      sourceType: 'policy-engine',
      sourceName: 'Legacy Policy',
      action: legacyDecision.action,
      confidence: 1.0,
      reason: legacyDecision.reason,
    }));

    // 2. Policy engine evaluation
    const policyContext: PolicyEvaluationContext = {
      intent,
      trustScore,
      trustLevel,
      context: intent.context as Record<string, unknown>,
    };

    const policyResults = this.policyEngine.evaluate(policyContext);
    for (const result of policyResults) {
      if (result.matched) {
        sourceDecisions.push(createSourceDecision({
          sourceId: result.policyId,
          sourceType: 'policy-engine',
          sourceName: result.policyName,
          action: result.action,
          confidence: 1.0,
          reason: `Policy matched: ${result.matchedRules.length} rules`,
          constraints: result.appliedConstraints,
          durationMs: result.durationMs,
        }));
      }
    }

    // 3. Constraint evaluation
    const constraintContext: ConstraintEvaluationContext = {
      intent,
      trustScore,
      trustLevel,
      context: intent.context as Record<string, unknown>,
    };

    const constraintResults = await this.constraintEvaluator.evaluateAll(constraintContext);
    for (const result of constraintResults) {
      sourceDecisions.push(createSourceDecision({
        sourceId: result.constraintId,
        sourceType: 'constraint-evaluator',
        sourceName: result.constraintName,
        action: result.action,
        confidence: result.passed ? 1.0 : 0.9,
        reason: result.reason,
        details: result.details,
        durationMs: result.durationMs,
      }));
    }

    // 4. Escalation evaluation
    const escalationContext: EscalationContext = {
      intent,
      trustScore,
      trustLevel,
      context: intent.context as Record<string, unknown>,
    };

    const escalationResult = this.escalationEngine.evaluate(escalationContext);
    if (escalationResult?.matched) {
      sourceDecisions.push(createSourceDecision({
        sourceId: escalationResult.rule.id,
        sourceType: 'escalation-engine',
        sourceName: `Escalation: ${escalationResult.rule.name}`,
        action: 'escalate',
        confidence: 1.0,
        reason: escalationResult.reason,
        details: {
          riskScore: escalationResult.riskScore,
          riskLevel: escalationResult.riskLevel,
          targets: escalationResult.selectedTargets.map(t => t.name),
        },
      }));
    }

    // 5. Aggregate decisions
    const aggregationContext = {
      intent,
      trustScore,
      trustLevel,
      context: intent.context as Record<string, unknown>,
    };

    const aggregatedDecision = await this.decisionAggregator.aggregateWithTracing(
      sourceDecisions,
      aggregationContext,
      this.options.conflictStrategy
    );

    // Apply enforcement mode
    let finalAction = aggregatedDecision.action;
    if (mode === 'permissive' && finalAction === 'deny') {
      logger.info({ intentId: intent.id }, 'Permissive mode - logging violation but allowing');
      finalAction = 'allow';
    } else if (mode === 'shadow' || mode === 'audit-only') {
      logger.info({ intentId: intent.id, wouldBe: finalAction }, 'Shadow/audit mode - not enforcing');
      finalAction = 'allow';
    }

    const durationMs = performance.now() - startTime;

    logger.info({
      intentId: intent.id,
      action: finalAction,
      sourcesCount: sourceDecisions.length,
      hadConflict: aggregatedDecision.conflictResolution?.hadConflict ?? false,
      mode,
      durationMs,
    }, 'Enforcement decision made');

    // Create escalation if needed
    if (finalAction === 'escalate' && escalationResult) {
      const escalationRequest = await this.escalationEngine.createEscalation(
        escalationContext,
        escalationResult
      );

      return {
        intentId: intent.id,
        action: finalAction,
        constraintsEvaluated: this.mapConstraintResults(aggregatedDecision, evaluation),
        trustScore,
        trustLevel,
        escalation: {
          id: escalationRequest.id,
          intentId: intent.id,
          reason: escalationRequest.reason,
          escalatedTo: escalationRequest.escalatedTo,
          timeout: escalationRequest.timeout,
          status: escalationRequest.status,
          createdAt: escalationRequest.createdAt,
        },
        decidedAt: new Date().toISOString(),
      };
    }

    return {
      intentId: intent.id,
      action: finalAction,
      constraintsEvaluated: this.mapConstraintResults(aggregatedDecision, evaluation),
      trustScore,
      trustLevel,
      decidedAt: new Date().toISOString(),
    };
  }

  /**
   * Decide with OpenTelemetry tracing
   */
  async decideWithTracing(context: EnforcementContext): Promise<Decision> {
    if (!this.options.enableTracing) {
      return this.decide(context);
    }

    return withSpan(
      'enforce.decide',
      async (span: TraceSpan) => {
        span.attributes['intent.id'] = context.intent.id;
        span.attributes['intent.goal'] = context.intent.goal;
        span.attributes['trust.level'] = context.trustLevel;
        span.attributes['trust.score'] = context.trustScore;
        span.attributes['enforcement.mode'] = this.runtimeConfig.getEnforcementMode();

        const decision = await this.decide(context);

        span.attributes['decision.action'] = decision.action;
        span.attributes['decision.hasEscalation'] = !!decision.escalation;

        return decision;
      },
      { 'tenant.id': context.intent.tenantId }
    );
  }

  /**
   * Evaluate legacy policy for backwards compatibility
   */
  private evaluateLegacyPolicy(context: EnforcementContext): { action: ControlAction; reason: string } {
    const { intent, evaluation, trustLevel } = context;

    // Check minimum trust level
    if (
      this.legacyPolicy.requireMinTrustLevel !== undefined &&
      trustLevel < this.legacyPolicy.requireMinTrustLevel
    ) {
      return {
        action: 'deny',
        reason: `Trust level ${trustLevel} insufficient, requires ${this.legacyPolicy.requireMinTrustLevel}`,
      };
    }

    // Use evaluation result action
    const action = evaluation.passed ? 'allow' : evaluation.finalAction;
    return {
      action,
      reason: evaluation.passed ? 'All rules passed' : 'Rules violated',
    };
  }

  /**
   * Map aggregated decision to constraint evaluation results
   */
  private mapConstraintResults(
    aggregated: AggregatedDecision,
    evaluation: EvaluationResult
  ): Decision['constraintsEvaluated'] {
    const results: Decision['constraintsEvaluated'] = [];

    // Include BASIS evaluation results
    for (const rule of evaluation.rulesEvaluated) {
      results.push({
        constraintId: rule.ruleId,
        passed: rule.matched,
        action: rule.action,
        reason: rule.reason,
        details: rule.details,
        durationMs: rule.durationMs,
        evaluatedAt: evaluation.evaluatedAt,
      });
    }

    // Include source decisions
    for (const source of aggregated.sourceDecisions) {
      results.push({
        constraintId: source.sourceId,
        passed: source.action === aggregated.action || source.action === 'allow',
        action: source.action,
        reason: source.reason,
        details: source.details ?? {},
        durationMs: source.durationMs ?? 0,
        evaluatedAt: source.decidedAt,
      });
    }

    return results;
  }

  /**
   * Create a decision record
   */
  private createDecision(
    intentId: ID,
    action: ControlAction,
    rulesEvaluated: RuleResult[],
    trustScore: TrustScore,
    trustLevel: TrustLevel
  ): Decision {
    return {
      intentId,
      action,
      constraintsEvaluated: rulesEvaluated.map((r) => ({
        constraintId: r.ruleId,
        passed: r.matched,
        action: r.action,
        reason: r.reason,
        details: r.details,
        durationMs: r.durationMs,
        evaluatedAt: new Date().toISOString(),
      })),
      trustScore,
      trustLevel,
      decidedAt: new Date().toISOString(),
    };
  }

  // =============================================================================
  // COMPONENT ACCESS
  // =============================================================================

  /**
   * Get the policy engine
   */
  getPolicyEngine(): PolicyEngine {
    return this.policyEngine;
  }

  /**
   * Get the constraint evaluator
   */
  getConstraintEvaluator(): ConstraintEvaluator {
    return this.constraintEvaluator;
  }

  /**
   * Get the escalation engine
   */
  getEscalationEngine(): EscalationRuleEngine {
    return this.escalationEngine;
  }

  /**
   * Get the decision aggregator
   */
  getDecisionAggregator(): DecisionAggregator {
    return this.decisionAggregator;
  }

  /**
   * Get the runtime config
   */
  getRuntimeConfig(): RuntimeConfig {
    return this.runtimeConfig;
  }

  // =============================================================================
  // POLICY MANAGEMENT (convenience methods)
  // =============================================================================

  /**
   * Add an enforcement policy
   */
  addPolicy(policy: EnforcementPolicy): void {
    this.policyEngine.addPolicy(policy);
  }

  /**
   * Add a constraint
   */
  addConstraint(constraint: Constraint): void {
    this.constraintEvaluator.addConstraint(constraint);
  }

  /**
   * Add an escalation rule
   */
  addEscalationRule(rule: EscalationRule): void {
    this.escalationEngine.addRule(rule);
  }

  /**
   * Set enforcement mode
   */
  setEnforcementMode(mode: EnforcementMode): void {
    this.runtimeConfig.setEnforcementMode(mode, 'enforcement-service');
  }

  /**
   * Get enforcement mode
   */
  getEnforcementMode(): EnforcementMode {
    return this.runtimeConfig.getEnforcementMode();
  }

  /**
   * Update legacy enforcement policy
   */
  setPolicy(policy: LegacyEnforcementPolicy): void {
    this.legacyPolicy = policy;
    logger.info({ policy }, 'Legacy enforcement policy updated');
  }

  /**
   * Check if a feature flag is enabled
   */
  isFeatureEnabled(flagId: ID, context?: { entityId?: ID; tenantId?: ID }): boolean {
    return this.runtimeConfig.isFeatureEnabled(flagId, context);
  }

  // =============================================================================
  // STATISTICS
  // =============================================================================

  /**
   * Get service statistics
   */
  getStats(): {
    policyEngine: ReturnType<PolicyEngine['getStats']>;
    constraintEvaluator: ReturnType<ConstraintEvaluator['getStats']>;
    escalationEngine: ReturnType<EscalationRuleEngine['getStats']>;
    decisionAggregator: ReturnType<DecisionAggregator['getStats']>;
    runtimeConfig: ReturnType<RuntimeConfig['getStats']>;
  } {
    return {
      policyEngine: this.policyEngine.getStats(),
      constraintEvaluator: this.constraintEvaluator.getStats(),
      escalationEngine: this.escalationEngine.getStats(),
      decisionAggregator: this.decisionAggregator.getStats(),
      runtimeConfig: this.runtimeConfig.getStats(),
    };
  }

  /**
   * Clear all components
   */
  clear(): void {
    this.policyEngine.clear();
    this.constraintEvaluator.clear();
    this.escalationEngine.clear();
    this.decisionAggregator.clearAudit();
    this.runtimeConfig.clear();
    logger.info('Enforcement service cleared');
  }
}

/**
 * Create a new enforcement service instance
 */
export function createEnforcementService(
  options?: EnforcementServiceOptions
): EnforcementService {
  return new EnforcementService(options);
}

// =============================================================================
// BACKWARDS COMPATIBILITY EXPORTS
// =============================================================================

// Keep the old EnforcementPolicy interface name for compatibility
export type EnforcementPolicy_Legacy = LegacyEnforcementPolicy;

// Export EscalationRule type for backwards compatibility
export type EscalationRule_Legacy = LegacyEscalationRule;
