import { describe, it, expect } from "vitest";
import {
  BASIS_CANONICAL_PRESETS,
  AXIOM_DELTAS,
  CREATION_MODIFIERS,
  ROLE_DEFINITIONS,
  TRUST_TIERS,
  T3_BASELINE,
  FACTOR_CODES,
  createAxiomPreset,
  bootstrapAgentTrustConfigs,
} from "../../../src/trust/presets.js";

describe("Trust Presets", () => {
  describe("FACTOR_CODES", () => {
    it("should contain exactly 16 factor codes", () => {
      expect(FACTOR_CODES).toHaveLength(16);
    });

    it("should include all core trust factors (CT-*)", () => {
      const ctFactors = FACTOR_CODES.filter((c) => c.startsWith("CT-"));
      expect(ctFactors).toHaveLength(9);
      expect(ctFactors).toContain("CT-OBS");
      expect(ctFactors).toContain("CT-COMP");
      expect(ctFactors).toContain("CT-SEC");
    });

    it("should include all operational factors (OP-*)", () => {
      const opFactors = FACTOR_CODES.filter((c) => c.startsWith("OP-"));
      expect(opFactors).toHaveLength(4);
      expect(opFactors).toContain("OP-CONTEXT");
      expect(opFactors).toContain("OP-ALIGN");
    });

    it("should include all safety factors (SF-*)", () => {
      const sfFactors = FACTOR_CODES.filter((c) => c.startsWith("SF-"));
      expect(sfFactors).toHaveLength(3);
      expect(sfFactors).toContain("SF-HUM");
      expect(sfFactors).toContain("SF-ADAPT");
      expect(sfFactors).toContain("SF-LEARN");
    });
  });

  describe("BASIS_CANONICAL_PRESETS", () => {
    it("should have all expected presets", () => {
      expect(Object.keys(BASIS_CANONICAL_PRESETS)).toEqual(
        expect.arrayContaining([
          "default",
          "high_confidence",
          "governance_focus",
          "capability_focus",
          "context_sensitive",
        ]),
      );
    });

    it("should have default preset with equal weights", () => {
      const def = BASIS_CANONICAL_PRESETS["default"]!;
      const values = Object.values(def);
      expect(values.every((v) => v === 0.0625)).toBe(true);
    });

    it("should have weights that sum approximately to 1.0 for each preset", () => {
      for (const [name, weights] of Object.entries(BASIS_CANONICAL_PRESETS)) {
        const sum = Object.values(weights).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1.0, 1); // within 0.05
      }
    });

    it("should contain all 16 factor codes in each preset", () => {
      for (const [name, weights] of Object.entries(BASIS_CANONICAL_PRESETS)) {
        for (const code of FACTOR_CODES) {
          expect(weights[code]).toBeDefined();
        }
      }
    });
  });

  describe("AXIOM_DELTAS", () => {
    it("should have sentinel, builder, and architect overrides", () => {
      expect(AXIOM_DELTAS).toHaveProperty("sentinel_override");
      expect(AXIOM_DELTAS).toHaveProperty("builder_override");
      expect(AXIOM_DELTAS).toHaveProperty("architect_override");
    });

    it("should only contain valid factor codes", () => {
      for (const delta of Object.values(AXIOM_DELTAS)) {
        for (const key of Object.keys(delta)) {
          expect(FACTOR_CODES).toContain(key);
        }
      }
    });
  });

  describe("createAxiomPreset", () => {
    it("should return canonical preset when no delta is specified", () => {
      const result = createAxiomPreset("default");
      expect(result).toEqual(BASIS_CANONICAL_PRESETS["default"]);
    });

    it("should apply delta overrides to canonical preset", () => {
      const result = createAxiomPreset("governance_focus", "sentinel_override");
      // sentinel_override boosts CT-OBS to 0.12
      expect(result["CT-OBS"]).toBe(0.12);
      // Non-overridden values should remain from governance_focus
      expect(result["CT-COMP"]).toBe(
        BASIS_CANONICAL_PRESETS["governance_focus"]!["CT-COMP"],
      );
    });

    it("should return a new object (not mutate original)", () => {
      const original = { ...BASIS_CANONICAL_PRESETS["default"]! };
      createAxiomPreset("default", "sentinel_override");
      expect(BASIS_CANONICAL_PRESETS["default"]).toEqual(original);
    });
  });

  describe("CREATION_MODIFIERS", () => {
    it("should have all creation types", () => {
      expect(CREATION_MODIFIERS).toHaveProperty("fresh");
      expect(CREATION_MODIFIERS).toHaveProperty("cloned");
      expect(CREATION_MODIFIERS).toHaveProperty("evolved");
      expect(CREATION_MODIFIERS).toHaveProperty("promoted");
      expect(CREATION_MODIFIERS).toHaveProperty("imported");
    });

    it("should have fresh at 0 (baseline)", () => {
      expect(CREATION_MODIFIERS.fresh).toBe(0);
    });

    it("should have imported with highest negative modifier", () => {
      expect(CREATION_MODIFIERS.imported).toBe(-100);
    });

    it("should have promoted with positive modifier", () => {
      expect(CREATION_MODIFIERS.promoted).toBeGreaterThan(0);
    });
  });

  describe("ROLE_DEFINITIONS", () => {
    it("should define 5 role levels R-L1 through R-L5", () => {
      expect(Object.keys(ROLE_DEFINITIONS)).toHaveLength(5);
      for (let i = 1; i <= 5; i++) {
        expect(ROLE_DEFINITIONS).toHaveProperty(`R-L${i}`);
      }
    });

    it("should have increasing capabilities with higher roles", () => {
      const l1Caps = ROLE_DEFINITIONS["R-L1"]!.capabilities;
      const l5Caps = ROLE_DEFINITIONS["R-L5"]!.capabilities;
      expect(l5Caps.length).toBeGreaterThan(l1Caps.length);
    });

    it("R-L1 Observer should have read-only access", () => {
      const l1 = ROLE_DEFINITIONS["R-L1"]!;
      expect(l1.name).toBe("Observer");
      expect(l1.capabilities).toEqual(["read"]);
    });
  });

  describe("TRUST_TIERS", () => {
    it("should define tiers T0 through T5", () => {
      expect(TRUST_TIERS).toHaveProperty("T0");
      expect(TRUST_TIERS).toHaveProperty("T5");
    });

    it("should have T0 starting at 0", () => {
      expect(TRUST_TIERS.T0.min).toBe(0);
    });
  });

  describe("T3_BASELINE", () => {
    it("should be 500", () => {
      expect(T3_BASELINE).toBe(500);
    });
  });

  describe("bootstrapAgentTrustConfigs", () => {
    it("should contain all 5 bootstrap agents", () => {
      expect(bootstrapAgentTrustConfigs).toHaveProperty("architect");
      expect(bootstrapAgentTrustConfigs).toHaveProperty("scribe");
      expect(bootstrapAgentTrustConfigs).toHaveProperty("sentinel");
      expect(bootstrapAgentTrustConfigs).toHaveProperty("builder");
      expect(bootstrapAgentTrustConfigs).toHaveProperty("tester");
    });

    it("should have correct initial scores based on creation modifier", () => {
      const architect = bootstrapAgentTrustConfigs.architect;
      expect(architect.initialScore).toBe(
        T3_BASELINE + CREATION_MODIFIERS.cloned,
      );
    });

    it("each config should have weights, capabilities, and roleGates", () => {
      for (const config of Object.values(bootstrapAgentTrustConfigs)) {
        expect(config.weights).toBeDefined();
        expect(Object.keys(config.weights).length).toBeGreaterThan(0);
        expect(config.capabilities).toBeDefined();
        expect(config.roleGates).toBeDefined();
      }
    });
  });
});
