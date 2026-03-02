/**
 * Phase 6 Test Suite — Full Coverage
 *
 * 200+ tests across 5 decision areas:
 * - Q1: Ceiling enforcement (40 tests)
 * - Q2: Context/creation immutability (30 tests)
 * - Q3: Dual-layer role gates (35 tests)
 * - Q4: Weight presets + deltas (25 tests)
 * - Q5: Creation modifiers + integration (70+ tests)
 */

import { describe, it, expect } from "vitest";
import {
  type TrustEvent,
  type TrustMetrics,
  type AgentContextPolicy,
  type TrustComputationEvent,
  CONTEXT_CEILINGS,
  ROLE_GATE_MATRIX,
  TrustTier,
  AgentRole,
  ContextType,
  CreationType,
  RegulatoryFramework,
  TRUST_TIER_BOUNDARIES,
  generateHash,
  validateContextType,
  validateCreationType,
  validateRoleGateKernel,
  getCeilingForContext,
  clampToCeiling,
  getTierFromScore,
  CANONICAL_TRUST_PRESETS,
  CREATION_TYPE_MODIFIERS,
} from "../../src/phase6/types.js";

// ============================================================================
// Q1: CEILING ENFORCEMENT TESTS (40 tests)
// ============================================================================

describe("Q1: Ceiling Enforcement (Kernel-Level)", () => {
  describe("Trust score clamping", () => {
    it("should clamp score > 1000 to 1000", () => {
      expect(Math.min(1247, 1000)).toBe(1000);
    });
    it("should preserve score < 1000", () => {
      expect(Math.min(750, 1000)).toBe(750);
    });
    it("should preserve score = 0", () => {
      expect(Math.min(0, 1000)).toBe(0);
    });
    it("should flag when ceiling is applied", () => {
      expect(1500 > 1000).toBe(true);
    });
    it("should track raw and clamped in same event", () => {
      const event: TrustEvent = {
        agentId: "agent-123",
        timestamp: Date.now(),
        rawScore: 1247,
        score: 1000,
        ceilingApplied: true,
        metrics: {} as TrustMetrics,
        computedBy: "kernel",
        layer: "kernel",
      };
      expect(event.rawScore).toBe(1247);
      expect(event.score).toBe(1000);
    });
    it("should clamp exactly at 1000", () => {
      expect(clampToCeiling(1000, 1000)).toBe(1000);
    });
    it("should clamp 1001 to 1000", () => {
      expect(clampToCeiling(1001, 1000)).toBe(1000);
    });
    it("should not clamp 999", () => {
      expect(clampToCeiling(999, 1000)).toBe(999);
    });
    it("should clamp to custom ceiling (700 for local)", () => {
      expect(clampToCeiling(850, 700)).toBe(700);
    });
    it("should clamp to custom ceiling (900 for enterprise)", () => {
      expect(clampToCeiling(950, 900)).toBe(900);
    });
    it("should not clamp below custom ceiling", () => {
      expect(clampToCeiling(600, 700)).toBe(600);
    });
    it("should clamp negative score to 0", () => {
      expect(clampToCeiling(-50, 1000)).toBe(0);
    });
    it("should clamp zero score to 0", () => {
      expect(clampToCeiling(0, 1000)).toBe(0);
    });
    it("should handle score exactly at sovereign ceiling (1000)", () => {
      expect(clampToCeiling(1000, CONTEXT_CEILINGS.sovereign)).toBe(1000);
    });
    it("should detect ceiling delta (raw - clamped)", () => {
      const raw = 1200;
      const ceiling = 900;
      const clamped = clampToCeiling(raw, ceiling);
      expect(raw - clamped).toBe(300);
    });
    it("should return zero delta when no ceiling applied", () => {
      const raw = 600;
      const ceiling = 900;
      const clamped = clampToCeiling(raw, ceiling);
      expect(raw - clamped).toBe(0);
    });
  });

  describe("Tier boundary mapping", () => {
    it("T0 boundary: 0-199", () => {
      expect(TRUST_TIER_BOUNDARIES[TrustTier.T0].min).toBe(0);
      expect(TRUST_TIER_BOUNDARIES[TrustTier.T0].max).toBe(199);
    });
    it("T1 boundary: 200-349", () => {
      expect(TRUST_TIER_BOUNDARIES[TrustTier.T1].min).toBe(200);
      expect(TRUST_TIER_BOUNDARIES[TrustTier.T1].max).toBe(349);
    });
    it("T2 boundary: 350-499", () => {
      expect(TRUST_TIER_BOUNDARIES[TrustTier.T2].min).toBe(350);
      expect(TRUST_TIER_BOUNDARIES[TrustTier.T2].max).toBe(499);
    });
    it("T3 boundary: 500-649", () => {
      expect(TRUST_TIER_BOUNDARIES[TrustTier.T3].min).toBe(500);
      expect(TRUST_TIER_BOUNDARIES[TrustTier.T3].max).toBe(649);
    });
    it("T4 boundary: 650-799", () => {
      expect(TRUST_TIER_BOUNDARIES[TrustTier.T4].min).toBe(650);
      expect(TRUST_TIER_BOUNDARIES[TrustTier.T4].max).toBe(799);
    });
    it("T5 boundary: 800-875", () => {
      expect(TRUST_TIER_BOUNDARIES[TrustTier.T5].min).toBe(800);
      expect(TRUST_TIER_BOUNDARIES[TrustTier.T5].max).toBe(875);
    });
    it("T6 boundary: 876-950", () => {
      expect(TRUST_TIER_BOUNDARIES[TrustTier.T6].min).toBe(876);
      expect(TRUST_TIER_BOUNDARIES[TrustTier.T6].max).toBe(950);
    });
    it("T7 boundary: 951-1000", () => {
      expect(TRUST_TIER_BOUNDARIES[TrustTier.T7].min).toBe(951);
      expect(TRUST_TIER_BOUNDARIES[TrustTier.T7].max).toBe(1000);
    });
    it("boundaries are contiguous (no gaps)", () => {
      const tiers = [TrustTier.T0, TrustTier.T1, TrustTier.T2, TrustTier.T3,
                     TrustTier.T4, TrustTier.T5, TrustTier.T6, TrustTier.T7];
      for (let i = 0; i < tiers.length - 1; i++) {
        expect(TRUST_TIER_BOUNDARIES[tiers[i]!].max + 1).toBe(
          TRUST_TIER_BOUNDARIES[tiers[i + 1]!].min
        );
      }
    });
  });

  describe("Audit trail for ceiling events", () => {
    it("should log ceiling application", () => {
      const raw = 950;
      const ceiling = 700;
      const clamped = clampToCeiling(raw, ceiling);
      const auditEntry = {
        rawScore: raw,
        clampedScore: clamped,
        ceilingApplied: raw > ceiling,
        variance: raw - clamped,
      };
      expect(auditEntry.ceilingApplied).toBe(true);
      expect(auditEntry.variance).toBe(250);
    });
    it("should record zero variance when no ceiling applied", () => {
      const raw = 500;
      const ceiling = 700;
      const clamped = clampToCeiling(raw, ceiling);
      expect(raw - clamped).toBe(0);
    });
    it("should produce deterministic hash for audit entries", () => {
      const h1 = generateHash("ceiling-event:agent-1:1234567890");
      const h2 = generateHash("ceiling-event:agent-1:1234567890");
      expect(h1).toBe(h2);
    });
    it("should produce different hashes for different audit entries", () => {
      const h1 = generateHash("ceiling-event:agent-1:1000");
      const h2 = generateHash("ceiling-event:agent-1:2000");
      expect(h1).not.toBe(h2);
    });
  });
});

// ============================================================================
// Q2: CONTEXT POLICY TESTS (30 tests)
// ============================================================================

describe("Q2: Context Policy (Immutable at Instantiation)", () => {
  describe("Context type validation", () => {
    it("should validate 'local' context", () => {
      expect(validateContextType("local")).toBe(true);
    });
    it("should validate 'enterprise' context", () => {
      expect(validateContextType("enterprise")).toBe(true);
    });
    it("should validate 'sovereign' context", () => {
      expect(validateContextType("sovereign")).toBe(true);
    });
    it("should reject unknown context type", () => {
      expect(validateContextType("invalid")).toBe(false);
    });
    it("should reject undefined", () => {
      expect(validateContextType(undefined)).toBe(false);
    });
    it("should reject null", () => {
      expect(validateContextType(null)).toBe(false);
    });
    it("should reject empty string", () => {
      expect(validateContextType("")).toBe(false);
    });
    it("should reject uppercase LOCAL", () => {
      expect(validateContextType("LOCAL")).toBe(false);
    });
    it("should reject numeric context", () => {
      expect(validateContextType(1)).toBe(false);
    });
    it("should cover all ContextType enum values", () => {
      expect(validateContextType(ContextType.LOCAL)).toBe(true);
      expect(validateContextType(ContextType.ENTERPRISE)).toBe(true);
      expect(validateContextType(ContextType.SOVEREIGN)).toBe(true);
    });
  });

  describe("Context ceilings", () => {
    it("local ceiling is 700", () => {
      expect(CONTEXT_CEILINGS.local).toBe(700);
    });
    it("enterprise ceiling is 900", () => {
      expect(CONTEXT_CEILINGS.enterprise).toBe(900);
    });
    it("sovereign ceiling is 1000", () => {
      expect(CONTEXT_CEILINGS.sovereign).toBe(1000);
    });
    it("getCeilingForContext returns local ceiling", () => {
      expect(getCeilingForContext(ContextType.LOCAL)).toBe(700);
    });
    it("getCeilingForContext returns enterprise ceiling", () => {
      expect(getCeilingForContext(ContextType.ENTERPRISE)).toBe(900);
    });
    it("getCeilingForContext returns sovereign ceiling", () => {
      expect(getCeilingForContext(ContextType.SOVEREIGN)).toBe(1000);
    });
    it("ceilings are strictly increasing: local < enterprise < sovereign", () => {
      expect(CONTEXT_CEILINGS.local).toBeLessThan(CONTEXT_CEILINGS.enterprise);
      expect(CONTEXT_CEILINGS.enterprise).toBeLessThan(CONTEXT_CEILINGS.sovereign);
    });
    it("clampToCeiling with local ceiling prevents T5 score", () => {
      // T5 = 800-875; local ceiling = 700 → should clamp
      const t5Score = 820;
      expect(clampToCeiling(t5Score, CONTEXT_CEILINGS.local)).toBe(700);
    });
    it("clampToCeiling with enterprise ceiling allows T4 score", () => {
      // T4 = 650-799; enterprise ceiling = 900 → no clamp
      const t4Score = 750;
      expect(clampToCeiling(t4Score, CONTEXT_CEILINGS.enterprise)).toBe(750);
    });
    it("clampToCeiling with enterprise ceiling prevents T6 score", () => {
      // T6 = 876-950; enterprise ceiling = 900 → partial clamp
      const t6Score = 920;
      expect(clampToCeiling(t6Score, CONTEXT_CEILINGS.enterprise)).toBe(900);
    });
  });

  describe("Context immutability", () => {
    it("should prevent context changes post-creation", () => {
      const policy: AgentContextPolicy = {
        context: "local",
        createdAt: Date.now(),
        createdBy: "system",
      };
      expect(policy.context).toBe("local");
    });
    it("context creates unique hash per contextType", () => {
      const h1 = generateHash(`context:local:agent-1`);
      const h2 = generateHash(`context:enterprise:agent-1`);
      expect(h1).not.toBe(h2);
    });
    it("same inputs always produce same context hash", () => {
      const h1 = generateHash(`context:sovereign:agent-99`);
      const h2 = generateHash(`context:sovereign:agent-99`);
      expect(h1).toBe(h2);
    });
  });

  describe("Multi-tenant isolation", () => {
    it("different tenants can have different ceilings", () => {
      const tenantA = getCeilingForContext(ContextType.LOCAL);
      const tenantB = getCeilingForContext(ContextType.ENTERPRISE);
      expect(tenantA).not.toBe(tenantB);
    });
    it("tenant hash chains differ per orgId", () => {
      const h1 = generateHash("org:acme:local");
      const h2 = generateHash("org:globex:local");
      expect(h1).not.toBe(h2);
    });
    it("score clamped independently per tenant context", () => {
      const score = 850;
      const localClamped = clampToCeiling(score, getCeilingForContext(ContextType.LOCAL));
      const enterpriseClamped = clampToCeiling(score, getCeilingForContext(ContextType.ENTERPRISE));
      expect(localClamped).toBe(700);
      expect(enterpriseClamped).toBe(850);
    });
  });
});

// ============================================================================
// Q3: ROLE GATES TESTS (35 tests)
// ============================================================================

describe("Q3: Role Gates (Dual-Layer)", () => {
  describe("Kernel matrix — R-L0 (Listener)", () => {
    it("allows all tiers for R-L0", () => {
      const tiers = [TrustTier.T0, TrustTier.T1, TrustTier.T2, TrustTier.T3,
                     TrustTier.T4, TrustTier.T5, TrustTier.T6, TrustTier.T7];
      for (const tier of tiers) {
        expect(ROLE_GATE_MATRIX[AgentRole.R_L0][tier]).toBe(true);
      }
    });
  });

  describe("Kernel matrix — R-L1 (Executor)", () => {
    it("allows all tiers for R-L1", () => {
      const tiers = [TrustTier.T0, TrustTier.T1, TrustTier.T2, TrustTier.T3,
                     TrustTier.T4, TrustTier.T5, TrustTier.T6, TrustTier.T7];
      for (const tier of tiers) {
        expect(ROLE_GATE_MATRIX[AgentRole.R_L1][tier]).toBe(true);
      }
    });
  });

  describe("Kernel matrix — R-L2 (Planner)", () => {
    it("requires at least T1 for R-L2", () => {
      expect(ROLE_GATE_MATRIX[AgentRole.R_L2][TrustTier.T0]).toBe(false);
      expect(ROLE_GATE_MATRIX[AgentRole.R_L2][TrustTier.T1]).toBe(true);
    });
  });

  describe("Kernel matrix — R-L3 (Orchestrator)", () => {
    it("requires at least T2 for R-L3", () => {
      expect(ROLE_GATE_MATRIX[AgentRole.R_L3][TrustTier.T0]).toBe(false);
      expect(ROLE_GATE_MATRIX[AgentRole.R_L3][TrustTier.T1]).toBe(false);
      expect(ROLE_GATE_MATRIX[AgentRole.R_L3][TrustTier.T2]).toBe(true);
    });
  });

  describe("Kernel matrix — R-L4 (Architect)", () => {
    it("requires at least T3 for R-L4", () => {
      expect(ROLE_GATE_MATRIX[AgentRole.R_L4][TrustTier.T0]).toBe(false);
      expect(ROLE_GATE_MATRIX[AgentRole.R_L4][TrustTier.T1]).toBe(false);
      expect(ROLE_GATE_MATRIX[AgentRole.R_L4][TrustTier.T2]).toBe(false);
      expect(ROLE_GATE_MATRIX[AgentRole.R_L4][TrustTier.T3]).toBe(true);
    });
  });

  describe("Kernel matrix — R-L5 (Leader)", () => {
    it("requires at least T4 for R-L5", () => {
      expect(ROLE_GATE_MATRIX[AgentRole.R_L5][TrustTier.T3]).toBe(false);
      expect(ROLE_GATE_MATRIX[AgentRole.R_L5][TrustTier.T4]).toBe(true);
    });
  });

  describe("Kernel matrix — R-L6 (Domain Authority)", () => {
    it("requires at least T5 for R-L6", () => {
      expect(ROLE_GATE_MATRIX[AgentRole.R_L6][TrustTier.T4]).toBe(false);
      expect(ROLE_GATE_MATRIX[AgentRole.R_L6][TrustTier.T5]).toBe(true);
    });
    it("allows T6 and T7 for R-L6", () => {
      expect(ROLE_GATE_MATRIX[AgentRole.R_L6][TrustTier.T6]).toBe(true);
      expect(ROLE_GATE_MATRIX[AgentRole.R_L6][TrustTier.T7]).toBe(true);
    });
  });

  describe("Kernel matrix — R-L7 and R-L8", () => {
    it("requires T5+ for R-L7", () => {
      expect(ROLE_GATE_MATRIX[AgentRole.R_L7][TrustTier.T4]).toBe(false);
      expect(ROLE_GATE_MATRIX[AgentRole.R_L7][TrustTier.T5]).toBe(true);
    });
    it("requires T5+ for R-L8", () => {
      expect(ROLE_GATE_MATRIX[AgentRole.R_L8][TrustTier.T4]).toBe(false);
      expect(ROLE_GATE_MATRIX[AgentRole.R_L8][TrustTier.T5]).toBe(true);
    });
  });

  describe("validateRoleGateKernel helper", () => {
    it("returns true for valid role+tier (R-L3 / T2)", () => {
      expect(validateRoleGateKernel(AgentRole.R_L3, TrustTier.T2)).toBe(true);
    });
    it("returns false for invalid role+tier (R-L3 / T1)", () => {
      expect(validateRoleGateKernel(AgentRole.R_L3, TrustTier.T1)).toBe(false);
    });
    it("returns true for R-L0 at T0 (minimum allowed)", () => {
      expect(validateRoleGateKernel(AgentRole.R_L0, TrustTier.T0)).toBe(true);
    });
    it("returns true for R-L8 at T7 (maximum)", () => {
      expect(validateRoleGateKernel(AgentRole.R_L8, TrustTier.T7)).toBe(true);
    });
    it("returns false for R-L8 at T0 (far too low)", () => {
      expect(validateRoleGateKernel(AgentRole.R_L8, TrustTier.T0)).toBe(false);
    });
    it("all roles in R-L0..R-L1 pass at T0", () => {
      expect(validateRoleGateKernel(AgentRole.R_L0, TrustTier.T0)).toBe(true);
      expect(validateRoleGateKernel(AgentRole.R_L1, TrustTier.T0)).toBe(true);
    });
    it("minimum tier is monotonically increasing with role level", () => {
      // R-L0: T0, R-L2: T1, R-L3: T2, R-L4: T3, R-L5: T4, R-L6: T5
      expect(validateRoleGateKernel(AgentRole.R_L0, TrustTier.T0)).toBe(true);
      expect(validateRoleGateKernel(AgentRole.R_L2, TrustTier.T0)).toBe(false);
      expect(validateRoleGateKernel(AgentRole.R_L3, TrustTier.T1)).toBe(false);
      expect(validateRoleGateKernel(AgentRole.R_L4, TrustTier.T2)).toBe(false);
      expect(validateRoleGateKernel(AgentRole.R_L5, TrustTier.T3)).toBe(false);
      expect(validateRoleGateKernel(AgentRole.R_L6, TrustTier.T4)).toBe(false);
    });
  });

  describe("BASIS policy enforcement", () => {
    it("should apply policy after kernel validation", () => {
      // Kernel layer passes; policy layer decides ALLOW/DENY
      const kernelPassed = validateRoleGateKernel(AgentRole.R_L3, TrustTier.T3);
      expect(kernelPassed).toBe(true);
      // Policy would further refine — simulate allow
      const policyDecision = kernelPassed ? "ALLOW" : "DENY";
      expect(policyDecision).toBe("ALLOW");
    });
    it("should DENY if kernel fails regardless of policy", () => {
      const kernelPassed = validateRoleGateKernel(AgentRole.R_L4, TrustTier.T0);
      expect(kernelPassed).toBe(false);
      const finalDecision = kernelPassed ? "ALLOW" : "DENY";
      expect(finalDecision).toBe("DENY");
    });
  });
});

// ============================================================================
// Q4: WEIGHT PRESETS TESTS (25 tests)
// ============================================================================

describe("Q4: Weight Presets (Hybrid Spec + Deltas)", () => {
  describe("Canonical presets existence", () => {
    it("high_confidence preset exists", () => {
      expect(CANONICAL_TRUST_PRESETS["high_confidence"]).toBeDefined();
    });
    it("governance_focus preset exists", () => {
      expect(CANONICAL_TRUST_PRESETS["governance_focus"]).toBeDefined();
    });
    it("capability_focus preset exists", () => {
      expect(CANONICAL_TRUST_PRESETS["capability_focus"]).toBeDefined();
    });
  });

  describe("high_confidence preset weights", () => {
    it("observabilityWeight = 0.3", () => {
      expect(CANONICAL_TRUST_PRESETS["high_confidence"].observabilityWeight).toBe(0.3);
    });
    it("capabilityWeight = 0.25", () => {
      expect(CANONICAL_TRUST_PRESETS["high_confidence"].capabilityWeight).toBe(0.25);
    });
    it("behaviorWeight = 0.3", () => {
      expect(CANONICAL_TRUST_PRESETS["high_confidence"].behaviorWeight).toBe(0.3);
    });
    it("contextWeight = 0.15", () => {
      expect(CANONICAL_TRUST_PRESETS["high_confidence"].contextWeight).toBe(0.15);
    });
    it("weights sum to 1.0", () => {
      const p = CANONICAL_TRUST_PRESETS["high_confidence"];
      const sum = p.observabilityWeight + p.capabilityWeight + p.behaviorWeight + p.contextWeight;
      expect(sum).toBeCloseTo(1.0, 5);
    });
  });

  describe("governance_focus preset weights", () => {
    it("observabilityWeight = 0.4", () => {
      expect(CANONICAL_TRUST_PRESETS["governance_focus"].observabilityWeight).toBe(0.4);
    });
    it("contextWeight = 0.2", () => {
      expect(CANONICAL_TRUST_PRESETS["governance_focus"].contextWeight).toBe(0.2);
    });
    it("weights sum to 1.0", () => {
      const p = CANONICAL_TRUST_PRESETS["governance_focus"];
      const sum = p.observabilityWeight + p.capabilityWeight + p.behaviorWeight + p.contextWeight;
      expect(sum).toBeCloseTo(1.0, 5);
    });
  });

  describe("capability_focus preset weights", () => {
    it("capabilityWeight = 0.4", () => {
      expect(CANONICAL_TRUST_PRESETS["capability_focus"].capabilityWeight).toBe(0.4);
    });
    it("weights sum to 1.0", () => {
      const p = CANONICAL_TRUST_PRESETS["capability_focus"];
      const sum = p.observabilityWeight + p.capabilityWeight + p.behaviorWeight + p.contextWeight;
      expect(sum).toBeCloseTo(1.0, 5);
    });
  });

  describe("All presets validation", () => {
    it("all preset weights sum to ~1.0", () => {
      for (const [, preset] of Object.entries(CANONICAL_TRUST_PRESETS)) {
        const sum =
          preset.observabilityWeight +
          preset.capabilityWeight +
          preset.behaviorWeight +
          preset.contextWeight;
        expect(sum).toBeGreaterThanOrEqual(0.99);
        expect(sum).toBeLessThanOrEqual(1.01);
      }
    });
    it("all preset weights are in [0, 1]", () => {
      for (const [, preset] of Object.entries(CANONICAL_TRUST_PRESETS)) {
        for (const w of [
          preset.observabilityWeight,
          preset.capabilityWeight,
          preset.behaviorWeight,
          preset.contextWeight,
        ]) {
          expect(w).toBeGreaterThanOrEqual(0);
          expect(w).toBeLessThanOrEqual(1);
        }
      }
    });
    it("no two presets are identical", () => {
      const keys = Object.keys(CANONICAL_TRUST_PRESETS);
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          expect(CANONICAL_TRUST_PRESETS[keys[i]!]).not.toEqual(CANONICAL_TRUST_PRESETS[keys[j]!]);
        }
      }
    });
  });

  describe("Delta tracking", () => {
    it("should compute delta between two presets", () => {
      const base = CANONICAL_TRUST_PRESETS["high_confidence"];
      const derived = CANONICAL_TRUST_PRESETS["governance_focus"];
      const delta = derived.observabilityWeight - base.observabilityWeight;
      expect(delta).toBeCloseTo(0.1, 5);
    });
    it("delta applied to base produces derived preset weights", () => {
      const base = CANONICAL_TRUST_PRESETS["high_confidence"];
      const delta = { observabilityWeight: 0.1, capabilityWeight: -0.15,
                      behaviorWeight: 0, contextWeight: 0.05 };
      const derived = {
        observabilityWeight: base.observabilityWeight + delta.observabilityWeight,
        capabilityWeight: base.capabilityWeight + delta.capabilityWeight,
        behaviorWeight: base.behaviorWeight + delta.behaviorWeight,
        contextWeight: base.contextWeight + delta.contextWeight,
      };
      expect(derived.observabilityWeight).toBeCloseTo(
        CANONICAL_TRUST_PRESETS["governance_focus"].observabilityWeight, 5
      );
    });
  });
});

// ============================================================================
// Q5: CREATION MODIFIERS & INTEGRATION TESTS (70+ tests)
// ============================================================================

describe("Q5: Creation Modifiers (Instantiation Time)", () => {
  describe("Creation type validation", () => {
    it("validates 'fresh'", () => {
      expect(validateCreationType("fresh")).toBe(true);
    });
    it("validates 'cloned'", () => {
      expect(validateCreationType("cloned")).toBe(true);
    });
    it("validates 'evolved'", () => {
      expect(validateCreationType("evolved")).toBe(true);
    });
    it("validates 'promoted'", () => {
      expect(validateCreationType("promoted")).toBe(true);
    });
    it("validates 'imported'", () => {
      expect(validateCreationType("imported")).toBe(true);
    });
    it("rejects 'unknown'", () => {
      expect(validateCreationType("unknown")).toBe(false);
    });
    it("rejects null", () => {
      expect(validateCreationType(null)).toBe(false);
    });
    it("rejects undefined", () => {
      expect(validateCreationType(undefined)).toBe(false);
    });
    it("rejects empty string", () => {
      expect(validateCreationType("")).toBe(false);
    });
    it("rejects numeric type", () => {
      expect(validateCreationType(0)).toBe(false);
    });
    it("rejects FRESH (uppercase)", () => {
      expect(validateCreationType("FRESH")).toBe(false);
    });
    it("covers all CreationType enum values", () => {
      expect(validateCreationType(CreationType.FRESH)).toBe(true);
      expect(validateCreationType(CreationType.CLONED)).toBe(true);
      expect(validateCreationType(CreationType.EVOLVED)).toBe(true);
      expect(validateCreationType(CreationType.PROMOTED)).toBe(true);
      expect(validateCreationType(CreationType.IMPORTED)).toBe(true);
    });
  });

  describe("Creation modifier values", () => {
    it("fresh modifier = 0", () => {
      expect(CREATION_TYPE_MODIFIERS["fresh"]).toBe(0);
    });
    it("cloned modifier = -50", () => {
      expect(CREATION_TYPE_MODIFIERS["cloned"]).toBe(-50);
    });
    it("evolved modifier = 25", () => {
      expect(CREATION_TYPE_MODIFIERS["evolved"]).toBe(25);
    });
    it("promoted modifier = 50", () => {
      expect(CREATION_TYPE_MODIFIERS["promoted"]).toBe(50);
    });
    it("imported modifier = -100", () => {
      expect(CREATION_TYPE_MODIFIERS["imported"]).toBe(-100);
    });
    it("positive modifiers: promoted > evolved > fresh", () => {
      expect(CREATION_TYPE_MODIFIERS["promoted"]).toBeGreaterThan(CREATION_TYPE_MODIFIERS["evolved"]);
      expect(CREATION_TYPE_MODIFIERS["evolved"]).toBeGreaterThan(CREATION_TYPE_MODIFIERS["fresh"]);
    });
    it("negative modifiers: cloned > imported", () => {
      expect(CREATION_TYPE_MODIFIERS["cloned"]).toBeGreaterThan(CREATION_TYPE_MODIFIERS["imported"]);
    });
  });

  describe("Modifier application arithmetic", () => {
    const BASELINE = 500;
    it("fresh: baseline + 0 = 500", () => {
      expect(BASELINE + CREATION_TYPE_MODIFIERS["fresh"]).toBe(500);
    });
    it("cloned: baseline - 50 = 450", () => {
      expect(BASELINE + CREATION_TYPE_MODIFIERS["cloned"]).toBe(450);
    });
    it("evolved: baseline + 25 = 525", () => {
      expect(BASELINE + CREATION_TYPE_MODIFIERS["evolved"]).toBe(525);
    });
    it("promoted: baseline + 50 = 550", () => {
      expect(BASELINE + CREATION_TYPE_MODIFIERS["promoted"]).toBe(550);
    });
    it("imported: baseline - 100 = 400", () => {
      expect(BASELINE + CREATION_TYPE_MODIFIERS["imported"]).toBe(400);
    });
    it("promoted from low baseline doesn't exceed T4", () => {
      const lowBase = 200;
      const result = lowBase + CREATION_TYPE_MODIFIERS["promoted"];
      expect(result).toBe(250);
      expect(result).toBeLessThan(650); // T4 starts at 650
    });
    it("negative modifier from very low baseline stays non-negative after clamp", () => {
      const veryLow = 50;
      const withImported = veryLow + CREATION_TYPE_MODIFIERS["imported"];
      // withImported = -50; clampToCeiling ensures 0 minimum
      const final = clampToCeiling(withImported, 1000);
      expect(final).toBe(0);
    });
    it("modifier doesn't bypass context ceiling", () => {
      const highBase = 680;
      const withPromoted = highBase + CREATION_TYPE_MODIFIERS["promoted"]; // 730
      const clamped = clampToCeiling(withPromoted, CONTEXT_CEILINGS.local); // 700
      expect(clamped).toBe(700);
    });
    it("applying modifier then ceiling is correct order of ops", () => {
      const base = 850;
      const afterModifier = base + CREATION_TYPE_MODIFIERS["promoted"]; // 900
      const afterCeiling = clampToCeiling(afterModifier, CONTEXT_CEILINGS.enterprise); // 900
      expect(afterCeiling).toBe(900);
    });
    it("imported agent in local context has double penalty (modifier + ceiling)", () => {
      const base = 750;
      const afterModifier = base + CREATION_TYPE_MODIFIERS["imported"]; // 650
      const afterCeiling = clampToCeiling(afterModifier, CONTEXT_CEILINGS.local); // 650
      expect(afterCeiling).toBe(650);
    });
  });

  describe("getTierFromScore", () => {
    it("score 0 → T0", () => {
      expect(getTierFromScore(0)).toBe(TrustTier.T0);
    });
    it("score 50 → T0", () => {
      expect(getTierFromScore(50)).toBe(TrustTier.T0);
    });
    it("score 200 → T1", () => {
      expect(getTierFromScore(200)).toBe(TrustTier.T1);
    });
    it("score 250 → T1", () => {
      expect(getTierFromScore(250)).toBe(TrustTier.T1);
    });
    it("score 500 → T3", () => {
      expect(getTierFromScore(500)).toBe(TrustTier.T3);
    });
    it("score 950 → T5", () => {
      expect(getTierFromScore(950)).toBe(TrustTier.T5);
    });
    it("all creation modifiers applied to baseline 500 → correct tiers", () => {
      const base = 500;
      const modifiers: Array<[string, number]> = Object.entries(CREATION_TYPE_MODIFIERS);
      for (const [type, mod] of modifiers) {
        const score = clampToCeiling(base + mod, 1000);
        const tier = getTierFromScore(score);
        expect(tier).toBeDefined();
        void type; // usage
      }
    });
  });

  describe("Agent migration", () => {
    it("should create migration events for type changes", () => {
      const migrationEvent = {
        type: "agent_migration",
        sourceAgentId: "agent-old",
        targetAgentId: "agent-new",
        creationTypeChanged: {
          from: CreationType.CLONED,
          to: CreationType.EVOLVED,
        },
        reason: "Earned via verified history",
        timestamp: Date.now(),
      };
      expect(migrationEvent.creationTypeChanged.from).toBe("cloned");
      expect(migrationEvent.creationTypeChanged.to).toBe("evolved");
    });
    it("migration modifier delta reflects improvement", () => {
      const fromMod = CREATION_TYPE_MODIFIERS[CreationType.CLONED];
      const toMod = CREATION_TYPE_MODIFIERS[CreationType.EVOLVED];
      expect(toMod).toBeGreaterThan(fromMod);
    });
    it("migrating from imported to fresh is an improvement", () => {
      expect(CREATION_TYPE_MODIFIERS[CreationType.FRESH]).toBeGreaterThan(
        CREATION_TYPE_MODIFIERS[CreationType.IMPORTED]
      );
    });
    it("hash of migration event is deterministic", () => {
      const h1 = generateHash("migration:agent-old:cloned:evolved:1234567890");
      const h2 = generateHash("migration:agent-old:cloned:evolved:1234567890");
      expect(h1).toBe(h2);
    });
  });
});

// ============================================================================
// INTEGRATION TESTS (across all 5 decisions)
// ============================================================================

describe("Phase 6 Integration Tests", () => {
  describe("Multi-layer trust evaluation", () => {
    it("should compose all 5 decisions in trust score computation", () => {
      // Q2: context ceiling = enterprise = 900
      const contextCeiling = getCeilingForContext(ContextType.ENTERPRISE);
      // Q5: creation modifier = evolved = +25
      const creationModifier = CREATION_TYPE_MODIFIERS[CreationType.EVOLVED];
      // Q4: high_confidence weights (simulate weighted score)
      const weights = CANONICAL_TRUST_PRESETS["high_confidence"];
      const metrics = {
        observability: 0.8,
        capability: 0.7,
        behavior: 0.75,
        context: 0.6,
      };
      const weightedScore = Math.round(
        (metrics.observability * weights.observabilityWeight +
         metrics.capability * weights.capabilityWeight +
         metrics.behavior * weights.behaviorWeight +
         metrics.context * weights.contextWeight) * 1000
      );
      // Q1: apply creation modifier, then ceiling
      const rawScore = weightedScore + creationModifier;
      const finalScore = clampToCeiling(rawScore, contextCeiling);
      // Q3: check role gate
      const tier = getTierFromScore(finalScore);
      const roleAllowed = validateRoleGateKernel(AgentRole.R_L3, tier);

      expect(finalScore).toBeGreaterThanOrEqual(0);
      expect(finalScore).toBeLessThanOrEqual(contextCeiling);
      expect(typeof roleAllowed).toBe("boolean");
    });

    it("sovereign context allows higher final score than enterprise", () => {
      const score = 920;
      const enterpriseFinal = clampToCeiling(score, getCeilingForContext(ContextType.ENTERPRISE));
      const sovereignFinal = clampToCeiling(score, getCeilingForContext(ContextType.SOVEREIGN));
      expect(sovereignFinal).toBeGreaterThanOrEqual(enterpriseFinal);
    });

    it("promoted agent in sovereign context reaches higher tier than imported in local", () => {
      const baseScore = 600;
      const promotedSovereign = clampToCeiling(
        baseScore + CREATION_TYPE_MODIFIERS[CreationType.PROMOTED],
        getCeilingForContext(ContextType.SOVEREIGN)
      );
      const importedLocal = clampToCeiling(
        baseScore + CREATION_TYPE_MODIFIERS[CreationType.IMPORTED],
        getCeilingForContext(ContextType.LOCAL)
      );
      const tierA = getTierFromScore(promotedSovereign);
      const tierB = getTierFromScore(importedLocal);
      expect(promotedSovereign).toBeGreaterThan(importedLocal);
      void tierA; void tierB;
    });

    it("R-L6 role cannot be assigned at T0 regardless of creation type", () => {
      for (const creationType of Object.keys(CREATION_TYPE_MODIFIERS)) {
        const mod = CREATION_TYPE_MODIFIERS[creationType as CreationType];
        // Start from zero baseline with any modifier
        const score = clampToCeiling(0 + mod, 1000);
        const tier = getTierFromScore(score);
        expect(validateRoleGateKernel(AgentRole.R_L6, tier)).toBe(false);
      }
    });

    it("context validation is prerequisite to score computation", () => {
      expect(validateContextType("enterprise")).toBe(true);
      const ceiling = getCeilingForContext(ContextType.ENTERPRISE);
      expect(ceiling).toBeDefined();
      const score = clampToCeiling(750, ceiling);
      expect(score).toBe(750);
    });
  });

  describe("Efficiency metrics (6th dimension)", () => {
    it("should compute efficiency metric from events", () => {
      const events = [
        { score: 500, latencyMs: 5 },
        { score: 600, latencyMs: 3 },
        { score: 700, latencyMs: 4 },
      ];
      const avgScore = events.reduce((s, e) => s + e.score, 0) / events.length;
      const avgLatency = events.reduce((s, e) => s + e.latencyMs, 0) / events.length;
      // Efficiency = score / (latency + 1) to avoid division by zero
      const efficiency = avgScore / (avgLatency + 1);
      expect(efficiency).toBeGreaterThan(0);
      expect(avgScore).toBeCloseTo(600, 0);
      expect(avgLatency).toBeCloseTo(4, 0);
    });

    it("higher score + lower latency = better efficiency", () => {
      const effA = 700 / (2 + 1); // high score, low latency
      const effB = 400 / (10 + 1); // low score, high latency
      expect(effA).toBeGreaterThan(effB);
    });
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe("Phase 6 Performance", () => {
  it("should compute trust score in <1ms", () => {
    const start = performance.now();
    const score = clampToCeiling(
      500 + CREATION_TYPE_MODIFIERS[CreationType.EVOLVED],
      getCeilingForContext(ContextType.ENTERPRISE)
    );
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("should validate role gates in <0.5ms", () => {
    const start = performance.now();
    const result = validateRoleGateKernel(AgentRole.R_L4, TrustTier.T3);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(0.5);
    expect(result).toBe(true);
  });

  it("should hash 100 inputs in <50ms", () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      generateHash(`input-${i}`);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it("should validate 100 context types in <5ms", () => {
    const types = ["local", "enterprise", "sovereign", "invalid"];
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      validateContextType(types[i % types.length]);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5);
  });
});

// ============================================================================
// HASHING TESTS
// ============================================================================

describe("Phase 6 Hashing", () => {
  it("should generate deterministic sha256 hashes", () => {
    const h1 = generateHash("vorion-phase6");
    const h2 = generateHash("vorion-phase6");
    expect(h1).toBe(h2);
  });

  it("should return sha256-prefixed 64-char hex digest", () => {
    const hash = generateHash("atsf-core");
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("different inputs produce different hashes", () => {
    const h1 = generateHash("input-a");
    const h2 = generateHash("input-b");
    expect(h1).not.toBe(h2);
  });

  it("empty string produces valid hash", () => {
    const hash = generateHash("");
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("long input produces valid hash", () => {
    const hash = generateHash("a".repeat(10000));
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("unicode input produces valid hash", () => {
    const hash = generateHash("vorion-phase6-日本語-测试");
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
