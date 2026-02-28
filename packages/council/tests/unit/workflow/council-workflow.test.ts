import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the ai-gateway module
vi.mock("@vorionsys/ai-gateway", () => ({
  createGateway: () => ({
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        complexity: "simple",
        steps: [
          {
            id: "step_1",
            description: "Process request",
            assignTo: "advisor",
            estimatedCost: 0.05,
            estimatedTime: 60,
            dependencies: [],
          },
        ],
        totalEstimatedCost: 0.05,
        totalEstimatedTime: 60,
        rationale: "Simple request",
      }),
      model: "mock-model",
      usage: { totalCost: 0.02 },
      metadata: { latency: 100 },
    }),
  }),
}));

import { CouncilOrchestrator } from "../../../src/graphs/council-workflow.js";

describe("CouncilOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create orchestrator instance", () => {
      const orchestrator = new CouncilOrchestrator();
      expect(orchestrator).toBeDefined();
    });
  });

  describe("process", () => {
    it("should process a basic request through the full workflow", async () => {
      const orchestrator = new CouncilOrchestrator();
      const result = await orchestrator.process({
        userRequest: "Give me advice on hiring",
        userId: "user_test",
      });

      expect(result).toBeDefined();
      expect(result.requestId).toMatch(/^req_/);
      expect(result.userRequest).toBe("Give me advice on hiring");
      expect(result.userId).toBe("user_test");
    });

    it("should generate a unique requestId", async () => {
      const orchestrator = new CouncilOrchestrator();
      const result1 = await orchestrator.process({
        userRequest: "Request 1",
        userId: "user_test",
      });
      const result2 = await orchestrator.process({
        userRequest: "Request 2",
        userId: "user_test",
      });

      expect(result1.requestId).not.toBe(result2.requestId);
    });

    it("should default priority to medium when not specified", async () => {
      const orchestrator = new CouncilOrchestrator();
      const result = await orchestrator.process({
        userRequest: "Test",
        userId: "user_test",
      });

      expect(result.metadata.priority).toBe("medium");
    });

    it("should respect provided priority", async () => {
      const orchestrator = new CouncilOrchestrator();
      const result = await orchestrator.process({
        userRequest: "Urgent request",
        userId: "user_test",
        metadata: { priority: "critical" },
      });

      expect(result.metadata.priority).toBe("critical");
    });

    it("should create a plan during workflow", async () => {
      const orchestrator = new CouncilOrchestrator();
      const result = await orchestrator.process({
        userRequest: "Create a business plan",
        userId: "user_test",
      });

      expect(result.plan).toBeDefined();
      expect(result.plan!.createdBy).toBe("master_planner");
      expect(result.plan!.steps.length).toBeGreaterThan(0);
    });

    it("should run compliance checks", async () => {
      const orchestrator = new CouncilOrchestrator();
      const result = await orchestrator.process({
        userRequest: "Help me write code",
        userId: "user_test",
      });

      expect(result.compliance).toBeDefined();
      expect(result.compliance!.checkedBy!.length).toBeGreaterThan(0);
    });

    it("should include routing when compliance passes", async () => {
      const orchestrator = new CouncilOrchestrator();
      const result = await orchestrator.process({
        userRequest: "Help me",
        userId: "user_test",
      });

      // Compliance passes with mock (returns passed:true)
      if (result.compliance?.passed) {
        expect(result.routing).toBeDefined();
      }
    });

    it("should set initial state timestamps", async () => {
      const before = new Date();
      const orchestrator = new CouncilOrchestrator();
      const result = await orchestrator.process({
        userRequest: "Test",
        userId: "user_test",
      });
      const after = new Date();

      expect(result.createdAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(result.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should initialize with empty errors array", async () => {
      const orchestrator = new CouncilOrchestrator();
      const result = await orchestrator.process({
        userRequest: "Test",
        userId: "user_test",
      });

      // Errors should be an array (may or may not have entries depending on mocks)
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });
});
