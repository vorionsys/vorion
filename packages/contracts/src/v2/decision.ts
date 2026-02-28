/**
 * Decision types - the result of authorizing an intent
 *
 * Supports both legacy binary (permitted/denied) and the new
 * three-tier fluid governance model (GREEN/YELLOW/RED).
 */

import type {
  ApprovalType,
  TrustBand,
  DecisionTier,
  RefinementAction,
  WorkflowState,
} from "./enums.js";

/**
 * Rate limit constraint
 */
export interface RateLimit {
  /** What is being limited (requests, tokens, etc.) */
  resource: string;
  /** Maximum allowed */
  limit: number;
  /** Time window in seconds */
  windowSeconds: number;
}

/**
 * Approval requirement for permitted actions
 */
export interface ApprovalRequirement {
  /** Type of approval needed */
  type: ApprovalType;
  /** Who needs to approve (role, user, system) */
  approver: string;
  /** Time limit to get approval (ms) */
  timeoutMs?: number;
  /** Reason this approval is required */
  reason: string;
}

/**
 * Constraints applied to permitted actions
 */
export interface DecisionConstraints {
  /** Required approvals before execution */
  requiredApprovals: ApprovalRequirement[];

  /** Tools/capabilities the agent can use */
  allowedTools: string[];

  /** Data scopes the agent can access */
  dataScopes: string[];

  /** Rate limits to enforce */
  rateLimits: RateLimit[];

  /** Must action be reversible? */
  reversibilityRequired: boolean;

  /** Maximum execution time in ms */
  maxExecutionTimeMs?: number;

  /** Maximum retry attempts */
  maxRetries?: number;

  /** Resource quotas */
  resourceQuotas?: Record<string, number>;
}

/**
 * Decision - the authorization result for an intent
 */
export interface Decision {
  /** Unique decision identifier */
  decisionId: string;

  /** Intent this decision is for */
  intentId: string;

  /** Agent who made the request */
  agentId: string;

  /** Correlation ID for tracing */
  correlationId: string;

  /** The verdict: can the agent proceed? */
  permitted: boolean;

  /** If permitted, what constraints apply */
  constraints?: DecisionConstraints;

  /** Agent's trust band at decision time */
  trustBand: TrustBand;

  /** Agent's trust score at decision time */
  trustScore: number;

  /** Policy set used for this decision */
  policySetId?: string;

  /** Human-readable reasoning for the decision */
  reasoning: string[];

  /** When decision was made */
  decidedAt: Date;

  /** Decision is only valid until this time */
  expiresAt: Date;

  /** Time taken to make decision (ms) */
  latencyMs: number;

  /** Version for audit */
  version: number;
}

/**
 * Summary view of a decision
 */
export interface DecisionSummary {
  decisionId: string;
  intentId: string;
  agentId: string;
  correlationId: string;
  permitted: boolean;
  trustBand: TrustBand;
  decidedAt: Date;
}

/**
 * Request to authorize an intent
 * (Intent itself is the request body)
 */
export interface AuthorizationRequest {
  /** The intent to authorize */
  intent: {
    agentId: string;
    action: string;
    actionType: string;
    resourceScope: string[];
    dataSensitivity: string;
    reversibility: string;
    context?: Record<string, unknown>;
  };

  /** Optional: Override default policy set */
  policySetId?: string;

  /** Optional: Request specific constraints */
  requestedConstraints?: Partial<DecisionConstraints>;
}

/**
 * Response from authorization
 */
export interface AuthorizationResponse {
  decision: Decision;

  /** If denied, what would need to change to permit */
  remediations?: string[];
}

/**
 * Denial reasons enum for structured denials
 */
export enum DenialReason {
  INSUFFICIENT_TRUST = "insufficient_trust",
  POLICY_VIOLATION = "policy_violation",
  RESOURCE_RESTRICTED = "resource_restricted",
  DATA_SENSITIVITY_EXCEEDED = "data_sensitivity_exceeded",
  RATE_LIMIT_EXCEEDED = "rate_limit_exceeded",
  CONTEXT_MISMATCH = "context_mismatch",
  EXPIRED_INTENT = "expired_intent",
  SYSTEM_ERROR = "system_error",
}

// ============================================================================
// FLUID GOVERNANCE TYPES (Three-Tier Decision Model)
// ============================================================================

/**
 * A refinement option presented to the agent for YELLOW decisions
 *
 * Refinements allow the agent to modify their request to achieve GREEN status
 * rather than receiving a binary denial.
 */
export interface RefinementOption {
  /** Unique identifier for this refinement option */
  id: string;

  /** Type of refinement action */
  action: RefinementAction;

  /** Human-readable description of what needs to change */
  description: string;

  /** Likelihood that this refinement will succeed (0-1) */
  successProbability: number;

  /** Estimated effort/cost to implement this refinement */
  effort: "low" | "medium" | "high";

  /** Specific parameters for the refinement */
  parameters?: Record<string, unknown>;

  /** If the agent applies this, what constraints would result? */
  resultingConstraints?: Partial<DecisionConstraints>;
}

/**
 * Fluid Decision - extends Decision with three-tier governance
 *
 * The fluid decision model replaces binary allow/deny with:
 * - GREEN: Approved with constraints
 * - YELLOW: Can be refined to achieve approval
 * - RED: Hard denial (policy violation)
 */
export interface FluidDecision extends Decision {
  /**
   * Decision tier (GREEN/YELLOW/RED)
   *
   * - GREEN: Proceed with constraints
   * - YELLOW: Refinement required
   * - RED: Cannot proceed
   */
  tier: DecisionTier;

  /**
   * For YELLOW decisions: available refinement options
   *
   * The agent can choose one or more refinements to upgrade
   * their decision to GREEN.
   */
  refinementOptions?: RefinementOption[];

  /**
   * For YELLOW decisions: deadline to submit refinement
   */
  refinementDeadline?: Date;

  /**
   * For YELLOW decisions: maximum refinement attempts allowed
   */
  maxRefinementAttempts?: number;

  /**
   * Current refinement attempt number (0 = initial decision)
   */
  refinementAttempt: number;

  /**
   * If this is a refined decision, reference to original
   */
  originalDecisionId?: string;

  /**
   * Applied refinements that led to this decision
   */
  appliedRefinements?: Array<{
    refinementId: string;
    appliedAt: Date;
  }>;

  /**
   * For RED decisions: whether this is a soft or hard denial
   *
   * - Soft: Could potentially be overridden by higher authority
   * - Hard: Absolute denial, no override possible
   */
  hardDenial?: boolean;

  /**
   * For RED decisions: specific policies that were violated
   */
  violatedPolicies?: Array<{
    policyId: string;
    policyName: string;
    severity: "warning" | "error" | "critical";
  }>;
}

/**
 * Request to refine a YELLOW decision
 */
export interface RefinementRequest {
  /** Original decision being refined */
  decisionId: string;

  /** Refinement options being applied */
  selectedRefinements: string[];

  /** Additional context for the refinement */
  refinementContext?: Record<string, unknown>;

  /** Modified intent parameters (if applicable) */
  modifiedIntent?: Partial<{
    action: string;
    resourceScope: string[];
    dataSensitivity: string;
    reversibility: string;
    context: Record<string, unknown>;
  }>;
}

/**
 * Response from a refinement request
 */
export interface RefinementResponse {
  /** The new decision after refinement */
  decision: FluidDecision;

  /** Whether the refinement was successful */
  success: boolean;

  /** If unsuccessful, reason for failure */
  failureReason?: string;

  /** Remaining refinement attempts */
  remainingAttempts: number;
}

/**
 * Workflow instance - tracks the lifecycle of an intent through governance
 */
export interface WorkflowInstance {
  /** Unique workflow identifier */
  workflowId: string;

  /** Intent being processed */
  intentId: string;

  /** Agent who submitted the intent */
  agentId: string;

  /** Correlation ID for tracing */
  correlationId: string;

  /** Current workflow state */
  state: WorkflowState;

  /** All decisions made for this workflow */
  decisions: FluidDecision[];

  /** Current/latest decision */
  currentDecisionId?: string;

  /** When the workflow was created */
  createdAt: Date;

  /** When the workflow was last updated */
  updatedAt: Date;

  /** When the workflow expires */
  expiresAt: Date;

  /** History of state transitions */
  stateHistory: Array<{
    from: WorkflowState;
    to: WorkflowState;
    reason: string;
    timestamp: Date;
  }>;

  /** Execution details if approved and executed */
  execution?: {
    executionId: string;
    startedAt: Date;
    completedAt?: Date;
    status: "running" | "completed" | "failed";
    result?: unknown;
    error?: string;
  };
}

/**
 * Fluid authorization response - extends standard response with workflow
 */
export interface FluidAuthorizationResponse {
  /** The fluid decision */
  decision: FluidDecision;

  /** The workflow instance tracking this authorization */
  workflow: WorkflowInstance;

  /** For YELLOW: available refinements */
  refinementOptions?: RefinementOption[];

  /** For RED: what would need to change (from legacy system) */
  remediations?: string[];
}
