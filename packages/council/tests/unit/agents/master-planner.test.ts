import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CouncilState } from "../../../src/types/index.js";

// Default mock chat function
const mockChat = vi.fn().mockResolvedValue({
  content: JSON.stringify({
    complexity: "moderate",
    steps: [
      {
        id: "step_1",
        description: "Consult strategic advisor",
        assignTo: "advisor",
        estimatedCost: 0.1,
        estimatedTime: 120,
        dependencies: [],
      },
      {
        id: "step_2",
        description: "Execute marketing plan",
        assignTo: "workforce",
        estimatedCost: 0.05,
        estimatedTime: 180,
        dependencies: ["step_1"],
      },
    ],
    totalEstimatedCost: 0.15,
    totalEstimatedTime: 300,
    rationale: "Two-step plan for moderate request",
  }),
  model: "mock-model",
  usage: { totalCost: 0.02 },
  metadata: { latency: 200 },
});

// Mock the ai-gateway module
vi.mock("@vorionsys/ai-gateway", () => ({
  createGateway: () => ({
    chat: (...args: unknown[]) => mockChat(...args),
  }),
}));

import { MasterPlannerAgent } from "../../../src/agents/master-planner.js";

function createBaseState(overrides?: Partial<CouncilState>): CouncilState {
  return {
    userRequest: "Create a marketing plan for our new product",
    userId: "user_test",
    requestId: "req_test_001",
    metadata: {
      priority: "medium",
      expectedResponseTime: 120,
      maxCost: 5.0,
      requiresHumanApproval: false,
    },
    currentStep: "planning",
    iterationCount: 0,
    errors: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("MasterPlannerAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("plan", () => {
    it("should create a plan with steps from gateway response", async () => {
      const planner = new MasterPlannerAgent();
      const state = createBaseState();
      const result = await planner.plan(state);

      expect(result.plan).toBeDefined();
      expect(result.plan!.steps.length).toBe(2);
      expect(result.plan!.steps[0]!.id).toBe("step_1");
      expect(result.plan!.steps[1]!.assignTo).toBe("workforce");
    });

    it("should set complexity from parsed response", async () => {
      const planner = new MasterPlannerAgent();
      const state = createBaseState();
      const result = await planner.plan(state);

      expect(result.plan!.complexity).toBe("moderate");
    });

    it("should set estimated cost and time", async () => {
      const planner = new MasterPlannerAgent();
      const state = createBaseState();
      const result = await planner.plan(state);

      expect(result.plan!.estimatedCost).toBe(0.15);
      expect(result.plan!.estimatedTime).toBe(300);
    });

    it("should advance currentStep to compliance_check on success", async () => {
      const planner = new MasterPlannerAgent();
      const state = createBaseState();
      const result = await planner.plan(state);

      expect(result.currentStep).toBe("compliance_check");
    });

    it("should set createdBy to master_planner", async () => {
      const planner = new MasterPlannerAgent();
      const state = createBaseState();
      const result = await planner.plan(state);

      expect(result.plan!.createdBy).toBe("master_planner");
    });

    it("should handle gateway errors and set failed state", async () => {
      mockChat.mockRejectedValueOnce(new Error("LLM service unavailable"));

      const planner = new MasterPlannerAgent();
      const state = createBaseState();
      const result = await planner.plan(state);

      expect(result.currentStep).toBe("failed");
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]!.agentId).toBe("master_planner");
      expect(result.errors[0]!.severity).toBe("critical");
    });

    it("should handle unparseable response with fallback plan", async () => {
      mockChat.mockResolvedValueOnce({
        content: "This is not valid JSON at all, just some text explanation.",
        model: "mock-model",
        usage: { totalCost: 0.01 },
        metadata: { latency: 100 },
      });

      const planner = new MasterPlannerAgent();
      const state = createBaseState();
      const result = await planner.plan(state);

      // Should use fallback plan
      expect(result.plan).toBeDefined();
      expect(result.plan!.steps.length).toBe(1);
      expect(result.plan!.complexity).toBe("simple");
    });
  });

  describe("getConfig", () => {
    it("should return valid configuration", () => {
      const config = MasterPlannerAgent.getConfig();
      expect(config.id).toBe("master_planner");
      expect(config.role).toBe("master_planner");
      expect(config.capabilities).toBeInstanceOf(Array);
      expect(config.capabilities).toContain("Task decomposition");
    });
  });
});
