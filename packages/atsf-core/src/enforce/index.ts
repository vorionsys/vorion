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

import { createLogger } from '../common/logger.js';
import type {
  Intent,
  ControlAction,
  TrustLevel,
  TrustScore,
  ID,
  Timestamp,
} from '../common/types.js';
import type { EvaluationResult, RuleResult } from '../basis/types.js';

const logger = createLogger({ component: 'enforce' });

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
export type DecisionTier = 'GREEN' | 'YELLOW' | 'RED';

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
  type: 'none' | 'human_review' | 'automated_check' | 'multi_party';
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
  | 'REDUCE_SCOPE'
  | 'ADD_CONSTRAINTS'
  | 'REQUEST_APPROVAL'
  | 'PROVIDE_CONTEXT'
  | 'DECOMPOSE'
  | 'WAIT_FOR_TRUST';

/**
 * Refinement option for YELLOW decisions
 */
export interface RefinementOption {
  id: ID;
  action: RefinementAction;
  description: string;
  successProbability: number;
  effort: 'low' | 'medium' | 'high';
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
    severity: 'warning' | 'error' | 'critical';
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
  | 'SUBMITTED'
  | 'EVALUATING'
  | 'APPROVED'
  | 'PENDING_REFINEMENT'
  | 'PENDING_REVIEW'
  | 'DENIED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

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
    status: 'running' | 'completed' | 'failed';
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
  reasonCategory?: 'trust_insufficient' | 'high_risk' | 'policy_violation' | 'manual_review';
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
  refine(request: RefinementRequest, tenantId: ID): Promise<FluidDecisionResult | null>;
  getDecision(id: ID, tenantId: ID): Promise<FluidDecision | null>;
  getWorkflow(intentId: ID, tenantId: ID): Promise<WorkflowInstance | null>;
  setPolicy(policy: EnforcementPolicy): void;
}

// =============================================================================
// MOCK IMPLEMENTATION
// =============================================================================

const DEFAULT_POLICY: EnforcementPolicy = {
  defaultAction: 'deny',
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
      permitted: tier === 'GREEN',
      trustBand: `T${trustLevel}_${this.getTrustBandName(trustLevel)}`,
      trustScore,
      reasoning: this.buildReasoning(tier, evaluation, trustLevel),
      refinementAttempt: 0,
      decidedAt: now,
      expiresAt: new Date(Date.now() + (this.policy.decisionExpirationMs ?? 3600000)).toISOString(),
      latencyMs: 1,
    };

    // Add constraints for GREEN
    if (tier === 'GREEN') {
      decision.constraints = {
        allowedTools: ['*'],
        dataScopes: ['*'],
        rateLimits: [],
        requiredApprovals: [],
        reversibilityRequired: false,
        maxRetries: 3,
      };
    }

    // Add refinement options for YELLOW
    if (tier === 'YELLOW') {
      decision.refinementDeadline = new Date(Date.now() + (this.policy.refinementDeadlineMs ?? 900000)).toISOString();
      decision.maxRefinementAttempts = this.policy.maxRefinementAttempts ?? 3;
      decision.refinementOptions = [
        {
          id: crypto.randomUUID(),
          action: 'ADD_CONSTRAINTS',
          description: 'Accept additional constraints',
          successProbability: 0.9,
          effort: 'low',
        },
        {
          id: crypto.randomUUID(),
          action: 'REQUEST_APPROVAL',
          description: 'Request human approval',
          successProbability: 0.7,
          effort: 'medium',
        },
      ];
    }

    // Add denial details for RED
    if (tier === 'RED') {
      decision.denialReason = 'policy_violation';
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
        { from: 'SUBMITTED' as WorkflowState, to: this.tierToState(tier), reason: `Decision: ${tier}`, timestamp: now },
      ],
      createdAt: now,
      updatedAt: now,
      expiresAt: decision.expiresAt,
    };

    this.workflows.set(intent.id, workflow);

    logger.info(
      { decisionId: decision.id, intentId: intent.id, tier },
      'Enforcement decision made (mock)'
    );

    return { decision, workflow, tier, refinementOptions: decision.refinementOptions };
  }

  async refine(request: RefinementRequest, tenantId: ID): Promise<FluidDecisionResult | null> {
    const original = this.decisions.get(request.decisionId);
    if (!original || original.tier !== 'YELLOW') return null;

    const now = new Date().toISOString();

    // Create refined decision (simple: just upgrade to GREEN)
    const refined: FluidDecision = {
      ...original,
      id: crypto.randomUUID(),
      tier: 'GREEN',
      permitted: true,
      refinementAttempt: original.refinementAttempt + 1,
      reasoning: ['Refined to GREEN after applying constraints'],
      constraints: {
        allowedTools: ['*'],
        dataScopes: ['*'],
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
      workflow.state = 'APPROVED';
      workflow.currentDecisionId = refined.id;
      workflow.updatedAt = now;
      workflow.stateHistory.push({
        from: 'PENDING_REFINEMENT',
        to: 'APPROVED',
        reason: 'Refined to GREEN',
        timestamp: now,
      });
    }

    return { decision: refined, workflow: workflow!, tier: 'GREEN' };
  }

  async getDecision(id: ID, tenantId: ID): Promise<FluidDecision | null> {
    const decision = this.decisions.get(id);
    return decision?.tenantId === tenantId ? decision : null;
  }

  async getWorkflow(intentId: ID, tenantId: ID): Promise<WorkflowInstance | null> {
    const workflow = this.workflows.get(intentId);
    return workflow?.tenantId === tenantId ? workflow : null;
  }

  setPolicy(policy: EnforcementPolicy): void {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  private determineTier(evaluation: EvaluationResult, trustLevel: TrustLevel): DecisionTier {
    const thresholds = this.policy.trustThresholds!;

    if (evaluation.violatedRules.some((r) => r.action === 'deny' || r.action === 'terminate')) {
      return 'RED';
    }
    if (trustLevel < thresholds.autoDenyLevel) return 'RED';
    if (trustLevel < thresholds.requireRefinementLevel) return 'YELLOW';
    if (trustLevel >= thresholds.autoApproveLevel && evaluation.passed) return 'GREEN';
    return 'YELLOW';
  }

  private buildReasoning(tier: DecisionTier, evaluation: EvaluationResult, trustLevel: TrustLevel): string[] {
    if (tier === 'GREEN') return ['All checks passed', `Trust T${trustLevel} meets requirements`];
    if (tier === 'YELLOW') return ['Refinement options available'];
    return ['Policy violation', 'Request cannot proceed'];
  }

  private tierToState(tier: DecisionTier): WorkflowState {
    return tier === 'GREEN' ? 'APPROVED' : tier === 'YELLOW' ? 'PENDING_REFINEMENT' : 'DENIED';
  }

  private getTrustBandName(level: TrustLevel): string {
    const names = ['SANDBOX', 'OBSERVED', 'PROVISIONAL', 'MONITORED', 'STANDARD', 'TRUSTED', 'CERTIFIED', 'AUTONOMOUS'];
    return names[level] ?? 'SANDBOX';
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
      'No enforcement service backend configured. Pass a real EnforcementService implementation or see docs for setup.'
    );
  }
  return enforcementService;
}

/**
 * Create a new enforcement service instance
 *
 * Throws if no real backend is provided. For tests, use createMockEnforcementService().
 */
export function createEnforcementService(service?: IEnforcementService): IEnforcementService {
  if (!service) {
    throw new Error(
      'No enforcement service backend configured. Pass a real EnforcementService implementation or see docs for setup.'
    );
  }
  return service;
}

/**
 * Create a mock enforcement service for testing only.
 */
export function createMockEnforcementService(policy?: EnforcementPolicy): MockEnforcementService {
  return new MockEnforcementService(policy);
}

// =============================================================================
// PRODUCTION IMPLEMENTATION
// =============================================================================

export { TrustAwareEnforcementService } from './trust-aware-enforcement-service.js';
export type { TrustAwareEnforcementConfig } from './trust-aware-enforcement-service.js';
