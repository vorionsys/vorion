/**
 * Trust-Aware Enforcement Service
 *
 * Production-quality enforcement service that provides:
 * - Real-time trust score lookups via TrustEngine
 * - Three-tier fluid governance (GREEN/YELLOW/RED)
 * - Configurable trust thresholds for automatic decisions
 * - Risk-based constraint computation from intent metadata
 * - Refinement workflow with attempt tracking
 * - Tenant isolation and decision expiration
 *
 * Replaces MockEnforcementService for production use.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';
import type { ID, TrustLevel, TrustScore } from '../common/types.js';
import type { TrustEngine } from '../trust-engine/index.js';
import { TRUST_LEVEL_NAMES, TRUST_THRESHOLDS } from '../trust-engine/index.js';
import type {
  IEnforcementService,
  EnforcementContext,
  EnforcementPolicy,
  FluidDecision,
  FluidDecisionResult,
  DecisionTier,
  DecisionConstraints,
  RefinementOption,
  RefinementRequest,
  WorkflowInstance,
  WorkflowState,
} from './index.js';

const logger = createLogger({ component: 'trust-aware-enforcement' });

// =============================================================================
// RISK CLASSIFICATION
// =============================================================================

/**
 * Risk level computed from intent metadata.
 * Used to determine constraint strictness.
 */
type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// =============================================================================
// SECURITY POLICY ENGINE INTERFACE
// =============================================================================

/**
 * Input for policy evaluation.
 * Minimal interface to avoid hard dependency on @vorionsys/security.
 */
export interface PolicyEvaluationInput {
  intent: import('../common/types.js').Intent;
  trustScore: import('../common/types.js').TrustScore;
  trustLevel: import('../common/types.js').TrustLevel;
  context?: Record<string, unknown>;
}

/**
 * A violation detected by the security policy engine.
 */
export interface PolicyViolation {
  policyId: string;
  policyName: string;
  action: 'deny' | 'escalate' | 'limit' | 'monitor';
  reason: string;
}

/**
 * Interface for security policy engine integration.
 * The full SecurityPolicyEngine from @vorionsys/security satisfies this interface.
 * Defined locally to avoid hard dependency in the public SDK package.
 */
export interface IPolicyEngine {
  evaluate(context: PolicyEvaluationInput): PolicyViolation[];
}

/**
 * Compute risk level from intent metadata fields.
 */
function computeRiskLevel(context: EnforcementContext): RiskLevel {
  const intent = context.intent;

  // Irreversible + high sensitivity = critical
  if (intent.reversibility === 'IRREVERSIBLE' && intent.dataSensitivity === 'RESTRICTED') {
    return 'critical';
  }

  // Delete/execute with restricted data = high
  if (
    (intent.actionType === 'delete' || intent.actionType === 'execute') &&
    (intent.dataSensitivity === 'RESTRICTED' || intent.dataSensitivity === 'CONFIDENTIAL')
  ) {
    return 'high';
  }

  // Irreversible actions = high
  if (intent.reversibility === 'IRREVERSIBLE') {
    return 'high';
  }

  // Write/transfer with confidential data = medium
  if (
    (intent.actionType === 'write' || intent.actionType === 'transfer') &&
    intent.dataSensitivity === 'CONFIDENTIAL'
  ) {
    return 'medium';
  }

  // Read-only or public data = low
  if (intent.actionType === 'read' || intent.dataSensitivity === 'PUBLIC') {
    return 'low';
  }

  return 'medium';
}

// =============================================================================
// CONSTRAINT COMPUTATION
// =============================================================================

/**
 * Build constraints based on risk level and trust.
 */
function buildConstraints(
  riskLevel: RiskLevel,
  trustLevel: TrustLevel,
  policy: Required<Omit<TrustAwareEnforcementConfig, 'policyEngine'>>,
  defaultConstraints?: Partial<DecisionConstraints>,
): DecisionConstraints {
  const base: DecisionConstraints = {
    allowedTools: defaultConstraints?.allowedTools ?? ['*'],
    dataScopes: defaultConstraints?.dataScopes ?? ['*'],
    rateLimits: defaultConstraints?.rateLimits ?? [],
    requiredApprovals: defaultConstraints?.requiredApprovals ?? [],
    reversibilityRequired: false,
    maxRetries: 3,
  };

  // Tighten constraints based on risk
  if (riskLevel === 'critical' || riskLevel === 'high') {
    base.reversibilityRequired = true;
    base.maxExecutionTimeMs = 300_000; // 5 minutes
    base.maxRetries = 1;
  }

  if (riskLevel === 'critical') {
    base.requiredApprovals = [
      {
        type: 'human_review',
        approver: 'admin',
        timeoutMs: policy.refinementDeadlineMs,
        reason: 'Critical risk action requires human approval',
      },
    ];
  }

  // Lower trust = tighter constraints
  if (trustLevel <= 2) {
    base.maxExecutionTimeMs = Math.min(base.maxExecutionTimeMs ?? 600_000, 60_000);
    base.maxRetries = 1;
  }

  return base;
}

// =============================================================================
// REFINEMENT OPTIONS
// =============================================================================

/**
 * Generate refinement options for YELLOW decisions.
 */
function buildRefinementOptions(
  riskLevel: RiskLevel,
  trustLevel: TrustLevel,
): RefinementOption[] {
  const options: RefinementOption[] = [];

  // Always offer "add constraints"
  options.push({
    id: crypto.randomUUID(),
    action: 'ADD_CONSTRAINTS',
    description: 'Accept additional operational constraints to proceed',
    successProbability: riskLevel === 'high' ? 0.6 : 0.9,
    effort: 'low',
  });

  // Offer scope reduction for high-risk
  if (riskLevel === 'high' || riskLevel === 'critical') {
    options.push({
      id: crypto.randomUUID(),
      action: 'REDUCE_SCOPE',
      description: 'Reduce the scope of the action (e.g., fewer resources, read-only)',
      successProbability: 0.8,
      effort: 'medium',
    });
  }

  // Offer human approval
  options.push({
    id: crypto.randomUUID(),
    action: 'REQUEST_APPROVAL',
    description: 'Request explicit human approval for this action',
    successProbability: 0.7,
    effort: 'medium',
  });

  // Offer decomposition for complex actions
  if (riskLevel !== 'low') {
    options.push({
      id: crypto.randomUUID(),
      action: 'DECOMPOSE',
      description: 'Break this action into smaller, individually-approvable steps',
      successProbability: 0.85,
      effort: 'high',
    });
  }

  // Offer "wait for trust" if trust is close to threshold
  if (trustLevel >= 2 && trustLevel <= 4) {
    options.push({
      id: crypto.randomUUID(),
      action: 'WAIT_FOR_TRUST',
      description: 'Continue building trust through lower-risk actions first',
      successProbability: 0.5,
      effort: 'high',
    });
  }

  return options;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface TrustAwareEnforcementConfig {
  /** Trust level at or above which intents are auto-approved (default: T4) */
  autoApproveLevel?: TrustLevel;
  /** Trust level below which refinement is required (default: T2) */
  requireRefinementLevel?: TrustLevel;
  /** Trust level below which intents are auto-denied (default: T0) */
  autoDenyLevel?: TrustLevel;
  /** Decision expiration time in ms (default: 1 hour) */
  decisionExpirationMs?: number;
  /** Refinement deadline in ms (default: 15 minutes) */
  refinementDeadlineMs?: number;
  /** Maximum refinement attempts (default: 3) */
  maxRefinementAttempts?: number;
  /** Default constraints for GREEN decisions */
  defaultConstraints?: Partial<DecisionConstraints>;
  /** Optional security policy engine for additional policy evaluation */
  policyEngine?: IPolicyEngine;
}

const DEFAULT_CONFIG: Required<Omit<TrustAwareEnforcementConfig, 'policyEngine'>> = {
  autoApproveLevel: 4 as TrustLevel,
  requireRefinementLevel: 2 as TrustLevel,
  autoDenyLevel: 0 as TrustLevel,
  decisionExpirationMs: 3_600_000,
  refinementDeadlineMs: 900_000,
  maxRefinementAttempts: 3,
  defaultConstraints: {},
};

// =============================================================================
// TRUST-AWARE ENFORCEMENT SERVICE
// =============================================================================

/**
 * Production enforcement service wired to the Trust Engine.
 *
 * Provides real three-tier fluid governance with:
 * - Trust-based tier determination using live TrustEngine scores
 * - Risk-aware constraint computation from intent metadata
 * - Refinement workflow with configurable attempt limits
 * - Full audit trail via decision/workflow records
 */
export class TrustAwareEnforcementService implements IEnforcementService {
  private config: Required<Omit<TrustAwareEnforcementConfig, 'policyEngine'>>;
  private policy: EnforcementPolicy;
  private decisions = new Map<ID, FluidDecision>();
  private workflows = new Map<ID, WorkflowInstance>(); // keyed by intentId
  private trustEngine: TrustEngine | null;
  private policyEngine: IPolicyEngine | null;

  constructor(
    trustEngine: TrustEngine | null,
    config?: TrustAwareEnforcementConfig,
    policy?: EnforcementPolicy,
  ) {
    this.trustEngine = trustEngine;
    this.policyEngine = config?.policyEngine ?? null;
    this.config = { ...DEFAULT_CONFIG, ...(config ? { ...config, policyEngine: undefined } : {}) };
    this.policy = policy ?? {
      defaultAction: 'deny',
      trustThresholds: {
        autoApproveLevel: this.config.autoApproveLevel,
        requireRefinementLevel: this.config.requireRefinementLevel,
        autoDenyLevel: this.config.autoDenyLevel,
      },
      decisionExpirationMs: this.config.decisionExpirationMs,
      refinementDeadlineMs: this.config.refinementDeadlineMs,
      maxRefinementAttempts: this.config.maxRefinementAttempts,
    };
  }

  // ===========================================================================
  // IEnforcementService implementation
  // ===========================================================================

  async decide(context: EnforcementContext): Promise<FluidDecisionResult> {
    const t0 = performance.now();
    const { intent, evaluation, tenantId } = context;
    const correlationId = context.correlationId ?? crypto.randomUUID();
    const now = new Date().toISOString();

    // Resolve trust: prefer live engine, fall back to context values
    let trustScore = context.trustScore;
    let trustLevel = context.trustLevel;

    if (this.trustEngine) {
      const record = await this.trustEngine.getScore(intent.entityId);
      if (record) {
        trustScore = record.score;
        trustLevel = record.level;
      }
    }

    // Determine risk level from intent metadata
    const riskLevel = computeRiskLevel(context);

    // Evaluate security policies if engine is available
    if (this.policyEngine) {
      const policyInput: PolicyEvaluationInput = {
        intent,
        trustScore: trustScore ?? 0,
        trustLevel: trustLevel ?? (0 as TrustLevel),
        context: { riskLevel, tenantId, correlationId },
      };

      const violations = this.policyEngine.evaluate(policyInput);

      if (violations.length > 0) {
        logger.info(
          { intentId: intent.id, violationCount: violations.length },
          'Security policy violations detected',
        );

        // Convert violations to RuleResult entries for tier determination
        for (const violation of violations) {
          if (violation.action === 'deny') {
            evaluation.violatedRules.push({
              ruleId: violation.policyId,
              ruleName: violation.policyName,
              matched: true,
              action: 'deny',
              reason: violation.reason,
              details: { source: 'security-policy-engine' },
              durationMs: 0,
            });
          } else if (violation.action === 'escalate') {
            evaluation.violatedRules.push({
              ruleId: violation.policyId,
              ruleName: violation.policyName,
              matched: true,
              action: 'escalate',
              reason: violation.reason,
              details: { source: 'security-policy-engine' },
              durationMs: 0,
            });
          }
        }

        // If any deny violations, mark evaluation as failed
        if (violations.some((v) => v.action === 'deny')) {
          evaluation.passed = false;
        }
      }
    }

    // Determine decision tier
    const tier = this.determineTier(evaluation, trustLevel, riskLevel);
    const latencyMs = Math.round(performance.now() - t0);

    // Build the decision
    const decision: FluidDecision = {
      id: crypto.randomUUID(),
      tenantId,
      intentId: intent.id,
      agentId: intent.entityId,
      correlationId,
      tier,
      permitted: tier === 'GREEN',
      trustBand: `T${trustLevel}_${this.getTrustBandName(trustLevel)}`,
      trustScore,
      reasoning: this.buildReasoning(tier, evaluation, trustLevel, riskLevel),
      refinementAttempt: 0,
      decidedAt: now,
      expiresAt: new Date(Date.now() + this.config.decisionExpirationMs).toISOString(),
      latencyMs,
    };

    // Tier-specific enrichment
    if (tier === 'GREEN') {
      decision.constraints = buildConstraints(
        riskLevel,
        trustLevel,
        this.config,
        this.config.defaultConstraints,
      );
    }

    if (tier === 'YELLOW') {
      decision.refinementDeadline = new Date(
        Date.now() + this.config.refinementDeadlineMs,
      ).toISOString();
      decision.maxRefinementAttempts = this.config.maxRefinementAttempts;
      decision.refinementOptions = buildRefinementOptions(riskLevel, trustLevel);
    }

    if (tier === 'RED') {
      const violatedPolicies = evaluation.violatedRules
        .filter((r) => r.action === 'deny' || r.action === 'terminate')
        .map((r) => ({
          policyId: r.ruleId,
          policyName: r.ruleName,
          severity: r.action === 'terminate' ? 'critical' as const : 'error' as const,
        }));

      decision.denialReason = violatedPolicies.length > 0
        ? `Policy violations: ${violatedPolicies.map((p) => p.policyName).join(', ')}`
        : `Trust level T${trustLevel} below minimum threshold`;
      decision.hardDenial = evaluation.violatedRules.some((r) => r.action === 'terminate');
      decision.violatedPolicies = violatedPolicies.length > 0 ? violatedPolicies : undefined;
    }

    // Store
    this.decisions.set(decision.id, decision);

    // Create workflow
    const workflow: WorkflowInstance = {
      id: crypto.randomUUID(),
      tenantId,
      intentId: intent.id,
      agentId: intent.entityId,
      correlationId,
      state: this.tierToState(tier),
      currentDecisionId: decision.id,
      stateHistory: [
        {
          from: 'SUBMITTED',
          to: this.tierToState(tier),
          reason: `Decision: ${tier} (trust=T${trustLevel}, risk=${riskLevel})`,
          timestamp: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
      expiresAt: decision.expiresAt,
    };

    this.workflows.set(intent.id, workflow);

    logger.info(
      {
        decisionId: decision.id,
        intentId: intent.id,
        tier,
        trustLevel,
        trustScore,
        riskLevel,
        latencyMs,
      },
      'Enforcement decision made',
    );

    return {
      decision,
      workflow,
      tier,
      refinementOptions: decision.refinementOptions,
    };
  }

  async refine(request: RefinementRequest, tenantId: ID): Promise<FluidDecisionResult | null> {
    const original = this.decisions.get(request.decisionId);
    if (!original || original.tenantId !== tenantId) return null;
    if (original.tier !== 'YELLOW') return null;

    // Check refinement deadline
    if (original.refinementDeadline) {
      const deadline = new Date(original.refinementDeadline).getTime();
      if (Date.now() > deadline) {
        logger.warn(
          { decisionId: request.decisionId },
          'Refinement deadline exceeded',
        );
        return null;
      }
    }

    // Check attempt limit
    const maxAttempts = original.maxRefinementAttempts ?? this.config.maxRefinementAttempts;
    if (original.refinementAttempt >= maxAttempts) {
      logger.warn(
        { decisionId: request.decisionId, attempts: original.refinementAttempt },
        'Max refinement attempts reached',
      );
      return null;
    }

    // Validate selected refinements exist
    const validRefinements = original.refinementOptions ?? [];
    const selectedOptions = request.selectedRefinements
      .map((id) => validRefinements.find((opt) => opt.id === id))
      .filter((opt): opt is RefinementOption => opt !== undefined);

    if (selectedOptions.length === 0) {
      logger.warn({ decisionId: request.decisionId }, 'No valid refinement options selected');
      return null;
    }

    const now = new Date().toISOString();

    // Compute resulting constraints from refinements
    const mergedConstraints: DecisionConstraints = {
      allowedTools: ['*'],
      dataScopes: ['*'],
      rateLimits: [],
      requiredApprovals: [],
      reversibilityRequired: true, // Refinement always requires reversibility
      maxRetries: 1,
      maxExecutionTimeMs: 300_000,
    };

    // Apply constraint overrides from selected options
    for (const opt of selectedOptions) {
      if (opt.resultingConstraints) {
        Object.assign(mergedConstraints, opt.resultingConstraints);
      }
      if (opt.action === 'REQUEST_APPROVAL') {
        mergedConstraints.requiredApprovals.push({
          type: 'human_review',
          approver: 'admin',
          timeoutMs: this.config.refinementDeadlineMs,
          reason: 'Refinement requested human approval',
        });
      }
    }

    // Create refined decision
    const refined: FluidDecision = {
      ...original,
      id: crypto.randomUUID(),
      tier: 'GREEN',
      permitted: true,
      refinementAttempt: original.refinementAttempt + 1,
      reasoning: [
        `Refined from YELLOW to GREEN via: ${selectedOptions.map((o) => o.action).join(', ')}`,
        'Additional constraints applied',
      ],
      constraints: mergedConstraints,
      decidedAt: now,
      expiresAt: new Date(Date.now() + this.config.decisionExpirationMs).toISOString(),
      latencyMs: 0,
    };

    this.decisions.set(refined.id, refined);

    // Update workflow
    const workflow = this.workflows.get(original.intentId);
    if (workflow) {
      const previousState = workflow.state;
      workflow.state = 'APPROVED';
      workflow.currentDecisionId = refined.id;
      workflow.updatedAt = now;
      workflow.stateHistory.push({
        from: previousState,
        to: 'APPROVED',
        reason: `Refined via: ${selectedOptions.map((o) => o.action).join(', ')}`,
        timestamp: now,
      });
    }

    logger.info(
      {
        originalDecisionId: request.decisionId,
        refinedDecisionId: refined.id,
        attempt: refined.refinementAttempt,
        actions: selectedOptions.map((o) => o.action),
      },
      'Decision refined to GREEN',
    );

    return {
      decision: refined,
      workflow: workflow!,
      tier: 'GREEN',
    };
  }

  async getDecision(id: ID, tenantId: ID): Promise<FluidDecision | null> {
    const decision = this.decisions.get(id);
    if (!decision || decision.tenantId !== tenantId) return null;

    // Check expiration
    if (new Date(decision.expiresAt).getTime() < Date.now()) {
      return null;
    }

    return decision;
  }

  async getWorkflow(intentId: ID, tenantId: ID): Promise<WorkflowInstance | null> {
    const workflow = this.workflows.get(intentId);
    if (!workflow || workflow.tenantId !== tenantId) return null;
    return workflow;
  }

  setPolicy(policy: EnforcementPolicy): void {
    this.policy = { ...this.policy, ...policy };

    // Sync threshold config from policy
    if (policy.trustThresholds) {
      this.config.autoApproveLevel = policy.trustThresholds.autoApproveLevel;
      this.config.requireRefinementLevel = policy.trustThresholds.requireRefinementLevel;
      this.config.autoDenyLevel = policy.trustThresholds.autoDenyLevel;
    }
  }

  /**
   * Refresh policy configuration at runtime (hot-reload).
   * Accepts partial updates — only specified fields are changed.
   * Existing in-flight decisions are not affected.
   */
  refreshPolicy(updates: Partial<TrustAwareEnforcementConfig>): void {
    const previousConfig = { ...this.config };
    // Extract policyEngine separately — it is not part of the config object
    if (updates.policyEngine !== undefined) {
      this.setPolicyEngine(updates.policyEngine ?? null);
    }
    const { policyEngine: _pe, ...restUpdates } = updates;
    this.config = { ...this.config, ...restUpdates };

    // Sync policy thresholds if updated
    if (updates.autoApproveLevel !== undefined || updates.requireRefinementLevel !== undefined || updates.autoDenyLevel !== undefined) {
      this.policy.trustThresholds = {
        autoApproveLevel: this.config.autoApproveLevel,
        requireRefinementLevel: this.config.requireRefinementLevel,
        autoDenyLevel: this.config.autoDenyLevel,
      };
    }

    logger.info(
      { previous: previousConfig, updated: this.config },
      'Enforcement policy refreshed at runtime',
    );
  }

  /**
   * Get current policy configuration (for inspection/debugging).
   */
  getPolicy(): { config: Required<Omit<TrustAwareEnforcementConfig, 'policyEngine'>>; policy: EnforcementPolicy } {
    return { config: { ...this.config }, policy: { ...this.policy } };
  }

  // ===========================================================================
  // Public helpers
  // ===========================================================================

  /**
   * Set or replace the security policy engine.
   * Can be called at runtime to add/swap policy evaluation.
   */
  setPolicyEngine(engine: IPolicyEngine | null): void {
    this.policyEngine = engine;
    logger.info(
      { hasEngine: engine !== null },
      'Security policy engine updated',
    );
  }

  /**
   * Get count of active decisions.
   */
  decisionCount(): number {
    return this.decisions.size;
  }

  /**
   * Get count of active workflows.
   */
  workflowCount(): number {
    return this.workflows.size;
  }

  /**
   * Clear all state (for testing).
   */
  clear(): void {
    this.decisions.clear();
    this.workflows.clear();
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private determineTier(
    evaluation: { passed: boolean; violatedRules: Array<{ action: string }> },
    trustLevel: TrustLevel,
    riskLevel: RiskLevel,
  ): DecisionTier {
    // Hard denials from rule violations
    if (evaluation.violatedRules.some((r) => r.action === 'deny' || r.action === 'terminate')) {
      return 'RED';
    }

    // Trust below auto-deny threshold
    if (trustLevel < this.config.autoDenyLevel) {
      return 'RED';
    }

    // Critical risk always requires at least YELLOW unless T6+
    if (riskLevel === 'critical' && trustLevel < 6) {
      return trustLevel < this.config.requireRefinementLevel ? 'RED' : 'YELLOW';
    }

    // High risk requires higher trust for auto-approve
    if (riskLevel === 'high') {
      const elevatedApproveLevel = Math.min(7, this.config.autoApproveLevel + 1) as TrustLevel;
      if (trustLevel >= elevatedApproveLevel && evaluation.passed) return 'GREEN';
      if (trustLevel < this.config.requireRefinementLevel) return 'RED';
      return 'YELLOW';
    }

    // Standard tier determination
    if (trustLevel >= this.config.autoApproveLevel && evaluation.passed) return 'GREEN';
    if (trustLevel < this.config.requireRefinementLevel) return 'YELLOW';
    return 'YELLOW';
  }

  private buildReasoning(
    tier: DecisionTier,
    evaluation: { passed: boolean; violatedRules: Array<{ action: string; reason: string }> },
    trustLevel: TrustLevel,
    riskLevel: RiskLevel,
  ): string[] {
    const reasons: string[] = [];
    const bandName = this.getTrustBandName(trustLevel);

    if (tier === 'GREEN') {
      reasons.push(`Trust T${trustLevel} (${bandName}) meets auto-approve threshold`);
      reasons.push(`Risk level: ${riskLevel}`);
      if (evaluation.passed) reasons.push('All policy checks passed');
    } else if (tier === 'YELLOW') {
      reasons.push(`Trust T${trustLevel} (${bandName}) requires refinement`);
      reasons.push(`Risk level: ${riskLevel}`);
      reasons.push('Refinement options available — select one or more to proceed');
    } else {
      if (evaluation.violatedRules.length > 0) {
        reasons.push('Policy violations detected:');
        for (const rule of evaluation.violatedRules.slice(0, 5)) {
          reasons.push(`  - ${rule.reason}`);
        }
      } else {
        reasons.push(`Trust T${trustLevel} (${bandName}) below minimum threshold`);
      }
      reasons.push(`Risk level: ${riskLevel}`);
    }

    return reasons;
  }

  private tierToState(tier: DecisionTier): WorkflowState {
    switch (tier) {
      case 'GREEN': return 'APPROVED';
      case 'YELLOW': return 'PENDING_REFINEMENT';
      case 'RED': return 'DENIED';
    }
  }

  private getTrustBandName(level: TrustLevel): string {
    return TRUST_LEVEL_NAMES[level] ?? 'Unknown';
  }
}
