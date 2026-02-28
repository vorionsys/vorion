/**
 * Core enums for the Vorion Platform
 */

/**
 * Trust bands representing autonomy levels (T0-T7)
 *
 * The 8-tier system maps trust scores (0-1000) to discrete autonomy levels:
 * - T0: Sandbox - Isolated testing, no real operations (0-199)
 * - T1: Observed - Under active observation and supervision (200-349)
 * - T2: Provisional - Limited operations with strict constraints (350-499)
 * - T3: Monitored - Continuous monitoring with expanding freedom (500-649)
 * - T4: Standard - Trusted for routine operations (650-799)
 * - T5: Trusted - Expanded capabilities with minimal oversight (800-875)
 * - T6: Certified - Independent operation with audit trail (876-950)
 * - T7: Autonomous - Full autonomy for mission-critical operations (951-1000)
 */
/**
 * @deprecated Use TrustTier from @vorionsys/basis instead.
 * TrustBand is a legacy alias kept for backwards compatibility.
 * Will be removed in contracts v1.0.
 */
export enum TrustBand {
  T0_SANDBOX = 0,
  T1_OBSERVED = 1,
  T2_PROVISIONAL = 2,
  T3_MONITORED = 3,
  T4_STANDARD = 4,
  T5_TRUSTED = 5,
  T6_CERTIFIED = 6,
  T7_AUTONOMOUS = 7,
}

/**
 * Observation tiers - determines maximum trust ceiling
 * based on system observability
 *
 * Per ATSF v2.0 RTA findings:
 * - WHITE_BOX reduced from 95% to 90% (sleeper agent risk)
 * - ATTESTED_BOX reduced from 100% to 95% (TEE side-channel risk)
 * - VERIFIED_BOX added requiring multiple verification layers
 */
export enum ObservationTier {
  /** I/O only - API accessed proprietary models (max 60%) */
  BLACK_BOX = "BLACK_BOX",
  /** I/O + logs - Platform-hosted models (max 75%) */
  GRAY_BOX = "GRAY_BOX",
  /** Full code access - Open-source models (max 90%, reduced for sleeper risk) */
  WHITE_BOX = "WHITE_BOX",
  /** TEE verified - Models in secure enclaves (max 95%, reduced for side-channel risk) */
  ATTESTED_BOX = "ATTESTED_BOX",
  /** Full verification: TEE + zkML + interpretability (max 100%) */
  VERIFIED_BOX = "VERIFIED_BOX",
}

/**
 * Trust ceiling values for each observation tier (0-1000 scale)
 * Updated per ATSF v2.0 Red Team Assessment findings
 */
export const OBSERVATION_CEILINGS: Record<ObservationTier, number> = {
  [ObservationTier.BLACK_BOX]: 600,
  [ObservationTier.GRAY_BOX]: 750,
  [ObservationTier.WHITE_BOX]: 900, // Reduced from 950 (sleeper agent risk)
  [ObservationTier.ATTESTED_BOX]: 950, // Reduced from 1000 (TEE side-channel risk)
  [ObservationTier.VERIFIED_BOX]: 1000, // New: requires full verification stack
};

/**
 * Data sensitivity levels for intent classification
 */
export enum DataSensitivity {
  PUBLIC = "PUBLIC",
  INTERNAL = "INTERNAL",
  CONFIDENTIAL = "CONFIDENTIAL",
  RESTRICTED = "RESTRICTED",
}

/**
 * Action reversibility classification
 */
export enum Reversibility {
  REVERSIBLE = "REVERSIBLE",
  PARTIALLY_REVERSIBLE = "PARTIALLY_REVERSIBLE",
  IRREVERSIBLE = "IRREVERSIBLE",
}

/**
 * Action types for categorizing intents
 */
export enum ActionType {
  READ = "read",
  WRITE = "write",
  DELETE = "delete",
  EXECUTE = "execute",
  COMMUNICATE = "communicate",
  TRANSFER = "transfer",
}

/**
 * Proof event types for the audit trail
 */
export enum ProofEventType {
  INTENT_RECEIVED = "intent_received",
  DECISION_MADE = "decision_made",
  TRUST_DELTA = "trust_delta",
  EXECUTION_STARTED = "execution_started",
  EXECUTION_COMPLETED = "execution_completed",
  EXECUTION_FAILED = "execution_failed",
  INCIDENT_DETECTED = "incident_detected",
  ROLLBACK_INITIATED = "rollback_initiated",
  COMPONENT_REGISTERED = "component_registered",
  COMPONENT_UPDATED = "component_updated",
}

/**
 * Component types in the registry
 */
export enum ComponentType {
  AGENT = "agent",
  SERVICE = "service",
  ADAPTER = "adapter",
  POLICY_BUNDLE = "policy_bundle",
}

/**
 * Component lifecycle status
 */
export enum ComponentStatus {
  ACTIVE = "active",
  DEPRECATED = "deprecated",
  RETIRED = "retired",
}

/**
 * Approval requirement types
 */
export enum ApprovalType {
  NONE = "none",
  HUMAN_REVIEW = "human_review",
  AUTOMATED_CHECK = "automated_check",
  MULTI_PARTY = "multi_party",
}

/**
 * Decision Tier - Three-tier governance model for fluid decisions
 *
 * Part of Fluid Governance Architecture:
 * - GREEN: Auto-approved within constraints, proceed immediately
 * - YELLOW: Requires refinement or human review before proceeding
 * - RED: Denied, cannot proceed (hard policy violation)
 *
 * YELLOW decisions support iterative refinement, allowing agents to
 * modify their request rather than receiving a binary allow/deny.
 */
export enum DecisionTier {
  /** Auto-approved - proceed with constraints */
  GREEN = "GREEN",
  /** Requires refinement or review - can be upgraded to GREEN */
  YELLOW = "YELLOW",
  /** Denied - hard policy violation, cannot proceed */
  RED = "RED",
}

/**
 * Refinement action types for YELLOW decisions
 */
export enum RefinementAction {
  /** Reduce the scope of the request */
  REDUCE_SCOPE = "REDUCE_SCOPE",
  /** Add safety constraints */
  ADD_CONSTRAINTS = "ADD_CONSTRAINTS",
  /** Request human approval */
  REQUEST_APPROVAL = "REQUEST_APPROVAL",
  /** Provide additional context/justification */
  PROVIDE_CONTEXT = "PROVIDE_CONTEXT",
  /** Split into smaller sub-requests */
  DECOMPOSE = "DECOMPOSE",
  /** Wait for trust score to improve */
  WAIT_FOR_TRUST = "WAIT_FOR_TRUST",
}

/**
 * Workflow state for fluid governance
 */
export enum WorkflowState {
  /** Initial submission of intent */
  SUBMITTED = "SUBMITTED",
  /** Being evaluated by decision engine */
  EVALUATING = "EVALUATING",
  /** GREEN - approved and ready for execution */
  APPROVED = "APPROVED",
  /** YELLOW - awaiting refinement */
  PENDING_REFINEMENT = "PENDING_REFINEMENT",
  /** YELLOW - awaiting human review */
  PENDING_REVIEW = "PENDING_REVIEW",
  /** RED - denied */
  DENIED = "DENIED",
  /** Currently executing */
  EXECUTING = "EXECUTING",
  /** Completed successfully */
  COMPLETED = "COMPLETED",
  /** Failed during execution */
  FAILED = "FAILED",
  /** Cancelled by user/system */
  CANCELLED = "CANCELLED",
  /** Expired before completion */
  EXPIRED = "EXPIRED",
}
