/**
 * Enforce Service Types
 *
 * Extracted from enforce/index.ts to break circular dependency with
 * trust-aware-enforcement-service.ts.
 *
 * @packageDocumentation
 */

import type {
  Intent,
  ControlAction,
  TrustLevel,
  TrustScore,
  ID,
  Timestamp,
} from "../common/types.js";
import type { EvaluationResult } from "../basis/types.js";

// =============================================================================
// DECISION TIER (Fluid Governance)
// =============================================================================

/**
 * Decision tier for three-tier fluid governance
 *
 * - GREEN: Approved with constraints - proceed immediately
 * - YELLOW: Requires refinement or review - can be upgraded
 * - RED: Denied - hard policy violation
 */
export type DecisionTier = "GREEN" | "YELLOW" | "RED";

// =============================================================================
// DECISION CONSTRAINTS
// =============================================================================

/**
 * Rate limit constraint
 */
export interface RateLimit {
  resource: string;
  limit: number;
  windowSeconds: number;
}

/**
 * Approval requirement
 */
export interface ApprovalRequirement {
  type: "none" | "human_review" | "automated_check" | "multi_party";
  approver: string;
  timeoutMs?: number;
  reason: string;
}

/**
 * Constraints applied to permitted decisions
 */
export interface DecisionConstraints {
  /** Tools/capabilities the agent can use */
  allowedTools: string[];
  /** Data scopes the agent can access */
  dataScopes: string[];
  /** Rate limits to enforce */
  rateLimits: RateLimit[];
  /** Required approvals before execution */
  requiredApprovals: ApprovalRequirement[];
  /** Must action be reversible? */
  reversibilityRequired: boolean;
  /** Maximum execution time in ms */
  maxExecutionTimeMs?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Resource quotas */
  resourceQuotas?: Record<string, number>;
}

// =============================================================================
// REFINEMENT OPTIONS
// =============================================================================

/**
 * Refinement action types for YELLOW decisions
 */
export type RefinementAction =
  | "REDUCE_SCOPE"
  | "ADD_CONSTRAINTS"
  | "REQUEST_APPROVAL"
  | "PROVIDE_CONTEXT"
  | "DECOMPOSE"
  | "WAIT_FOR_TRUST";

/**
 * Refinement option for YELLOW decisions
 */
export interface RefinementOption {
  id: ID;
  action: RefinementAction;
  description: string;
  successProbability: number;
  effort: "low" | "medium" | "high";
  parameters?: Record<string, unknown>;
  resultingConstraints?: Partial<DecisionConstraints>;
}

// =============================================================================
// DECISION TYPES
// =============================================================================

/**
 * Fluid decision with three-tier governance
 */
export interface FluidDecision {
  /** Unique decision identifier */
  id: ID;
  /** Tenant identifier */
  tenantId: ID;
  /** Intent this decision is for */
  intentId: ID;
  /** Agent who made the request */
  agentId: ID;
  /** Correlation ID for tracing */
  correlationId: ID;

  /** Decision tier (GREEN/YELLOW/RED) */
  tier: DecisionTier;
  /** Whether the intent is permitted (GREEN=true, others=false) */
  permitted: boolean;

  /** Trust band at decision time (T0-T7) */
  trustBand: string;
  /** Trust score at decision time */
  trustScore: number;

  /** Human-readable reasoning */
  reasoning: string[];

  /** Constraints for GREEN decisions */
  constraints?: DecisionConstraints;

  /** Refinement options for YELLOW decisions */
  refinementOptions?: RefinementOption[];
  /** Deadline to submit refinement */
  refinementDeadline?: Timestamp;
  /** Maximum refinement attempts */
  maxRefinementAttempts?: number;
  /** Current refinement attempt */
  refinementAttempt: number;

  /** For RED: denial reason */
  denialReason?: string;
  /** For RED: is this a hard denial? */
  hardDenial?: boolean;
  /** For RED: violated policies */
  violatedPolicies?: Array<{
    policyId: string;
    policyName: string;
    severity: "warning" | "error" | "critical";
  }>;

  /** When decision was made */
  decidedAt: Timestamp;
  /** When decision expires */
  expiresAt: Timestamp;
  /** Decision latency in ms */
  latencyMs: number;
}

// =============================================================================
// WORKFLOW
// =============================================================================

/**
 * Workflow state for intent lifecycle
 */
export type WorkflowState =
  | "SUBMITTED"
  | "EVALUATING"
  | "APPROVED"
  | "PENDING_REFINEMENT"
  | "PENDING_REVIEW"
  | "DENIED"
  | "EXECUTING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

/**
 * Workflow instance tracking intent lifecycle
 */
export interface WorkflowInstance {
  id: ID;
  tenantId: ID;
  intentId: ID;
  agentId: ID;
  correlationId: ID;
  state: WorkflowState;
  currentDecisionId?: ID;
  stateHistory: Array<{
    from: WorkflowState;
    to: WorkflowState;
    reason: string;
    timestamp: Timestamp;
  }>;
  execution?: {
    executionId: string;
    startedAt: Timestamp;
    completedAt?: Timestamp;
    status: "running" | "completed" | "failed";
    result?: unknown;
    error?: string;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt: Timestamp;
}

// =============================================================================
// ENFORCEMENT CONTEXT & POLICY
// =============================================================================

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
  /** Trust level thresholds for automatic decisions */
  trustThresholds?: {
    autoApproveLevel: TrustLevel;
    requireRefinementLevel: TrustLevel;
    autoDenyLevel: TrustLevel;
  };
  /** Escalation rules */
  escalationRules?: EscalationRule[];
  /** Default constraints for GREEN decisions */
  defaultConstraints?: Partial<DecisionConstraints>;
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
  condition: string;
  escalateTo: string;
  timeout: string;
  reasonCategory?:
    | "trust_insufficient"
    | "high_risk"
    | "policy_violation"
    | "manual_review";
}

/**
 * Fluid decision result
 */
export interface FluidDecisionResult {
  decision: FluidDecision;
  workflow: WorkflowInstance;
  tier: DecisionTier;
  refinementOptions?: RefinementOption[];
}

/**
 * Refinement request
 */
export interface RefinementRequest {
  decisionId: ID;
  selectedRefinements: ID[];
  refinementContext?: Record<string, unknown>;
}

// =============================================================================
// SERVICE INTERFACE
// =============================================================================

/**
 * Interface for enforcement service implementations
 */
export interface IEnforcementService {
  decide(context: EnforcementContext): Promise<FluidDecisionResult>;
  refine(
    request: RefinementRequest,
    tenantId: ID,
  ): Promise<FluidDecisionResult | null>;
  getDecision(id: ID, tenantId: ID): Promise<FluidDecision | null>;
  getWorkflow(intentId: ID, tenantId: ID): Promise<WorkflowInstance | null>;
  setPolicy(policy: EnforcementPolicy): void;
}

// =============================================================================
// POLICY COMPOSITION
// =============================================================================

/**
 * Policy predicate -- a function that evaluates an intent context and returns
 * whether the policy condition is met.
 */
export type PolicyPredicate = (context: EnforcementContext) => boolean;
