import { describe, it, expect } from "vitest";
import bmadPresets, {
  BMAD_DELTAS,
  createBmadPreset,
  bmadAgentTrustConfigs,
  bmadMasterTrustConfig,
} from "../../../src/trust/bmad-presets.js";
import {
  BASIS_CANONICAL_PRESETS,
  T3_BASELINE,
} from "../../../src/trust/presets.js";

describe("BMAD Presets", () => {
  describe("BMAD_DELTAS", () => {
    it("should define all expected override types", () => {
      expect(BMAD_DELTAS).toHaveProperty("orchestrator_override");
      expect(BMAD_DELTAS).toHaveProperty("builder_override");
      expect(BMAD_DELTAS).toHaveProperty("advisor_override");
      expect(BMAD_DELTAS).toHaveProperty("executor_override");
      expect(BMAD_DELTAS).toHaveProperty("chronicler_override");
      expect(BMAD_DELTAS).toHaveProperty("validator_override");
    });

    it("orchestrator override should boost CT-OBS and OP-HUMAN", () => {
      const orch = BMAD_DELTAS["orchestrator_override"]!;
      expect(orch["CT-OBS"]).toBeGreaterThan(0.1);
      expect(orch["OP-HUMAN"]).toBeGreaterThan(0.06);
    });
  });

  describe("createBmadPreset", () => {
    it("should return canonical preset when no delta specified", () => {
      const result = createBmadPreset("default");
      expect(result).toEqual(BASIS_CANONICAL_PRESETS["default"]);
    });

    it("should merge BMAD delta with canonical preset", () => {
      const result = createBmadPreset(
        "governance_focus",
        "orchestrator_override",
      );
      expect(result["CT-OBS"]).toBe(
        BMAD_DELTAS["orchestrator_override"]!["CT-OBS"],
      );
      // Non-overridden factor should come from canonical
      expect(result["CT-PRIV"]).toBe(
        BASIS_CANONICAL_PRESETS["governance_focus"]!["CT-PRIV"],
      );
    });

    it("should not mutate canonical presets", () => {
      const before = { ...BASIS_CANONICAL_PRESETS["default"]! };
      createBmadPreset("default", "builder_override");
      expect(BASIS_CANONICAL_PRESETS["default"]).toEqual(before);
    });
  });

  describe("bmadMasterTrustConfig", () => {
    it("should have elevated initial score (T4)", () => {
      expect(bmadMasterTrustConfig.initialScore).toBe(T3_BASELINE + 200);
    });

    it("should target T4 tier", () => {
      expect(bmadMasterTrustConfig.targetTier).toBe("T4");
    });

    it("should have workflow.orchestrate capability", () => {
      expect(bmadMasterTrustConfig.capabilities).toHaveProperty(
        "workflow.orchestrate",
      );
    });
  });

  describe("bmadAgentTrustConfigs", () => {
    it("should contain all BMAD agent configs", () => {
      expect(Object.keys(bmadAgentTrustConfigs).length).toBeGreaterThanOrEqual(
        15,
      );
    });

    it("should include core module (bmad-master)", () => {
      expect(bmadAgentTrustConfigs).toHaveProperty("bmad-master");
    });

    it("should include BMB module agents", () => {
      expect(bmadAgentTrustConfigs).toHaveProperty("agent-builder");
      expect(bmadAgentTrustConfigs).toHaveProperty("module-builder");
      expect(bmadAgentTrustConfigs).toHaveProperty("workflow-builder");
    });

    it("should include BMM module agents", () => {
      expect(bmadAgentTrustConfigs).toHaveProperty("analyst");
      expect(bmadAgentTrustConfigs).toHaveProperty("dev");
      expect(bmadAgentTrustConfigs).toHaveProperty("pm");
    });

    it("should include CIS module agents", () => {
      expect(bmadAgentTrustConfigs).toHaveProperty("brainstorming-coach");
      expect(bmadAgentTrustConfigs).toHaveProperty("storyteller");
    });

    it("each config should have agentId, weights, and capabilities", () => {
      for (const [key, config] of Object.entries(bmadAgentTrustConfigs)) {
        expect(config.agentId).toBeDefined();
        expect(config.weights).toBeDefined();
        expect(config.capabilities).toBeDefined();
        expect(config.creation).toBeDefined();
      }
    });
  });

  describe("default export", () => {
    it("should export bmadAgentTrustConfigs as default", () => {
      expect(bmadPresets).toBe(bmadAgentTrustConfigs);
    });
  });
});
