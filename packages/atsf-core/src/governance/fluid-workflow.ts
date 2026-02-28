/**
 * Fluid Workflow State Machine
 *
 * Implements three-tier governance (GREEN/YELLOW/RED) with refinement support.
 * Wraps the governance engine to provide fluid decision-making.
 *
 * @packageDocumentation
 */

import { createLogger } from "../common/logger.js";
import type { ID, TrustLevel } from "../common/types.js";
import type {
  IGovernanceEngine,
  GovernanceRequest,
  GovernanceResult,
} from "./types.js";

const logger = createLogger({ component: "fluid-workflow" });

// ============================================================================
// TYPES
// ============================================================================

/**
 * Decision tier for fluid governance
 */
export type DecisionTier = "GREEN" | "YELLOW" | "RED";

/**
 * Refinement action types
 */
export type RefinementAction =
  | "REDUCE_SCOPE"
  | "ADD_CONSTRAINTS"
  | "REQUEST_APPROVAL"
  | "PROVIDE_CONTEXT"
  | "DECOMPOSE"
  | "WAIT_FOR_TRUST";

/**
 * Workflow state
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
 * Refinement option presented to agent
 */
export interface RefinementOption {
  id: string;
  action: RefinementAction;
  description: string;
  successProbability: number;
  effort: "low" | "medium" | "high";
  parameters?: Record<string, unknown>;
}

/**
 * Fluid decision - extends governance result with tier
 */
export interface FluidDecision {
  /** Unique decision ID */
  decisionId: string;
  /** Decision tier */
  tier: DecisionTier;
  /** Underlying governance result */
  governanceResult: GovernanceResult;
  /** Refinement options for YELLOW decisions */
  refinementOptions?: RefinementOption[];
  /** Refinement deadline */
  refinementDeadline?: Date;
  /** Max refinement attempts */
  maxRefinementAttempts: number;
  /** Current attempt */
  refinementAttempt: number;
  /** Original decision ID if refined */
  originalDecisionId?: string;
  /** For RED: is this a hard denial? */
  hardDenial?: boolean;
  /** Violated policies */
  violatedPolicies?: Array<{
    policyId: string;
    name: string;
    severity: string;
  }>;
  /** Created timestamp */
  createdAt: Date;
}

/**
 * State transition record
 */
export interface StateTransition {
  from: WorkflowState;
  to: WorkflowState;
  reason: string;
  timestamp: Date;
  decisionId?: string;
}

/**
 * Workflow instance
 */
export interface WorkflowInstance {
  workflowId: string;
  intentId: string;
  agentId: string;
  correlationId: string;
  state: WorkflowState;
  decisions: FluidDecision[];
  currentDecisionId?: string;
  stateHistory: StateTransition[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

/**
 * Refinement request from agent
 */
export interface RefinementRequest {
  workflowId: string;
  selectedRefinements: string[];
  modifiedRequest?: Partial<GovernanceRequest>;
  context?: Record<string, unknown>;
}

/**
 * Configuration for fluid workflow
 */
export interface FluidWorkflowConfig {
  /** Default refinement deadline in ms */
  refinementDeadlineMs: number;
  /** Max refinement attempts */
  maxRefinementAttempts: number;
  /** Workflow expiry in ms */
  workflowExpiryMs: number;
  /** Trust threshold for GREEN (0-1) */
  greenThreshold: number;
  /** Trust threshold for YELLOW (0-1) - below this is RED */
  yellowThreshold: number;
}

const DEFAULT_CONFIG: FluidWorkflowConfig = {
  refinementDeadlineMs: 5 * 60 * 1000, // 5 minutes
  maxRefinementAttempts: 3,
  workflowExpiryMs: 30 * 60 * 1000, // 30 minutes
  greenThreshold: 0.8,
  yellowThreshold: 0.4,
};

// ============================================================================
// STATE MACHINE
// ============================================================================

/**
 * Valid state transitions
 */
const VALID_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  SUBMITTED: ["EVALUATING", "CANCELLED", "EXPIRED"],
  EVALUATING: [
    "APPROVED",
    "PENDING_REFINEMENT",
    "PENDING_REVIEW",
    "DENIED",
    "CANCELLED",
  ],
  APPROVED: ["EXECUTING", "CANCELLED", "EXPIRED"],
  PENDING_REFINEMENT: ["EVALUATING", "DENIED", "CANCELLED", "EXPIRED"],
  PENDING_REVIEW: ["APPROVED", "DENIED", "CANCELLED", "EXPIRED"],
  DENIED: [], // Terminal
  EXECUTING: ["COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [], // Terminal
  FAILED: [], // Terminal
  CANCELLED: [], // Terminal
  EXPIRED: [], // Terminal
};

/**
 * Check if a state transition is valid
 */
function isValidTransition(from: WorkflowState, to: WorkflowState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ============================================================================
// FLUID WORKFLOW ENGINE
// ============================================================================

/**
 * Fluid Workflow Engine
 *
 * Manages the lifecycle of intents through three-tier governance.
 */
export class FluidWorkflowEngine {
  private config: FluidWorkflowConfig;
  private governanceEngine: IGovernanceEngine;
  private workflows: Map<string, WorkflowInstance> = new Map();

  constructor(
    governanceEngine: IGovernanceEngine,
    config: Partial<FluidWorkflowConfig> = {},
  ) {
    this.governanceEngine = governanceEngine;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Submit a new intent for governance evaluation
   */
  async submit(
    request: GovernanceRequest,
  ): Promise<{ workflow: WorkflowInstance; decision: FluidDecision }> {
    const workflowId = crypto.randomUUID();
    const now = new Date();

    // Create workflow instance
    const workflow: WorkflowInstance = {
      workflowId,
      intentId: request.requestId,
      agentId: request.entityId,
      correlationId: crypto.randomUUID(),
      state: "SUBMITTED",
      decisions: [],
      stateHistory: [],
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + this.config.workflowExpiryMs),
    };

    this.workflows.set(workflowId, workflow);

    logger.info(
      {
        workflowId,
        agentId: request.entityId,
        action: request.action,
      },
      "Workflow submitted",
    );

    // Transition to EVALUATING
    this.transition(workflow, "EVALUATING", "Initial evaluation");

    // Evaluate the request
    const decision = await this.evaluate(workflow, request);

    return { workflow, decision };
  }

  /**
   * Evaluate a governance request and produce a fluid decision
   */
  private async evaluate(
    workflow: WorkflowInstance,
    request: GovernanceRequest,
  ): Promise<FluidDecision> {
    const governanceResult = await this.governanceEngine.evaluate(request);
    const decisionId = crypto.randomUUID();

    // Determine tier based on decision and confidence
    const tier = this.determineTier(governanceResult, request.trustLevel);

    // Generate refinement options for YELLOW
    const refinementOptions =
      tier === "YELLOW"
        ? this.generateRefinementOptions(governanceResult, request)
        : undefined;

    // Create fluid decision
    const decision: FluidDecision = {
      decisionId,
      tier,
      governanceResult,
      refinementOptions,
      refinementDeadline:
        tier === "YELLOW"
          ? new Date(Date.now() + this.config.refinementDeadlineMs)
          : undefined,
      maxRefinementAttempts: this.config.maxRefinementAttempts,
      refinementAttempt: workflow.decisions.length,
      originalDecisionId: workflow.decisions[0]?.decisionId,
      hardDenial: tier === "RED" && this.isHardDenial(governanceResult),
      violatedPolicies:
        tier === "RED"
          ? this.extractViolatedPolicies(governanceResult)
          : undefined,
      createdAt: new Date(),
    };

    // Add to workflow
    workflow.decisions.push(decision);
    workflow.currentDecisionId = decisionId;
    workflow.updatedAt = new Date();

    // Transition based on tier
    switch (tier) {
      case "GREEN":
        this.transition(workflow, "APPROVED", "Request approved");
        break;
      case "YELLOW":
        this.transition(
          workflow,
          "PENDING_REFINEMENT",
          "Refinement required",
          decisionId,
        );
        break;
      case "RED":
        this.transition(
          workflow,
          "DENIED",
          governanceResult.explanation,
          decisionId,
        );
        break;
    }

    logger.info(
      {
        workflowId: workflow.workflowId,
        decisionId,
        tier,
        confidence: governanceResult.confidence,
      },
      "Decision made",
    );

    return decision;
  }

  /**
   * Determine decision tier based on governance result
   */
  private determineTier(
    result: GovernanceResult,
    _trustLevel: TrustLevel,
  ): DecisionTier {
    // Hard disqualifiers and regulatory mandates = RED
    if (
      result.decidingRule.category === "hard_disqualifier" ||
      result.decidingRule.category === "regulatory_mandate"
    ) {
      if (result.decision === "deny") {
        return "RED";
      }
    }

    // High confidence allow = GREEN
    if (
      result.decision === "allow" &&
      result.confidence >= this.config.greenThreshold
    ) {
      return "GREEN";
    }

    // Clear deny with low confidence or clarification needed = YELLOW
    if (
      result.clarificationNeeded ||
      result.confidence < this.config.greenThreshold
    ) {
      if (result.confidence >= this.config.yellowThreshold) {
        return "YELLOW";
      }
    }

    // Low trust or low confidence deny = RED
    if (
      result.decision === "deny" ||
      result.confidence < this.config.yellowThreshold
    ) {
      return "RED";
    }

    // Default to YELLOW for uncertain cases
    return "YELLOW";
  }

  /**
   * Generate refinement options for YELLOW decisions
   */
  private generateRefinementOptions(
    result: GovernanceResult,
    request: GovernanceRequest,
  ): RefinementOption[] {
    const options: RefinementOption[] = [];

    // If clarification is needed, add that option
    if (result.clarificationNeeded) {
      options.push({
        id: crypto.randomUUID(),
        action: "PROVIDE_CONTEXT",
        description: result.clarificationNeeded.question,
        successProbability: 0.7,
        effort: "low",
        parameters: {
          options: result.clarificationNeeded.options,
        },
      });
    }

    // Scope reduction
    if (request.resources.length > 1) {
      options.push({
        id: crypto.randomUUID(),
        action: "REDUCE_SCOPE",
        description: "Reduce the number of resources in the request",
        successProbability: 0.6,
        effort: "low",
        parameters: {
          currentResources: request.resources,
        },
      });
    }

    // Add constraints
    if (result.constraints.length === 0) {
      options.push({
        id: crypto.randomUUID(),
        action: "ADD_CONSTRAINTS",
        description: "Add monitoring or rate limiting constraints",
        successProbability: 0.5,
        effort: "low",
      });
    }

    // Request approval
    options.push({
      id: crypto.randomUUID(),
      action: "REQUEST_APPROVAL",
      description: "Request human approval for this action",
      successProbability: 0.8,
      effort: "medium",
    });

    // Decompose into smaller requests
    if (request.capabilities.length > 2) {
      options.push({
        id: crypto.randomUUID(),
        action: "DECOMPOSE",
        description: "Break down into smaller, more specific requests",
        successProbability: 0.65,
        effort: "medium",
      });
    }

    return options;
  }

  /**
   * Check if a RED decision is a hard denial
   */
  private isHardDenial(result: GovernanceResult): boolean {
    return (
      result.decidingRule.category === "hard_disqualifier" ||
      result.decidingRule.category === "regulatory_mandate"
    );
  }

  /**
   * Extract violated policies from result
   */
  private extractViolatedPolicies(
    result: GovernanceResult,
  ): Array<{ policyId: string; name: string; severity: string }> {
    return result.rulesMatched
      .filter((r) => r.effect?.action === "deny")
      .map((r) => ({
        policyId: r.ruleId,
        name: r.ruleName,
        severity: r.category === "hard_disqualifier" ? "critical" : "error",
      }));
  }

  /**
   * Submit a refinement for a YELLOW decision
   */
  async refine(refinementRequest: RefinementRequest): Promise<{
    success: boolean;
    decision: FluidDecision;
    remainingAttempts: number;
  }> {
    const workflow = this.workflows.get(refinementRequest.workflowId);

    if (!workflow) {
      throw new Error(`Workflow not found: ${refinementRequest.workflowId}`);
    }

    if (workflow.state !== "PENDING_REFINEMENT") {
      throw new Error(`Cannot refine workflow in state: ${workflow.state}`);
    }

    const currentDecision = workflow.decisions[workflow.decisions.length - 1];
    if (!currentDecision || currentDecision.tier !== "YELLOW") {
      throw new Error("No YELLOW decision to refine");
    }

    if (
      currentDecision.refinementAttempt >= this.config.maxRefinementAttempts
    ) {
      throw new Error("Maximum refinement attempts exceeded");
    }

    // Build modified request
    const originalRequest = refinementRequest.modifiedRequest ?? {
      requestId: workflow.intentId,
      entityId: workflow.agentId,
      trustLevel: 0 as TrustLevel,
      action: "",
      capabilities: [],
      resources: [],
      context: {},
    };

    // Apply refinements
    const modifiedRequest: GovernanceRequest = {
      ...originalRequest,
      requestId: originalRequest.requestId ?? workflow.intentId,
      entityId: originalRequest.entityId ?? workflow.agentId,
      trustLevel: originalRequest.trustLevel ?? (0 as TrustLevel),
      action: originalRequest.action ?? "",
      capabilities: originalRequest.capabilities ?? [],
      resources: originalRequest.resources ?? [],
      context: {
        ...originalRequest.context,
        refinementAttempt: currentDecision.refinementAttempt + 1,
        appliedRefinements: refinementRequest.selectedRefinements,
        originalDecisionId: currentDecision.decisionId,
      },
    };

    logger.info(
      {
        workflowId: workflow.workflowId,
        refinements: refinementRequest.selectedRefinements,
        attempt: currentDecision.refinementAttempt + 1,
      },
      "Processing refinement",
    );

    // Transition back to EVALUATING
    this.transition(workflow, "EVALUATING", "Re-evaluating after refinement");

    // Re-evaluate
    const newDecision = await this.evaluate(workflow, modifiedRequest);

    const success = newDecision.tier === "GREEN";
    const remainingAttempts =
      this.config.maxRefinementAttempts - newDecision.refinementAttempt;

    return { success, decision: newDecision, remainingAttempts };
  }

  /**
   * Request human review for a YELLOW decision
   */
  async requestReview(workflowId: string, reason: string): Promise<void> {
    const workflow = this.workflows.get(workflowId);

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (workflow.state !== "PENDING_REFINEMENT") {
      throw new Error(`Cannot request review in state: ${workflow.state}`);
    }

    this.transition(workflow, "PENDING_REVIEW", reason);

    logger.info({ workflowId, reason }, "Review requested");
  }

  /**
   * Approve a workflow (for human review)
   */
  async approve(
    workflowId: string,
    approver: string,
    reason: string,
  ): Promise<void> {
    const workflow = this.workflows.get(workflowId);

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (workflow.state !== "PENDING_REVIEW") {
      throw new Error(`Cannot approve workflow in state: ${workflow.state}`);
    }

    this.transition(workflow, "APPROVED", `Approved by ${approver}: ${reason}`);

    logger.info({ workflowId, approver, reason }, "Workflow approved");
  }

  /**
   * Deny a workflow (for human review)
   */
  async deny(
    workflowId: string,
    approver: string,
    reason: string,
  ): Promise<void> {
    const workflow = this.workflows.get(workflowId);

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (workflow.state !== "PENDING_REVIEW") {
      throw new Error(`Cannot deny workflow in state: ${workflow.state}`);
    }

    this.transition(workflow, "DENIED", `Denied by ${approver}: ${reason}`);

    logger.info({ workflowId, approver, reason }, "Workflow denied");
  }

  /**
   * Start execution of an approved workflow
   */
  async startExecution(workflowId: string): Promise<void> {
    const workflow = this.workflows.get(workflowId);

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (workflow.state !== "APPROVED") {
      throw new Error(`Cannot start execution in state: ${workflow.state}`);
    }

    this.transition(workflow, "EXECUTING", "Execution started");

    logger.info({ workflowId }, "Execution started");
  }

  /**
   * Complete a workflow
   */
  async complete(workflowId: string): Promise<void> {
    const workflow = this.workflows.get(workflowId);

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (workflow.state !== "EXECUTING") {
      throw new Error(`Cannot complete workflow in state: ${workflow.state}`);
    }

    this.transition(workflow, "COMPLETED", "Execution completed successfully");

    logger.info({ workflowId }, "Workflow completed");
  }

  /**
   * Mark a workflow as failed
   */
  async fail(workflowId: string, error: string): Promise<void> {
    const workflow = this.workflows.get(workflowId);

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (workflow.state !== "EXECUTING") {
      throw new Error(`Cannot fail workflow in state: ${workflow.state}`);
    }

    this.transition(workflow, "FAILED", `Execution failed: ${error}`);

    logger.error({ workflowId, error }, "Workflow failed");
  }

  /**
   * Cancel a workflow
   */
  async cancel(workflowId: string, reason: string): Promise<void> {
    const workflow = this.workflows.get(workflowId);

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const terminalStates: WorkflowState[] = [
      "DENIED",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "EXPIRED",
    ];
    if (terminalStates.includes(workflow.state)) {
      throw new Error(
        `Cannot cancel workflow in terminal state: ${workflow.state}`,
      );
    }

    this.transition(workflow, "CANCELLED", reason);

    logger.info({ workflowId, reason }, "Workflow cancelled");
  }

  /**
   * Get a workflow by ID
   */
  get(workflowId: string): WorkflowInstance | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * Get all workflows for an agent
   */
  getByAgent(agentId: ID): WorkflowInstance[] {
    return Array.from(this.workflows.values()).filter(
      (w) => w.agentId === agentId,
    );
  }

  /**
   * Transition a workflow to a new state
   */
  private transition(
    workflow: WorkflowInstance,
    to: WorkflowState,
    reason: string,
    decisionId?: string,
  ): void {
    const from = workflow.state;

    if (!isValidTransition(from, to)) {
      throw new Error(`Invalid state transition: ${from} -> ${to}`);
    }

    workflow.state = to;
    workflow.updatedAt = new Date();
    workflow.stateHistory.push({
      from,
      to,
      reason,
      timestamp: new Date(),
      decisionId,
    });

    logger.debug(
      {
        workflowId: workflow.workflowId,
        from,
        to,
        reason,
      },
      "State transition",
    );
  }

  /**
   * Check for expired workflows and transition them
   */
  expireStaleWorkflows(): number {
    const now = new Date();
    let expired = 0;

    for (const workflow of this.workflows.values()) {
      const terminalStates: WorkflowState[] = [
        "DENIED",
        "COMPLETED",
        "FAILED",
        "CANCELLED",
        "EXPIRED",
      ];
      if (
        !terminalStates.includes(workflow.state) &&
        workflow.expiresAt < now
      ) {
        this.transition(workflow, "EXPIRED", "Workflow expired");
        expired++;
      }
    }

    if (expired > 0) {
      logger.info({ expired }, "Expired stale workflows");
    }

    return expired;
  }

  /**
   * Get workflow statistics
   */
  getStats(): {
    total: number;
    byState: Record<WorkflowState, number>;
    avgDecisionsPerWorkflow: number;
  } {
    const byState: Record<WorkflowState, number> = {
      SUBMITTED: 0,
      EVALUATING: 0,
      APPROVED: 0,
      PENDING_REFINEMENT: 0,
      PENDING_REVIEW: 0,
      DENIED: 0,
      EXECUTING: 0,
      COMPLETED: 0,
      FAILED: 0,
      CANCELLED: 0,
      EXPIRED: 0,
    };

    let totalDecisions = 0;

    for (const workflow of this.workflows.values()) {
      byState[workflow.state]++;
      totalDecisions += workflow.decisions.length;
    }

    return {
      total: this.workflows.size,
      byState,
      avgDecisionsPerWorkflow:
        this.workflows.size > 0 ? totalDecisions / this.workflows.size : 0,
    };
  }
}

/**
 * Create a new fluid workflow engine
 */
export function createFluidWorkflowEngine(
  governanceEngine: IGovernanceEngine,
  config?: Partial<FluidWorkflowConfig>,
): FluidWorkflowEngine {
  return new FluidWorkflowEngine(governanceEngine, config);
}
