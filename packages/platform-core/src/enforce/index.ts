/**
 * ENFORCE - Policy Decision Point with Fluid Governance
 *
 * Makes enforcement decisions based on rule evaluations and trust levels.
 * Supports three-tier fluid governance (GREEN/YELLOW/RED) with refinement
 * options for agents to modify requests.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import type {
  Intent,
  ControlAction,
  TrustLevel,
  TrustScore,
  ID,
} from '../common/types.js';
import type { EvaluationResult, RuleResult } from '../basis/types.js';
import {
  type DecisionRepository,
  type Decision,
  type DecisionConstraints,
  type RefinementOption,
  type WorkflowInstance,
  type CreateDecisionInput,
  createDecisionRepository,
} from './repository.js';
import {
  toCanonicalFluidDecision,
  toCanonicalWorkflow,
  parseTrustBand,
  trustBandToString,
} from './adapters.js';
import type { EscalationService } from '../intent/escalation.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

const logger = createLogger({ component: 'enforce' });
const tracer = trace.getTracer('enforce');

// =============================================================================
// TYPES
// =============================================================================

/**
 * Decision tier for fluid governance
 */
export type DecisionTier = 'GREEN' | 'YELLOW' | 'RED';

/**
 * Enforcement context combining intent and evaluation results
 */
export interface EnforcementContext {
  intent: Intent;
  evaluation: EvaluationResult;
  trustScore: TrustScore;
  trustLevel: TrustLevel;
  tenantId: ID;
  correlationId?: ID;
}

/**
 * Enforcement policy configuration
 */
export interface EnforcementPolicy {
  /** Default action when no rules match */
  defaultAction: ControlAction;
  /** Minimum trust level required */
  requireMinTrustLevel?: TrustLevel;
  /** Trust level thresholds for automatic approval */
  trustThresholds?: {
    /** Auto-approve GREEN if trust level >= this */
    autoApproveLevel: TrustLevel;
    /** Force YELLOW (refinement) if trust level < this */
    requireRefinementLevel: TrustLevel;
    /** Force RED (deny) if trust level < this */
    autoDenyLevel: TrustLevel;
  };
  /** Escalation rules */
  escalationRules?: EscalationRule[];
  /** Default constraints for GREEN decisions */
  defaultConstraints?: Partial<DecisionConstraintsConfig>;
  /** Decision expiration time in milliseconds */
  decisionExpirationMs?: number;
  /** Refinement deadline in milliseconds */
  refinementDeadlineMs?: number;
  /** Maximum refinement attempts */
  maxRefinementAttempts?: number;
}

/**
 * Escalation rule definition
 */
export interface EscalationRule {
  /** Condition expression */
  condition: string;
  /** Who to escalate to */
  escalateTo: string;
  /** Timeout duration (ISO 8601) */
  timeout: string;
  /** Reason category */
  reasonCategory?: 'trust_insufficient' | 'high_risk' | 'policy_violation' | 'manual_review';
}

/**
 * Decision constraints configuration
 */
export interface DecisionConstraintsConfig {
  allowedTools: string[];
  dataScopes: string[];
  rateLimits: Array<{
    resource: string;
    limit: number;
    windowSeconds: number;
  }>;
  requiredApprovals: Array<{
    type: 'none' | 'human_review' | 'automated_check' | 'multi_party';
    approver: string;
    timeoutMs?: number;
    reason: string;
  }>;
  reversibilityRequired: boolean;
  maxExecutionTimeMs?: number;
  maxRetries?: number;
  resourceQuotas?: Record<string, number>;
}

/**
 * Fluid decision result with workflow tracking
 */
export interface FluidDecisionResult {
  decision: Decision;
  workflow: WorkflowInstance;
  tier: DecisionTier;
  /** Action derived from tier: GREEN->allow, RED->deny, YELLOW->escalate */
  action: ControlAction;
  /** Whether constraints were evaluated */
  constraintsEvaluated: boolean;
  refinementOptions?: RefinementOption[];
}

/**
 * Convert decision tier to control action
 */
function tierToAction(tier: DecisionTier): ControlAction {
  switch (tier) {
    case 'GREEN': return 'allow';
    case 'RED': return 'deny';
    case 'YELLOW': return 'escalate';
  }
}

/**
 * Refinement request
 */
export interface RefinementRequest {
  decisionId: ID;
  selectedRefinements: ID[];
  refinementContext?: Record<string, unknown>;
  modifiedIntent?: Partial<{
    goal: string;
    resourceScope: string[];
    dataSensitivity: string;
    reversibility: string;
    context: Record<string, unknown>;
  }>;
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_POLICY: EnforcementPolicy = {
  defaultAction: 'deny',
  trustThresholds: {
    autoApproveLevel: 4, // T4_STANDARD and above get auto-GREEN
    requireRefinementLevel: 2, // T2_PROVISIONAL and below get YELLOW
    autoDenyLevel: 0, // Only T0_SANDBOX gets auto-RED
  },
  decisionExpirationMs: 3600000, // 1 hour
  refinementDeadlineMs: 900000, // 15 minutes
  maxRefinementAttempts: 3,
};

const DEFAULT_CONSTRAINTS: DecisionConstraintsConfig = {
  allowedTools: ['*'],
  dataScopes: ['*'],
  rateLimits: [],
  requiredApprovals: [],
  reversibilityRequired: false,
  maxRetries: 3,
};

// =============================================================================
// ENFORCEMENT SERVICE
// =============================================================================

/**
 * Policy enforcement service with fluid governance
 */
export class EnforcementService {
  private policy: EnforcementPolicy;
  private repository: DecisionRepository | null = null;
  private escalationService: EscalationService | null = null;

  constructor(policy?: EnforcementPolicy) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  /**
   * Initialize with database connection
   */
  initialize(db: PostgresJsDatabase, escalationService?: EscalationService): void {
    this.repository = createDecisionRepository(db);
    this.escalationService = escalationService ?? null;
    logger.info('EnforcementService initialized with persistence');
  }

  /**
   * Make an enforcement decision with fluid governance
   */
  async decide(context: EnforcementContext): Promise<FluidDecisionResult> {
    return tracer.startActiveSpan('enforce.decide', async (span: Span) => {
      const startTime = Date.now();
      const { intent, evaluation, trustScore, trustLevel, tenantId } = context;
      const correlationId = context.correlationId ?? intent.correlationId ?? crypto.randomUUID();

      span.setAttributes({
        'intent.id': intent.id,
        'intent.goal': intent.goal,
        'trust.score': trustScore,
        'trust.level': trustLevel,
        'tenant.id': tenantId,
      });

      try {
        // Determine decision tier
        const tier = this.determineTier(evaluation, trustLevel);
        span.setAttribute('decision.tier', tier);

        // Build decision
        const decisionInput = await this.buildDecisionInput(
          context,
          tier,
          correlationId,
          startTime
        );

        // Create workflow if we have persistence
        let workflow: WorkflowInstance | null = null;
        let decision: Decision;

        if (this.repository) {
          // Create or get existing workflow
          workflow = await this.repository.getWorkflowByIntent(intent.id, tenantId);
          if (!workflow) {
            workflow = await this.repository.createWorkflow({
              tenantId,
              intentId: intent.id,
              agentId: intent.entityId,
              correlationId,
              state: 'EVALUATING',
              stateHistory: [],
              expiresAt: new Date(Date.now() + (this.policy.decisionExpirationMs ?? 3600000)),
            });
          }

          // Persist decision
          decision = await this.repository.createDecision(decisionInput);

          // Update workflow state based on tier
          const newState = this.tierToWorkflowState(tier);
          await this.repository.updateWorkflowState(
            workflow.id,
            tenantId,
            newState,
            `Decision ${tier}: ${decision.reasoning[0] ?? 'No reason'}`,
            decision.id
          );

          // Refresh workflow
          workflow = await this.repository.getWorkflowByIntent(intent.id, tenantId);
        } else {
          // In-memory decision (no persistence)
          const decisionId = crypto.randomUUID() as ID;
          const now = new Date().toISOString();

          // Build full constraints if present
          const fullConstraints: DecisionConstraints | undefined = decisionInput.constraints ? {
            id: crypto.randomUUID() as ID,
            decisionId,
            tenantId,
            createdAt: now,
            allowedTools: decisionInput.constraints.allowedTools ?? [],
            dataScopes: decisionInput.constraints.dataScopes ?? [],
            rateLimits: decisionInput.constraints.rateLimits ?? [],
            requiredApprovals: decisionInput.constraints.requiredApprovals ?? [],
            reversibilityRequired: decisionInput.constraints.reversibilityRequired ?? false,
            maxExecutionTimeMs: decisionInput.constraints.maxExecutionTimeMs ?? null,
            maxRetries: decisionInput.constraints.maxRetries,
            resourceQuotas: decisionInput.constraints.resourceQuotas ?? null,
          } : undefined;

          decision = {
            id: decisionId,
            version: 1,
            tenantId,
            intentId: intent.id,
            agentId: intent.entityId,
            correlationId,
            permitted: decisionInput.permitted,
            tier: decisionInput.tier,
            trustBand: decisionInput.trustBand,
            trustScore: decisionInput.trustScore,
            policySetId: decisionInput.policySetId ?? null,
            reasoning: decisionInput.reasoning,
            denialReason: decisionInput.denialReason ?? null,
            hardDenial: decisionInput.hardDenial,
            violatedPolicies: decisionInput.violatedPolicies ?? null,
            refinementDeadline: decisionInput.refinementDeadline?.toISOString() ?? null,
            maxRefinementAttempts: decisionInput.maxRefinementAttempts,
            refinementAttempt: decisionInput.refinementAttempt ?? 0,
            originalDecisionId: decisionInput.originalDecisionId ?? null,
            appliedRefinements: null,
            latencyMs: decisionInput.latencyMs,
            decidedAt: now,
            createdAt: now,
            expiresAt: decisionInput.expiresAt.toISOString(),
            constraints: fullConstraints ?? null,
            refinementOptions: decisionInput.refinementOptions?.map((opt, i) => ({
              id: crypto.randomUUID() as ID,
              decisionId,
              tenantId,
              action: opt.action,
              description: opt.description,
              successProbability: opt.successProbability,
              effort: opt.effort,
              parameters: opt.parameters ?? null,
              resultingConstraints: opt.resultingConstraints ?? null,
              selected: false,
              appliedAt: null,
              createdAt: now,
            })),
          };

          // Create mock workflow
          workflow = {
            id: crypto.randomUUID(),
            tenantId,
            intentId: intent.id,
            agentId: intent.entityId,
            correlationId,
            state: this.tierToWorkflowState(tier),
            currentDecisionId: decision.id,
            stateHistory: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          };
        }

        // Handle escalation for YELLOW decisions that need human review
        if (tier === 'YELLOW' && this.escalationService && this.shouldEscalate(evaluation, trustLevel)) {
          await this.createEscalation(intent, decision, tenantId);
        }

        const latencyMs = Date.now() - startTime;
        span.setAttribute('decision.latency_ms', latencyMs);

        logger.info(
          {
            decisionId: decision.id,
            intentId: intent.id,
            tier,
            permitted: decision.permitted,
            latencyMs,
          },
          'Enforcement decision made'
        );

        span.setStatus({ code: SpanStatusCode.OK });

        const result: FluidDecisionResult = {
          decision,
          workflow: workflow!,
          tier,
          action: tierToAction(tier),
          constraintsEvaluated: !!decision.constraints,
          refinementOptions: decision.refinementOptions,
        };
        return result;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Process a refinement request for a YELLOW decision
   */
  async refine(
    request: RefinementRequest,
    tenantId: ID
  ): Promise<FluidDecisionResult | null> {
    if (!this.repository) {
      logger.warn('Cannot refine without persistence');
      return null;
    }

    return tracer.startActiveSpan('enforce.refine', async (span: Span) => {
      const startTime = Date.now();

      span.setAttributes({
        'decision.id': request.decisionId,
        'refinements.count': request.selectedRefinements.length,
      });

      // Get original decision
      const originalDecision = await this.repository!.getDecision(request.decisionId, tenantId);
      if (!originalDecision) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'Decision not found' });
        span.end();
        return null;
      }

      // Verify it's a YELLOW decision
      if (originalDecision.tier !== 'YELLOW') {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'Only YELLOW decisions can be refined' });
        span.end();
        return null;
      }

      // Check refinement attempts
      if (originalDecision.refinementAttempt >= (originalDecision.maxRefinementAttempts ?? 3)) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'Max refinement attempts reached' });
        span.end();
        return null;
      }

      // Apply selected refinements
      for (const refinementId of request.selectedRefinements) {
        await this.repository!.applyRefinement(request.decisionId, refinementId, tenantId);
      }

      // Create new refined decision (upgrade to GREEN if refinements are sufficient)
      const newTier: DecisionTier = this.evaluateRefinements(originalDecision, request) ? 'GREEN' : 'YELLOW';

      const refinedDecisionInput: CreateDecisionInput = {
        tenantId,
        intentId: originalDecision.intentId,
        agentId: originalDecision.agentId,
        correlationId: originalDecision.correlationId,
        permitted: newTier === 'GREEN',
        tier: newTier,
        trustBand: originalDecision.trustBand,
        trustScore: originalDecision.trustScore,
        policySetId: originalDecision.policySetId ?? undefined,
        reasoning: [
          `Refined from decision ${originalDecision.id}`,
          `Applied refinements: ${request.selectedRefinements.join(', ')}`,
        ],
        refinementAttempt: originalDecision.refinementAttempt + 1,
        originalDecisionId: originalDecision.id,
        latencyMs: Date.now() - startTime,
        expiresAt: new Date(Date.now() + (this.policy.decisionExpirationMs ?? 3600000)),
        constraints: newTier === 'GREEN' ? this.buildConstraints(originalDecision) : undefined,
      };

      const refinedDecision = await this.repository!.createDecision(refinedDecisionInput);

      // Update workflow
      const workflow = await this.repository!.getWorkflowByIntent(originalDecision.intentId, tenantId);
      if (workflow) {
        await this.repository!.updateWorkflowState(
          workflow.id,
          tenantId,
          this.tierToWorkflowState(newTier),
          `Refined to ${newTier}`,
          refinedDecision.id
        );
      }

      span.setAttribute('decision.new_tier', newTier);
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();

      const updatedWorkflow = await this.repository!.getWorkflowByIntent(originalDecision.intentId, tenantId);

      return {
        decision: refinedDecision,
        workflow: updatedWorkflow!,
        tier: newTier,
        action: tierToAction(newTier),
        constraintsEvaluated: !!refinedDecision.constraints,
        refinementOptions: refinedDecision.refinementOptions,
      };
    });
  }

  /**
   * Get decision by ID
   */
  async getDecision(id: ID, tenantId: ID): Promise<Decision | null> {
    if (!this.repository) return null;
    return this.repository.getDecision(id, tenantId);
  }

  /**
   * Get workflow by intent ID
   */
  async getWorkflow(intentId: ID, tenantId: ID): Promise<WorkflowInstance | null> {
    if (!this.repository) return null;
    return this.repository.getWorkflowByIntent(intentId, tenantId);
  }

  /**
   * Update enforcement policy
   */
  setPolicy(policy: EnforcementPolicy): void {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    logger.info({ policy: this.policy }, 'Enforcement policy updated');
  }

  // ---------------------------------------------------------------------------
  // PRIVATE METHODS
  // ---------------------------------------------------------------------------

  /**
   * Determine decision tier based on evaluation and trust
   */
  private determineTier(evaluation: EvaluationResult, trustLevel: TrustLevel): DecisionTier {
    const thresholds = this.policy.trustThresholds ?? DEFAULT_POLICY.trustThresholds!;

    // Check for hard policy violations (RED)
    const hasHardViolation = evaluation.violatedRules.some(
      (r) => r.action === 'deny' || r.action === 'terminate'
    );
    if (hasHardViolation) {
      return 'RED';
    }

    // Check trust level thresholds
    if (trustLevel < thresholds.autoDenyLevel) {
      return 'RED';
    }

    if (trustLevel < thresholds.requireRefinementLevel) {
      return 'YELLOW';
    }

    // Check for soft violations that need refinement
    const hasSoftViolation = evaluation.violatedRules.some(
      (r) => r.action === 'escalate' || r.action === 'limit'
    );
    if (hasSoftViolation) {
      return 'YELLOW';
    }

    // All checks passed
    if (trustLevel >= thresholds.autoApproveLevel && evaluation.passed) {
      return 'GREEN';
    }

    // Default to YELLOW for borderline cases
    return 'YELLOW';
  }

  /**
   * Build decision input from context
   */
  private async buildDecisionInput(
    context: EnforcementContext,
    tier: DecisionTier,
    correlationId: ID,
    startTime: number
  ): Promise<CreateDecisionInput> {
    const { intent, evaluation, trustScore, trustLevel, tenantId } = context;
    const trustBand = this.trustLevelToTrustBand(trustLevel);

    const reasoning = this.buildReasoning(evaluation, tier, trustLevel);
    const denialReason = tier === 'RED' ? this.determineDenialReason(evaluation, trustLevel) : undefined;

    const input: CreateDecisionInput = {
      tenantId,
      intentId: intent.id,
      agentId: intent.entityId,
      correlationId,
      permitted: tier === 'GREEN',
      tier,
      trustBand,
      trustScore,
      reasoning,
      denialReason,
      hardDenial: tier === 'RED' && denialReason === 'policy_violation',
      violatedPolicies: tier === 'RED' ? this.extractViolatedPolicies(evaluation) : undefined,
      latencyMs: Date.now() - startTime,
      expiresAt: new Date(Date.now() + (this.policy.decisionExpirationMs ?? 3600000)),
    };

    // Add constraints for GREEN decisions
    if (tier === 'GREEN') {
      input.constraints = this.buildConstraintsFromEvaluation(evaluation);
    }

    // Add refinement options for YELLOW decisions
    if (tier === 'YELLOW') {
      input.refinementDeadline = new Date(Date.now() + (this.policy.refinementDeadlineMs ?? 900000));
      input.maxRefinementAttempts = this.policy.maxRefinementAttempts ?? 3;
      input.refinementOptions = this.generateRefinementOptions(evaluation, trustLevel);
    }

    return input;
  }

  /**
   * Build reasoning array for decision
   */
  private buildReasoning(evaluation: EvaluationResult, tier: DecisionTier, trustLevel: TrustLevel): string[] {
    const reasons: string[] = [];

    if (tier === 'GREEN') {
      reasons.push('All policy checks passed');
      reasons.push(`Trust level T${trustLevel} meets requirements`);
    } else if (tier === 'YELLOW') {
      if (evaluation.violatedRules.length > 0) {
        reasons.push(`${evaluation.violatedRules.length} policy check(s) require attention`);
      }
      reasons.push('Refinement options available to achieve approval');
    } else {
      if (evaluation.violatedRules.length > 0) {
        const violations = evaluation.violatedRules.map((r) => r.ruleName).join(', ');
        reasons.push(`Policy violations: ${violations}`);
      }
      reasons.push('Request cannot proceed as submitted');
    }

    return reasons;
  }

  /**
   * Determine denial reason for RED decisions
   */
  private determineDenialReason(evaluation: EvaluationResult, trustLevel: TrustLevel): string {
    if (trustLevel < (this.policy.trustThresholds?.autoDenyLevel ?? 0)) {
      return 'insufficient_trust';
    }

    const hasDataViolation = evaluation.violatedRules.some(
      (r) => r.details?.type === 'data_sensitivity'
    );
    if (hasDataViolation) {
      return 'data_sensitivity_exceeded';
    }

    const hasResourceViolation = evaluation.violatedRules.some(
      (r) => r.details?.type === 'resource_access'
    );
    if (hasResourceViolation) {
      return 'resource_restricted';
    }

    return 'policy_violation';
  }

  /**
   * Extract violated policies for RED decisions
   */
  private extractViolatedPolicies(evaluation: EvaluationResult): Array<{
    policyId: string;
    policyName: string;
    severity: 'warning' | 'error' | 'critical';
  }> {
    return evaluation.violatedRules.map((r) => ({
      policyId: r.ruleId,
      policyName: r.ruleName,
      severity: r.action === 'terminate' ? 'critical' : r.action === 'deny' ? 'error' : 'warning',
    }));
  }

  /**
   * Build constraints from evaluation results
   */
  private buildConstraintsFromEvaluation(
    evaluation: EvaluationResult
  ): Omit<DecisionConstraints, 'id' | 'decisionId' | 'tenantId' | 'createdAt'> {
    const defaults = this.policy.defaultConstraints ?? DEFAULT_CONSTRAINTS;

    // Extract rate limits from rule results
    const rateLimits = evaluation.rulesEvaluated
      .filter((r) => r.action === 'limit' && r.details?.rateLimit)
      .map((r) => r.details.rateLimit as { resource: string; limit: number; windowSeconds: number });

    return {
      allowedTools: defaults.allowedTools ?? ['*'],
      dataScopes: defaults.dataScopes ?? ['*'],
      rateLimits: rateLimits.length > 0 ? rateLimits : defaults.rateLimits ?? [],
      requiredApprovals: defaults.requiredApprovals ?? [],
      reversibilityRequired: defaults.reversibilityRequired ?? false,
      maxExecutionTimeMs: defaults.maxExecutionTimeMs,
      maxRetries: defaults.maxRetries ?? 3,
      resourceQuotas: defaults.resourceQuotas,
    };
  }

  /**
   * Build constraints for a decision
   */
  private buildConstraints(
    decision: Decision
  ): Omit<DecisionConstraints, 'id' | 'decisionId' | 'tenantId' | 'createdAt'> {
    if (decision.constraints) {
      return {
        allowedTools: decision.constraints.allowedTools,
        dataScopes: decision.constraints.dataScopes,
        rateLimits: decision.constraints.rateLimits,
        requiredApprovals: decision.constraints.requiredApprovals,
        reversibilityRequired: decision.constraints.reversibilityRequired,
        maxExecutionTimeMs: decision.constraints.maxExecutionTimeMs ?? undefined,
        maxRetries: decision.constraints.maxRetries,
        resourceQuotas: decision.constraints.resourceQuotas ?? undefined,
      };
    }
    return this.buildConstraintsFromEvaluation({ passed: true, finalAction: 'allow', rulesEvaluated: [], violatedRules: [], totalDurationMs: 0, evaluatedAt: new Date().toISOString() });
  }

  /**
   * Generate refinement options for YELLOW decisions
   */
  private generateRefinementOptions(
    evaluation: EvaluationResult,
    trustLevel: TrustLevel
  ): Array<Omit<RefinementOption, 'id' | 'decisionId' | 'tenantId' | 'createdAt' | 'selected' | 'appliedAt'>> {
    const options: Array<Omit<RefinementOption, 'id' | 'decisionId' | 'tenantId' | 'createdAt' | 'selected' | 'appliedAt'>> = [];

    // Suggest reducing scope if there are resource violations
    const hasResourceViolations = evaluation.violatedRules.some(
      (r) => r.details?.type === 'resource_access'
    );
    if (hasResourceViolations) {
      options.push({
        action: 'REDUCE_SCOPE',
        description: 'Reduce the scope of resources being accessed',
        successProbability: 0.8,
        effort: 'low',
        parameters: { suggestedScopes: ['read-only', 'limited'] },
      });
    }

    // Suggest adding constraints
    options.push({
      action: 'ADD_CONSTRAINTS',
      description: 'Accept additional constraints on execution',
      successProbability: 0.9,
      effort: 'low',
      resultingConstraints: {
        maxExecutionTimeMs: 30000,
        reversibilityRequired: true,
      },
    });

    // Suggest human approval for low trust
    if (trustLevel < 3) {
      options.push({
        action: 'REQUEST_APPROVAL',
        description: 'Request human approval for this action',
        successProbability: 0.7,
        effort: 'medium',
        parameters: { approverRole: 'admin' },
      });
    }

    // Suggest providing more context
    options.push({
      action: 'PROVIDE_CONTEXT',
      description: 'Provide additional justification or context',
      successProbability: 0.6,
      effort: 'medium',
    });

    // Suggest waiting for trust to improve
    if (trustLevel < 4) {
      options.push({
        action: 'WAIT_FOR_TRUST',
        description: 'Wait for trust score to improve through successful actions',
        successProbability: 0.5,
        effort: 'high',
        parameters: { estimatedTimeMs: 86400000 },
      });
    }

    return options;
  }

  /**
   * Evaluate if refinements are sufficient to upgrade to GREEN
   */
  private evaluateRefinements(decision: Decision, request: RefinementRequest): boolean {
    // Simple heuristic: if constraints were added or scope was reduced, approve
    const refinementOptions = decision.refinementOptions ?? [];
    const selectedOptions = refinementOptions.filter((opt) =>
      request.selectedRefinements.includes(opt.id)
    );

    // Check if any high-success-probability refinements were selected
    const hasHighSuccessRefinement = selectedOptions.some((opt) => opt.successProbability >= 0.8);

    // Check if human approval was requested
    const hasApprovalRequest = selectedOptions.some((opt) => opt.action === 'REQUEST_APPROVAL');

    return hasHighSuccessRefinement || hasApprovalRequest;
  }

  /**
   * Check if we should create an escalation
   */
  private shouldEscalate(evaluation: EvaluationResult, trustLevel: TrustLevel): boolean {
    // Escalate if any rule requested escalation
    const hasEscalateAction = evaluation.violatedRules.some((r) => r.action === 'escalate');
    if (hasEscalateAction) return true;

    // Escalate if trust is very low
    if (trustLevel < 2) return true;

    // Check escalation rules
    if (this.policy.escalationRules && this.policy.escalationRules.length > 0) {
      return true; // Let the escalation service evaluate the rules
    }

    return false;
  }

  /**
   * Create an escalation for a decision
   */
  private async createEscalation(intent: Intent, decision: Decision, tenantId: ID): Promise<void> {
    if (!this.escalationService) return;

    try {
      await this.escalationService.create({ tenantId } as any, {
        intentId: intent.id,
        reason: decision.reasoning.join('; '),
        reasonCategory: 'manual_review',
        escalatedTo: 'admin',
        timeout: 'PT15M', // 15 minutes
        context: {
          decisionId: decision.id,
          tier: decision.tier,
          trustScore: decision.trustScore,
        },
      });

      logger.info(
        { intentId: intent.id, decisionId: decision.id },
        'Escalation created for YELLOW decision'
      );
    } catch (error) {
      logger.error({ error, intentId: intent.id }, 'Failed to create escalation');
    }
  }

  /**
   * Convert workflow state based on decision tier
   */
  private tierToWorkflowState(tier: DecisionTier): string {
    switch (tier) {
      case 'GREEN':
        return 'APPROVED';
      case 'YELLOW':
        return 'PENDING_REFINEMENT';
      case 'RED':
        return 'DENIED';
    }
  }

  /**
   * Convert trust level to trust band string
   */
  private trustLevelToTrustBand(level: TrustLevel): string {
    const bands: Record<TrustLevel, string> = {
      0: 'T0_SANDBOX',
      1: 'T1_OBSERVED',
      2: 'T2_PROVISIONAL',
      3: 'T3_MONITORED',
      4: 'T4_STANDARD',
      5: 'T5_TRUSTED',
      6: 'T6_CERTIFIED',
      7: 'T7_AUTONOMOUS',
    };
    return bands[level] ?? 'T0_SANDBOX';
  }
}

/**
 * Create a new enforcement service instance
 */
export function createEnforcementService(policy?: EnforcementPolicy): EnforcementService {
  return new EnforcementService(policy);
}

// Re-export types and adapters
export type { Decision, DecisionConstraints, RefinementOption, WorkflowInstance } from './repository.js';
export { DecisionRepository, createDecisionRepository } from './repository.js';
export * from './adapters.js';
