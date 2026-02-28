/**
 * ENFORCE - Policy Decision Point with Fluid Governance (SDK Package)
 *
 * Makes enforcement decisions based on rule evaluations and trust levels.
 * Supports three-tier fluid governance (GREEN/YELLOW/RED) with refinement
 * options for agents to modify requests.
 *
 * For production use with persistence, use the full implementation from the
 * vorion core package. This SDK package provides:
 * - Type definitions aligned with @vorion/contracts
 * - In-memory mock for testing
 * - Interface definitions for custom implementations
 *
 * @packageDocumentation
 */

import { createLogger } from "../common/logger.js";
import type {
  TrustLevel,
  ID,
} from "../common/types.js";
import type { EvaluationResult } from "../basis/types.js";
import type {
  IEnforcementService,
  EnforcementContext,
  EnforcementPolicy,
  FluidDecision,
  FluidDecisionResult,
  DecisionTier,
  RefinementOption,
  RefinementRequest,
  WorkflowInstance,
  WorkflowState,
  PolicyPredicate,
} from "./types.js";

export * from "./types.js";

const logger = createLogger({ component: "enforce" });

// =============================================================================
// MOCK IMPLEMENTATION
// =============================================================================

const DEFAULT_POLICY: EnforcementPolicy = {
  defaultAction: "deny",
  trustThresholds: {
    autoApproveLevel: 4,
    requireRefinementLevel: 2,
    autoDenyLevel: 0,
  },
  decisionExpirationMs: 3600000,
  refinementDeadlineMs: 900000,
  maxRefinementAttempts: 3,
};

/**
 * In-memory enforcement service for testing
 *
 * WARNING: This is NOT suitable for production use.
 * For production, connect to the Vorion API or use the full
 * implementation from the vorion core package.
 */
export class MockEnforcementService implements IEnforcementService {
  private policy: EnforcementPolicy;
  private decisions: Map<ID, FluidDecision> = new Map();
  private workflows: Map<ID, WorkflowInstance> = new Map();

  constructor(policy?: EnforcementPolicy) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  async decide(context: EnforcementContext): Promise<FluidDecisionResult> {
    const { intent, evaluation, trustScore, trustLevel, tenantId } = context;
    const correlationId = context.correlationId ?? crypto.randomUUID();
    const now = new Date().toISOString();

    // Determine tier
    const tier = this.determineTier(evaluation, trustLevel);

    // Create decision
    const decision: FluidDecision = {
      id: crypto.randomUUID(),
      tenantId,
      intentId: intent.id,
      agentId: intent.entityId,
      correlationId,
      tier,
      permitted: tier === "GREEN",
      trustBand: `T${trustLevel}_${this.getTrustBandName(trustLevel)}`,
      trustScore,
      reasoning: this.buildReasoning(tier, evaluation, trustLevel),
      refinementAttempt: 0,
      decidedAt: now,
      expiresAt: new Date(
        Date.now() + (this.policy.decisionExpirationMs ?? 3600000),
      ).toISOString(),
      latencyMs: 1,
    };

    // Add constraints for GREEN
    if (tier === "GREEN") {
      decision.constraints = {
        allowedTools: ["*"],
        dataScopes: ["*"],
        rateLimits: [],
        requiredApprovals: [],
        reversibilityRequired: false,
        maxRetries: 3,
      };
    }

    // Add refinement options for YELLOW
    if (tier === "YELLOW") {
      decision.refinementDeadline = new Date(
        Date.now() + (this.policy.refinementDeadlineMs ?? 900000),
      ).toISOString();
      decision.maxRefinementAttempts = this.policy.maxRefinementAttempts ?? 3;
      decision.refinementOptions = [
        {
          id: crypto.randomUUID(),
          action: "ADD_CONSTRAINTS",
          description: "Accept additional constraints",
          successProbability: 0.9,
          effort: "low",
        },
        {
          id: crypto.randomUUID(),
          action: "REQUEST_APPROVAL",
          description: "Request human approval",
          successProbability: 0.7,
          effort: "medium",
        },
      ];
    }

    // Add denial details for RED
    if (tier === "RED") {
      decision.denialReason = "policy_violation";
      decision.hardDenial = true;
    }

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
          from: "SUBMITTED" as WorkflowState,
          to: this.tierToState(tier),
          reason: `Decision: ${tier}`,
          timestamp: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
      expiresAt: decision.expiresAt,
    };

    this.workflows.set(intent.id, workflow);

    logger.info(
      { decisionId: decision.id, intentId: intent.id, tier },
      "Enforcement decision made (mock)",
    );

    return {
      decision,
      workflow,
      tier,
      refinementOptions: decision.refinementOptions,
    };
  }

  async refine(
    request: RefinementRequest,
    tenantId: ID,
  ): Promise<FluidDecisionResult | null> {
    const original = this.decisions.get(request.decisionId);
    if (!original || original.tier !== "YELLOW") return null;

    const now = new Date().toISOString();

    // Create refined decision (simple: just upgrade to GREEN)
    const refined: FluidDecision = {
      ...original,
      id: crypto.randomUUID(),
      tier: "GREEN",
      permitted: true,
      refinementAttempt: original.refinementAttempt + 1,
      reasoning: ["Refined to GREEN after applying constraints"],
      constraints: {
        allowedTools: ["*"],
        dataScopes: ["*"],
        rateLimits: [],
        requiredApprovals: [],
        reversibilityRequired: true,
        maxRetries: 3,
      },
      decidedAt: now,
    };

    this.decisions.set(refined.id, refined);

    // Update workflow
    const workflow = this.workflows.get(original.intentId);
    if (workflow) {
      workflow.state = "APPROVED";
      workflow.currentDecisionId = refined.id;
      workflow.updatedAt = now;
      workflow.stateHistory.push({
        from: "PENDING_REFINEMENT",
        to: "APPROVED",
        reason: "Refined to GREEN",
        timestamp: now,
      });
    }

    return { decision: refined, workflow: workflow!, tier: "GREEN" };
  }

  async getDecision(id: ID, tenantId: ID): Promise<FluidDecision | null> {
    const decision = this.decisions.get(id);
    return decision?.tenantId === tenantId ? decision : null;
  }

  async getWorkflow(
    intentId: ID,
    tenantId: ID,
  ): Promise<WorkflowInstance | null> {
    const workflow = this.workflows.get(intentId);
    return workflow?.tenantId === tenantId ? workflow : null;
  }

  setPolicy(policy: EnforcementPolicy): void {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  private determineTier(
    evaluation: EvaluationResult,
    trustLevel: TrustLevel,
  ): DecisionTier {
    const thresholds = this.policy.trustThresholds!;

    if (
      evaluation.violatedRules.some(
        (r) => r.action === "deny" || r.action === "terminate",
      )
    ) {
      return "RED";
    }
    if (trustLevel < thresholds.autoDenyLevel) return "RED";
    if (trustLevel < thresholds.requireRefinementLevel) return "YELLOW";
    if (trustLevel >= thresholds.autoApproveLevel && evaluation.passed)
      return "GREEN";
    return "YELLOW";
  }

  private buildReasoning(
    tier: DecisionTier,
    evaluation: EvaluationResult,
    trustLevel: TrustLevel,
  ): string[] {
    if (tier === "GREEN")
      return ["All checks passed", `Trust T${trustLevel} meets requirements`];
    if (tier === "YELLOW") return ["Refinement options available"];
    return ["Policy violation", "Request cannot proceed"];
  }

  private tierToState(tier: DecisionTier): WorkflowState {
    return tier === "GREEN"
      ? "APPROVED"
      : tier === "YELLOW"
        ? "PENDING_REFINEMENT"
        : "DENIED";
  }

  private getTrustBandName(level: TrustLevel): string {
    const names = [
      "SANDBOX",
      "OBSERVED",
      "PROVISIONAL",
      "MONITORED",
      "STANDARD",
      "TRUSTED",
      "CERTIFIED",
      "AUTONOMOUS",
    ];
    return names[level] ?? "SANDBOX";
  }

  clear(): void {
    this.decisions.clear();
    this.workflows.clear();
  }
}

// =============================================================================
// BACKWARDS COMPATIBLE EXPORTS
// =============================================================================

/**
 * @deprecated Use MockEnforcementService for testing or implement IEnforcementService
 */
export class EnforcementService extends MockEnforcementService {}

// =============================================================================
// SERVICE FACTORY & INJECTION
// =============================================================================

let enforcementService: IEnforcementService | null = null;

/**
 * Set the enforcement service implementation to use at runtime.
 * Call this during application bootstrap with a real backend.
 */
export function setEnforcementService(service: IEnforcementService): void {
  enforcementService = service;
}

/**
 * Get the configured enforcement service.
 * Throws if no real backend has been provided via setEnforcementService().
 */
export function getEnforcementService(): IEnforcementService {
  if (!enforcementService) {
    throw new Error(
      "No enforcement service backend configured. Pass a real EnforcementService implementation or see docs for setup.",
    );
  }
  return enforcementService;
}

/**
 * Create a new enforcement service instance
 *
 * Throws if no real backend is provided. For tests, use createMockEnforcementService().
 */
export function createEnforcementService(
  service?: IEnforcementService,
): IEnforcementService {
  if (!service) {
    throw new Error(
      "No enforcement service backend configured. Pass a real EnforcementService implementation or see docs for setup.",
    );
  }
  return service;
}

/**
 * Create a mock enforcement service for testing only.
 */
export function createMockEnforcementService(
  policy?: EnforcementPolicy,
): MockEnforcementService {
  return new MockEnforcementService(policy);
}

// =============================================================================
// PRODUCTION IMPLEMENTATION
// =============================================================================

export { TrustAwareEnforcementService } from "./trust-aware-enforcement-service.js";
export type {
  TrustAwareEnforcementConfig,
  IPolicyEngine,
  PolicyEvaluationInput,
  PolicyViolation,
} from "./trust-aware-enforcement-service.js";

// =============================================================================
// POLICY COMPOSITION
// =============================================================================

/**
 * Compose policies with AND -- all must pass for the combined policy to pass.
 */
export function allOf(...predicates: PolicyPredicate[]): PolicyPredicate {
  return (context: EnforcementContext) => predicates.every((p) => p(context));
}

/**
 * Compose policies with OR -- at least one must pass.
 */
export function anyOf(...predicates: PolicyPredicate[]): PolicyPredicate {
  return (context: EnforcementContext) => predicates.some((p) => p(context));
}

/**
 * Negate a policy predicate.
 */
export function not(predicate: PolicyPredicate): PolicyPredicate {
  return (context: EnforcementContext) => !predicate(context);
}

/**
 * Built-in policy predicates for common checks.
 */
export const PolicyPredicates = {
  /** Trust level is at or above the given threshold */
  minTrustLevel:
    (level: number): PolicyPredicate =>
    (ctx) =>
      (ctx.trustLevel ?? 0) >= level,

  /** Action type matches */
  actionType:
    (type: string): PolicyPredicate =>
    (ctx) =>
      ctx.intent.actionType === type,

  /** Data sensitivity is at most the given level */
  maxSensitivity: (
    level: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED",
  ): PolicyPredicate => {
    const order = { PUBLIC: 0, INTERNAL: 1, CONFIDENTIAL: 2, RESTRICTED: 3 };
    return (ctx) =>
      order[(ctx.intent.dataSensitivity ?? "PUBLIC") as keyof typeof order] <=
      order[level];
  },

  /** Action is reversible */
  isReversible: (): PolicyPredicate => (ctx) =>
    ctx.intent.reversibility !== "IRREVERSIBLE",
} as const;
