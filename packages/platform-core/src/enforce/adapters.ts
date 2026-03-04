/**
 * Decision Adapters
 *
 * Provides conversion between internal Decision type and canonical
 * Decision/FluidDecision types from @vorion/contracts.
 *
 * @packageDocumentation
 */

import {
  TrustBand,
  DecisionTier,
  RefinementAction,
  ApprovalType,
  DenialReason,
} from '@vorionsys/contracts';
import type {
  Decision as CanonicalDecision,
  FluidDecision as CanonicalFluidDecision,
  DecisionConstraints as CanonicalDecisionConstraints,
  RefinementOption as CanonicalRefinementOption,
  WorkflowInstance as CanonicalWorkflowInstance,
  RateLimit,
  ApprovalRequirement,
} from '@vorionsys/contracts';
import type {
  Decision as InternalDecision,
  DecisionConstraints as InternalDecisionConstraints,
  RefinementOption as InternalRefinementOption,
  RefinementAction as InternalRefinementAction,
  WorkflowInstance as InternalWorkflowInstance,
} from './repository.js';
import type { TrustLevel } from '../common/types.js';

// =============================================================================
// TRUST BAND MAPPING
// =============================================================================

const TRUST_BAND_MAP: Record<string, TrustBand> = {
  T0_SANDBOX: TrustBand.T0_SANDBOX,
  T1_OBSERVED: TrustBand.T1_OBSERVED,
  T2_PROVISIONAL: TrustBand.T2_PROVISIONAL,
  T3_MONITORED: TrustBand.T3_MONITORED,
  T4_STANDARD: TrustBand.T4_STANDARD,
  T5_TRUSTED: TrustBand.T5_TRUSTED,
  T6_CERTIFIED: TrustBand.T6_CERTIFIED,
  T7_AUTONOMOUS: TrustBand.T7_AUTONOMOUS,
};

const TRUST_LEVEL_TO_BAND: Record<TrustLevel, TrustBand> = {
  0: TrustBand.T0_SANDBOX,
  1: TrustBand.T1_OBSERVED,
  2: TrustBand.T2_PROVISIONAL,
  3: TrustBand.T3_MONITORED,
  4: TrustBand.T4_STANDARD,
  5: TrustBand.T5_TRUSTED,
  6: TrustBand.T6_CERTIFIED,
  7: TrustBand.T7_AUTONOMOUS,
};

/**
 * Parse trust band string to enum
 */
export function parseTrustBand(value: string | TrustLevel): TrustBand {
  if (typeof value === 'number') {
    return TRUST_LEVEL_TO_BAND[value as TrustLevel] ?? TrustBand.T0_SANDBOX;
  }
  return TRUST_BAND_MAP[value] ?? TrustBand.T0_SANDBOX;
}

/**
 * Convert trust band enum to string
 */
export function trustBandToString(band: TrustBand): string {
  const entries = Object.entries(TRUST_BAND_MAP);
  for (const [key, value] of entries) {
    if (value === band) return key;
  }
  return 'T0_SANDBOX';
}

// =============================================================================
// DECISION TIER MAPPING
// =============================================================================

const DECISION_TIER_MAP: Record<string, DecisionTier> = {
  GREEN: DecisionTier.GREEN,
  YELLOW: DecisionTier.YELLOW,
  RED: DecisionTier.RED,
};

/**
 * Parse decision tier string to enum
 */
export function parseDecisionTier(value: string): DecisionTier {
  return DECISION_TIER_MAP[value] ?? DecisionTier.RED;
}

// =============================================================================
// REFINEMENT ACTION MAPPING
// =============================================================================

const REFINEMENT_ACTION_MAP: Record<string, RefinementAction> = {
  REDUCE_SCOPE: RefinementAction.REDUCE_SCOPE,
  ADD_CONSTRAINTS: RefinementAction.ADD_CONSTRAINTS,
  REQUEST_APPROVAL: RefinementAction.REQUEST_APPROVAL,
  PROVIDE_CONTEXT: RefinementAction.PROVIDE_CONTEXT,
  DECOMPOSE: RefinementAction.DECOMPOSE,
  WAIT_FOR_TRUST: RefinementAction.WAIT_FOR_TRUST,
};

/**
 * Parse refinement action string to enum
 */
export function parseRefinementAction(value: string): RefinementAction {
  return REFINEMENT_ACTION_MAP[value] ?? RefinementAction.ADD_CONSTRAINTS;
}

// =============================================================================
// APPROVAL TYPE MAPPING
// =============================================================================

const APPROVAL_TYPE_MAP: Record<string, ApprovalType> = {
  none: ApprovalType.NONE,
  human_review: ApprovalType.HUMAN_REVIEW,
  automated_check: ApprovalType.AUTOMATED_CHECK,
  multi_party: ApprovalType.MULTI_PARTY,
};

/**
 * Parse approval type string to enum
 */
export function parseApprovalType(value: string): ApprovalType {
  return APPROVAL_TYPE_MAP[value] ?? ApprovalType.NONE;
}

// =============================================================================
// DENIAL REASON MAPPING
// =============================================================================

const DENIAL_REASON_MAP: Record<string, DenialReason> = {
  insufficient_trust: DenialReason.INSUFFICIENT_TRUST,
  policy_violation: DenialReason.POLICY_VIOLATION,
  resource_restricted: DenialReason.RESOURCE_RESTRICTED,
  data_sensitivity_exceeded: DenialReason.DATA_SENSITIVITY_EXCEEDED,
  rate_limit_exceeded: DenialReason.RATE_LIMIT_EXCEEDED,
  context_mismatch: DenialReason.CONTEXT_MISMATCH,
  expired_intent: DenialReason.EXPIRED_INTENT,
  system_error: DenialReason.SYSTEM_ERROR,
};

/**
 * Parse denial reason string to enum
 */
export function parseDenialReason(value: string | null | undefined): DenialReason | undefined {
  if (!value) return undefined;
  return DENIAL_REASON_MAP[value];
}

// =============================================================================
// INTERNAL TO CANONICAL
// =============================================================================

/**
 * Convert internal constraints to canonical format
 */
export function toCanonicalConstraints(
  internal: InternalDecisionConstraints
): CanonicalDecisionConstraints {
  return {
    allowedTools: internal.allowedTools,
    dataScopes: internal.dataScopes,
    rateLimits: internal.rateLimits as RateLimit[],
    requiredApprovals: internal.requiredApprovals.map((a) => ({
      type: parseApprovalType(a.type),
      approver: a.approver,
      timeoutMs: a.timeoutMs,
      reason: a.reason,
    })) as ApprovalRequirement[],
    reversibilityRequired: internal.reversibilityRequired,
    maxExecutionTimeMs: internal.maxExecutionTimeMs ?? undefined,
    maxRetries: internal.maxRetries,
    resourceQuotas: internal.resourceQuotas ?? undefined,
  };
}

/**
 * Convert internal refinement option to canonical format
 */
export function toCanonicalRefinementOption(
  internal: InternalRefinementOption
): CanonicalRefinementOption {
  return {
    id: internal.id,
    action: parseRefinementAction(internal.action),
    description: internal.description,
    successProbability: internal.successProbability,
    effort: internal.effort,
    parameters: internal.parameters ?? undefined,
    resultingConstraints: internal.resultingConstraints as Partial<CanonicalDecisionConstraints> | undefined,
  };
}

/**
 * Convert internal decision to canonical Decision format
 */
export function toCanonicalDecision(internal: InternalDecision): CanonicalDecision {
  return {
    decisionId: internal.id,
    intentId: internal.intentId,
    agentId: internal.agentId,
    correlationId: internal.correlationId,
    permitted: internal.permitted,
    constraints: internal.constraints
      ? toCanonicalConstraints(internal.constraints)
      : undefined,
    trustBand: parseTrustBand(internal.trustBand),
    trustScore: internal.trustScore,
    policySetId: internal.policySetId ?? undefined,
    reasoning: internal.reasoning,
    decidedAt: new Date(internal.decidedAt),
    expiresAt: new Date(internal.expiresAt),
    latencyMs: internal.latencyMs,
    version: internal.version,
  };
}

/**
 * Convert internal decision to canonical FluidDecision format
 */
export function toCanonicalFluidDecision(internal: InternalDecision): CanonicalFluidDecision {
  const baseDecision = toCanonicalDecision(internal);

  return {
    ...baseDecision,
    tier: parseDecisionTier(internal.tier),
    refinementOptions: internal.refinementOptions?.map(toCanonicalRefinementOption),
    refinementDeadline: internal.refinementDeadline
      ? new Date(internal.refinementDeadline)
      : undefined,
    maxRefinementAttempts: internal.maxRefinementAttempts,
    refinementAttempt: internal.refinementAttempt,
    originalDecisionId: internal.originalDecisionId ?? undefined,
    appliedRefinements: internal.appliedRefinements?.map((r) => ({
      refinementId: r.refinementId,
      appliedAt: new Date(r.appliedAt),
    })),
    hardDenial: internal.hardDenial,
    violatedPolicies: internal.violatedPolicies ?? undefined,
  };
}

/**
 * Convert internal workflow to canonical format
 */
export function toCanonicalWorkflow(
  internal: InternalWorkflowInstance,
  decisions: InternalDecision[]
): CanonicalWorkflowInstance {
  return {
    workflowId: internal.id,
    intentId: internal.intentId,
    agentId: internal.agentId,
    correlationId: internal.correlationId,
    state: internal.state as any,
    decisions: decisions.map(toCanonicalFluidDecision),
    currentDecisionId: internal.currentDecisionId ?? undefined,
    createdAt: new Date(internal.createdAt),
    updatedAt: new Date(internal.updatedAt),
    expiresAt: new Date(internal.expiresAt),
    stateHistory: internal.stateHistory.map((h) => ({
      from: h.from as any,
      to: h.to as any,
      reason: h.reason,
      timestamp: new Date(h.timestamp),
    })),
    execution: internal.execution
      ? {
          executionId: internal.execution.executionId,
          startedAt: new Date(internal.execution.startedAt),
          completedAt: internal.execution.completedAt
            ? new Date(internal.execution.completedAt)
            : undefined,
          status: internal.execution.status,
          result: internal.execution.result,
          error: internal.execution.error,
        }
      : undefined,
  };
}

// =============================================================================
// CANONICAL TO INTERNAL
// =============================================================================

/**
 * Convert canonical constraints to internal format
 */
export function toInternalConstraints(
  canonical: CanonicalDecisionConstraints,
  decisionId: string,
  tenantId: string
): Omit<InternalDecisionConstraints, 'id' | 'createdAt'> {
  return {
    decisionId,
    tenantId,
    allowedTools: canonical.allowedTools,
    dataScopes: canonical.dataScopes,
    rateLimits: canonical.rateLimits,
    requiredApprovals: canonical.requiredApprovals.map((a) => ({
      type: a.type.toString(),
      approver: a.approver,
      timeoutMs: a.timeoutMs,
      reason: a.reason,
    })),
    reversibilityRequired: canonical.reversibilityRequired,
    maxExecutionTimeMs: canonical.maxExecutionTimeMs ?? null,
    maxRetries: canonical.maxRetries,
    resourceQuotas: canonical.resourceQuotas ?? null,
  };
}

/**
 * Convert canonical refinement option to internal format
 */
export function toInternalRefinementOption(
  canonical: CanonicalRefinementOption,
  decisionId: string,
  tenantId: string
): Omit<InternalRefinementOption, 'id' | 'createdAt' | 'selected' | 'appliedAt'> {
  return {
    decisionId,
    tenantId,
    action: canonical.action as InternalRefinementAction,
    description: canonical.description,
    successProbability: canonical.successProbability,
    effort: canonical.effort,
    parameters: canonical.parameters ?? null,
    resultingConstraints: canonical.resultingConstraints as Record<string, unknown> ?? null,
  };
}

// =============================================================================
// BATCH CONVERTERS
// =============================================================================

/**
 * Convert array of internal decisions to canonical format
 */
export function toCanonicalDecisions(internals: InternalDecision[]): CanonicalDecision[] {
  return internals.map(toCanonicalDecision);
}

/**
 * Convert array of internal decisions to canonical fluid format
 */
export function toCanonicalFluidDecisions(internals: InternalDecision[]): CanonicalFluidDecision[] {
  return internals.map(toCanonicalFluidDecision);
}
