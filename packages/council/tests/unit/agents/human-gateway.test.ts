import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TriageAgent,
  ContextBuilderAgent,
  DecisionTrackerAgent,
  HumanGatewayOrchestrator,
} from "../../../src/agents/human-gateway.js";
import type { CouncilState } from "../../../src/types/index.js";
import type { EscalationDecision } from "../../../src/agents/human-gateway.js";

function createBaseState(overrides?: Partial<CouncilState>): CouncilState {
  return {
    userRequest: "Help me build a product",
    userId: "user_test",
    requestId: "req_test_001",
    metadata: {
      priority: "medium",
      expectedResponseTime: 120,
      maxCost: 1.0,
      requiresHumanApproval: false,
    },
    currentStep: "qa_review",
    iterationCount: 0,
    errors: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("TriageAgent", () => {
  let triage: TriageAgent;

  beforeEach(() => {
    triage = new TriageAgent();
  });

  it("should return not required when no issues exist", () => {
    const state = createBaseState();
    const decision = triage.analyze(state);
    expect(decision.required).toBe(false);
    expect(decision.flags).toHaveLength(0);
  });

  it("should escalate on compliance failure", () => {
    const state = createBaseState({
      compliance: {
        passed: false,
        issues: [
          {
            severity: "high",
            type: "pii",
            description: "PII detected in request",
            detectedBy: "compliance_1",
            suggestedAction: "Route to self-hosted",
          },
        ],
        containsPII: true,
        sensitivityLevel: "restricted",
        checkedBy: ["compliance_1"],
      },
    });

    const decision = triage.analyze(state);
    expect(decision.required).toBe(true);
    expect(decision.severity).toBe("CRITICAL");
    expect(decision.escalationType).toBe("COMPLIANCE_FAILURE");
    expect(decision.flags.length).toBeGreaterThan(0);
  });

  it("should escalate on budget exceeded", () => {
    const state = createBaseState({
      metadata: { priority: "medium", maxCost: 0.1 },
      plan: {
        steps: [],
        estimatedCost: 5.0,
        estimatedTime: 300,
        complexity: "complex",
        createdBy: "master_planner",
      },
    });

    const decision = triage.analyze(state);
    expect(decision.required).toBe(true);
    expect(decision.flags.some((f) => f.type === "BUDGET_EXCEEDED")).toBe(true);
  });

  it("should escalate on low confidence output", () => {
    const state = createBaseState({
      output: {
        content: "Some response",
        confidence: 0.4,
        totalCost: 0.05,
        totalTime: 5,
        model: "gpt-4",
      },
    });

    const decision = triage.analyze(state);
    expect(decision.required).toBe(true);
    expect(decision.flags.some((f) => f.type === "LOW_CONFIDENCE")).toBe(true);
  });

  it("should escalate on multiple QA failures", () => {
    const state = createBaseState({
      qa: {
        passed: false,
        feedback: [],
        requiresRevision: true,
        revisedCount: 3,
        reviewedBy: ["qa_1"],
      },
    });

    const decision = triage.analyze(state);
    expect(decision.required).toBe(true);
    expect(decision.flags.some((f) => f.type === "QUALITY_ISSUE")).toBe(true);
  });

  it("should escalate when user requests human approval", () => {
    const state = createBaseState({
      metadata: {
        priority: "high",
        requiresHumanApproval: true,
      },
    });

    const decision = triage.analyze(state);
    expect(decision.required).toBe(true);
    expect(decision.escalationType).toBe("USER_REQUESTED");
    expect(decision.severity).toBe("HIGH");
  });

  it("should detect high-risk decisions (critical + high cost)", () => {
    const state = createBaseState({
      metadata: { priority: "critical" },
      plan: {
        steps: [],
        estimatedCost: 2.0,
        estimatedTime: 600,
        complexity: "complex",
        createdBy: "master_planner",
      },
    });

    const decision = triage.analyze(state);
    expect(decision.required).toBe(true);
    expect(decision.severity).toBe("CRITICAL");
    expect(decision.flags.some((f) => f.type === "HIGH_COST")).toBe(true);
  });

  it("should assign reviewer based on severity", () => {
    const state = createBaseState({
      compliance: {
        passed: false,
        issues: [
          {
            severity: "critical",
            type: "pii",
            description: "Critical PII",
            detectedBy: "compliance_1",
            suggestedAction: "Block",
          },
        ],
        containsPII: true,
        sensitivityLevel: "restricted",
        checkedBy: ["compliance_1"],
      },
    });

    const decision = triage.analyze(state);
    expect(decision.assignedTo).toBe("CEO");
  });

  it("should set deadline based on severity", () => {
    const state = createBaseState({
      metadata: {
        priority: "low",
        requiresHumanApproval: true,
      },
    });

    const decision = triage.analyze(state);
    expect(decision.deadline).toBeInstanceOf(Date);
    // LOW severity = 72 hours
    const expectedDeadline = Date.now() + 72 * 60 * 60 * 1000;
    expect(decision.deadline!.getTime()).toBeCloseTo(expectedDeadline, -3); // within ~1s
  });
});

describe("ContextBuilderAgent", () => {
  let contextAgent: ContextBuilderAgent;

  beforeEach(() => {
    contextAgent = new ContextBuilderAgent();
  });

  it("should build context summary with all sections", () => {
    const state = createBaseState({
      plan: {
        steps: [
          {
            id: "s1",
            description: "Step 1",
            assignTo: "advisor",
            estimatedCost: 0.05,
            estimatedTime: 60,
            dependencies: [],
            status: "pending",
          },
        ],
        estimatedCost: 0.05,
        estimatedTime: 60,
        complexity: "simple",
        createdBy: "master_planner",
      },
    });

    const decision: EscalationDecision = {
      required: true,
      severity: "HIGH",
      escalationType: "BUDGET_EXCEEDED",
      reason: "Budget exceeded",
      flags: [
        {
          type: "BUDGET_EXCEEDED",
          severity: "ERROR",
          title: "Budget Exceeded",
          description: "Over budget",
          detectedBy: "triage",
          context: {},
        },
      ],
    };

    const result = contextAgent.buildContext(state, decision);
    expect(result.contextSummary).toContain("Request ID");
    expect(result.contextSummary).toContain("req_test_001");
    expect(result.contextSummary).toContain("Budget Exceeded");
    expect(result.recommendedAction).toContain("RECOMMENDED ACTION");
    expect(result.estimatedImpact).toContain("Cost Impact");
  });

  it("should recommend REJECT for compliance failures", () => {
    const state = createBaseState();
    const decision: EscalationDecision = {
      required: true,
      severity: "CRITICAL",
      escalationType: "COMPLIANCE_FAILURE",
      reason: "Compliance violation",
      flags: [],
    };

    const result = contextAgent.buildContext(state, decision);
    expect(result.recommendedAction).toContain("REJECT");
  });

  it("should recommend REVIEW BUDGET for budget issues", () => {
    const state = createBaseState();
    const decision: EscalationDecision = {
      required: true,
      severity: "HIGH",
      escalationType: "BUDGET_EXCEEDED",
      reason: "Budget exceeded",
      flags: [],
    };

    const result = contextAgent.buildContext(state, decision);
    expect(result.recommendedAction).toContain("REVIEW BUDGET");
  });

  it("should recommend REVIEW OUTPUT for low confidence", () => {
    const state = createBaseState();
    const decision: EscalationDecision = {
      required: true,
      severity: "MEDIUM",
      escalationType: "LOW_CONFIDENCE",
      reason: "Low confidence",
      flags: [],
    };

    const result = contextAgent.buildContext(state, decision);
    expect(result.recommendedAction).toContain("REVIEW OUTPUT");
  });
});

describe("DecisionTrackerAgent", () => {
  let tracker: DecisionTrackerAgent;

  beforeEach(() => {
    tracker = new DecisionTrackerAgent();
  });

  it("should create a review with unique ID", async () => {
    const state = createBaseState();
    const decision: EscalationDecision = {
      required: true,
      severity: "HIGH",
      escalationType: "BUDGET_EXCEEDED",
      reason: "Budget exceeded",
      flags: [],
    };
    const context = {
      contextSummary: "Summary",
      recommendedAction: "Review",
      estimatedImpact: "Medium",
    };

    const reviewId = await tracker.createReview(state, decision, context);
    expect(reviewId).toMatch(/^review_\d+_/);
  });

  it("should track decisions without error", async () => {
    // trackDecision should complete without throwing
    await expect(
      tracker.trackDecision("review_123", "APPROVE", "admin_1", "Looks good"),
    ).resolves.toBeUndefined();
  });
});

describe("HumanGatewayOrchestrator", () => {
  let orchestrator: HumanGatewayOrchestrator;

  beforeEach(() => {
    orchestrator = new HumanGatewayOrchestrator();
  });

  it("should return state unchanged when no escalation needed", async () => {
    const state = createBaseState();
    const result = await orchestrator.checkEscalation(state);

    expect(result.humanEscalation).toBeUndefined();
    expect(result.currentStep).toBe(state.currentStep);
  });

  it("should escalate and set human_review step when issues found", async () => {
    const state = createBaseState({
      compliance: {
        passed: false,
        issues: [
          {
            severity: "critical",
            type: "pii",
            description: "PII found",
            detectedBy: "compliance_1",
            suggestedAction: "Block",
          },
        ],
        containsPII: true,
        sensitivityLevel: "restricted",
        checkedBy: ["compliance_1"],
      },
    });

    const result = await orchestrator.checkEscalation(state);

    expect(result.humanEscalation).toBeDefined();
    expect(result.humanEscalation!.required).toBe(true);
    expect(result.humanEscalation!.reviewId).toMatch(/^review_/);
    expect(result.humanEscalation!.severity).toBe("CRITICAL");
    expect(result.currentStep).toBe("human_review");
  });
});
