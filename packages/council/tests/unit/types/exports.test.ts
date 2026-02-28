import { describe, it, expect, vi } from "vitest";

// Mock ai-gateway since it's imported by agents
vi.mock("@vorionsys/ai-gateway", () => ({
  createGateway: () => ({
    chat: vi.fn(),
  }),
}));

// Mock fs/path for trust modules
vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  readFileSync: vi.fn().mockReturnValue("[]"),
  writeFileSync: vi.fn(),
}));

vi.mock("path", () => ({
  join: (...args: string[]) => args.join("/"),
}));

describe("Package Exports", () => {
  describe("main index exports", () => {
    it("should export CouncilOrchestrator", async () => {
      const mod = await import("../../../src/index.js");
      expect(mod.CouncilOrchestrator).toBeDefined();
      expect(typeof mod.CouncilOrchestrator).toBe("function");
    });

    it("should export all 6 agent classes", async () => {
      const mod = await import("../../../src/index.js");
      expect(mod.MasterPlannerAgent).toBeDefined();
      expect(mod.ComplianceAgent).toBeDefined();
      expect(mod.RoutingAgent).toBeDefined();
      expect(mod.QAAgent).toBeDefined();
      expect(mod.MetaOrchestratorAgent).toBeDefined();
      expect(mod.HumanGatewayAgent).toBeDefined();
    });

    it("should export agent classes as constructors", async () => {
      const mod = await import("../../../src/index.js");
      expect(new mod.MasterPlannerAgent()).toBeInstanceOf(
        mod.MasterPlannerAgent,
      );
      expect(new mod.ComplianceAgent()).toBeInstanceOf(mod.ComplianceAgent);
      expect(new mod.RoutingAgent()).toBeInstanceOf(mod.RoutingAgent);
      expect(new mod.QAAgent()).toBeInstanceOf(mod.QAAgent);
      expect(new mod.MetaOrchestratorAgent()).toBeInstanceOf(
        mod.MetaOrchestratorAgent,
      );
      expect(new mod.HumanGatewayAgent()).toBeInstanceOf(mod.HumanGatewayAgent);
    });
  });

  describe("agents index exports", () => {
    it("should export runComplianceCheck function", async () => {
      const mod = await import("../../../src/agents/index.js");
      expect(mod.runComplianceCheck).toBeDefined();
      expect(typeof mod.runComplianceCheck).toBe("function");
    });

    it("should export runQAReview function", async () => {
      const mod = await import("../../../src/agents/index.js");
      expect(mod.runQAReview).toBeDefined();
      expect(typeof mod.runQAReview).toBe("function");
    });

    it("should export humanGateway singleton", async () => {
      const mod = await import("../../../src/agents/index.js");
      expect(mod.humanGateway).toBeDefined();
    });
  });

  describe("types index exports", () => {
    it("should export CouncilRequestSchema zod validator", async () => {
      const mod = await import("../../../src/types/index.js");
      expect(mod.CouncilRequestSchema).toBeDefined();
      expect(mod.CouncilRequestSchema.parse).toBeDefined();
    });

    it("should export TaskStepSchema zod validator", async () => {
      const mod = await import("../../../src/types/index.js");
      expect(mod.TaskStepSchema).toBeDefined();
      expect(mod.TaskStepSchema.parse).toBeDefined();
    });

    it("CouncilRequestSchema should validate correct input", async () => {
      const mod = await import("../../../src/types/index.js");
      const validInput = {
        userRequest: "Hello",
        userId: "user_1",
        metadata: { priority: "high" },
      };
      expect(() => mod.CouncilRequestSchema.parse(validInput)).not.toThrow();
    });

    it("CouncilRequestSchema should reject empty userRequest", async () => {
      const mod = await import("../../../src/types/index.js");
      const invalidInput = {
        userRequest: "",
        userId: "user_1",
      };
      expect(() => mod.CouncilRequestSchema.parse(invalidInput)).toThrow();
    });

    it("CouncilRequestSchema should reject invalid priority", async () => {
      const mod = await import("../../../src/types/index.js");
      const invalidInput = {
        userRequest: "Test",
        userId: "user_1",
        metadata: { priority: "urgent" }, // Not a valid enum
      };
      expect(() => mod.CouncilRequestSchema.parse(invalidInput)).toThrow();
    });

    it("TaskStepSchema should validate correct step", async () => {
      const mod = await import("../../../src/types/index.js");
      const validStep = {
        id: "step_1",
        description: "Do something",
        assignTo: "advisor",
        estimatedCost: 0.05,
        estimatedTime: 60,
        dependencies: [],
        status: "pending",
      };
      expect(() => mod.TaskStepSchema.parse(validStep)).not.toThrow();
    });
  });

  describe("trust index exports", () => {
    it("should export simulation types and functions", async () => {
      const mod = await import("../../../src/trust/index.js");
      expect(mod.TRUST_TIERS).toBeDefined();
      expect(mod.FACTORS).toBeDefined();
      expect(mod.FACTOR_WEIGHTS).toBeDefined();
      expect(mod.GATING_THRESHOLDS).toBeDefined();
      expect(mod.AGENT_ARCHETYPES).toBeDefined();
      expect(mod.simulateAgent).toBeDefined();
      expect(mod.runAllSimulations).toBeDefined();
    });

    it("should export telemetry types and functions", async () => {
      const mod = await import("../../../src/trust/index.js");
      expect(mod.TelemetryCollector).toBeDefined();
      expect(mod.getTelemetryCollector).toBeDefined();
      expect(mod.recordTaskSuccess).toBeDefined();
      expect(mod.recordTaskFailure).toBeDefined();
      expect(mod.recordPolicyViolation).toBeDefined();
      expect(mod.recordConsentEvent).toBeDefined();
      expect(mod.recordCollaboration).toBeDefined();
      expect(mod.EVENT_FACTOR_MAP).toBeDefined();
    });

    it("should export gating types and functions", async () => {
      const mod = await import("../../../src/trust/index.js");
      expect(mod.GatingEngine).toBeDefined();
      expect(mod.getGatingEngine).toBeDefined();
      expect(mod.canPromote).toBeDefined();
      expect(mod.requestPromotion).toBeDefined();
      expect(mod.runAutoGating).toBeDefined();
    });

    it("should export presets", async () => {
      const mod = await import("../../../src/trust/index.js");
      expect(mod.BASIS_CANONICAL_PRESETS).toBeDefined();
      expect(mod.AXIOM_DELTAS).toBeDefined();
      expect(mod.CREATION_MODIFIERS).toBeDefined();
      expect(mod.ROLE_DEFINITIONS).toBeDefined();
      expect(mod.T3_BASELINE).toBeDefined();
      expect(mod.FACTOR_CODES).toBeDefined();
      expect(mod.createAxiomPreset).toBeDefined();
      expect(mod.bootstrapAgentTrustConfigs).toBeDefined();
    });

    it("should export bmad presets", async () => {
      const mod = await import("../../../src/trust/index.js");
      expect(mod.bmadPresets).toBeDefined();
    });

    it("should export deprecated aliases for backward compat", async () => {
      const mod = await import("../../../src/trust/index.js");
      expect(mod.DIMENSIONS).toBeDefined();
      expect(mod.DIMENSION_WEIGHTS).toBeDefined();
    });
  });
});
