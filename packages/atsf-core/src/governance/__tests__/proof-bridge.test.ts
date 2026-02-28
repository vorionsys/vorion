import { describe, it, expect, vi, beforeEach } from "vitest";
import { GovernanceProofBridge } from "../proof-bridge.js";
import {
  GovernanceEngine,
  createGovernanceEngine,
  createGovernanceRule,
  createFieldCondition,
  createRuleEffect,
} from "../index.js";
import type { GovernanceRequest } from "../types.js";
import type { ProofBridgeProofRequest } from "../proof-bridge.js";

// =============================================================================
// TEST HELPERS
// =============================================================================

function createMockProofFn() {
  let callCount = 0;
  const calls: ProofBridgeProofRequest[] = [];

  const fn = vi.fn(async (request: ProofBridgeProofRequest) => {
    calls.push(request);
    callCount++;
    return { id: `proof-${callCount}` };
  });

  return { fn, calls };
}

function createTestRequest(
  overrides: Partial<GovernanceRequest> = {},
): GovernanceRequest {
  return {
    requestId: "req-001",
    entityId: "agent-test",
    trustLevel: 1,
    action: "read_data",
    capabilities: ["read"],
    resources: ["public-data"],
    context: { source: "test" },
    ...overrides,
  };
}

function setupEngineWithRules(): GovernanceEngine {
  const engine = createGovernanceEngine({ enableCaching: false });

  // Add a policy rule that allows read_data
  engine.registerRule(
    createGovernanceRule(
      "Allow Read",
      "policy_enforcement",
      createFieldCondition("action", "equals", "read_data"),
      createRuleEffect("allow", "Read access permitted"),
      { applicableTrustLevels: [0, 1, 2, 3, 4, 5, 6, 7] },
    ),
  );

  // Add a security rule that blocks delete
  engine.registerRule(
    createGovernanceRule(
      "Block Delete",
      "security_critical",
      createFieldCondition("action", "equals", "delete_data"),
      createRuleEffect("deny", "Delete requires higher trust"),
      { applicableTrustLevels: [0, 1] },
    ),
  );

  return engine;
}

// =============================================================================
// TESTS
// =============================================================================

describe("GovernanceProofBridge", () => {
  let engine: GovernanceEngine;
  let mockProof: ReturnType<typeof createMockProofFn>;

  beforeEach(() => {
    engine = setupEngineWithRules();
    mockProof = createMockProofFn();
  });

  describe("constructor", () => {
    it("should create with engine and config", () => {
      const bridge = new GovernanceProofBridge(engine, {
        createProof: mockProof.fn,
        tenantId: "tenant-test",
      });
      expect(bridge).toBeDefined();
    });
  });

  describe("evaluateWithProof", () => {
    it("should return governance result and proof ID", async () => {
      const bridge = new GovernanceProofBridge(engine, {
        createProof: mockProof.fn,
        tenantId: "tenant-test",
      });
      const request = createTestRequest();

      const { result, proofId } = await bridge.evaluateWithProof(request);

      expect(result).toBeDefined();
      expect(result.requestId).toBe("req-001");
      expect(result.decision).toBeDefined();
      expect(proofId).toBe("proof-1");
    });

    it("should call createProof exactly once", async () => {
      const bridge = new GovernanceProofBridge(engine, {
        createProof: mockProof.fn,
        tenantId: "tenant-test",
      });

      await bridge.evaluateWithProof(createTestRequest());

      expect(mockProof.fn).toHaveBeenCalledTimes(1);
    });

    it("should map GovernanceRequest to Intent shape", async () => {
      const bridge = new GovernanceProofBridge(engine, {
        createProof: mockProof.fn,
        tenantId: "tenant-test",
      });
      const request = createTestRequest({
        entityId: "agent-alpha",
        action: "read_data",
      });

      await bridge.evaluateWithProof(request);

      const proofRequest = mockProof.calls[0];
      const intent = proofRequest.intent;

      expect(intent.id).toBe("req-001");
      expect(intent.entityId).toBe("agent-alpha");
      expect(intent.goal).toBe("read_data");
      expect(intent.tenantId).toBe("tenant-test");
      expect(intent.status).toBe("completed");
      expect(intent.context).toEqual({ source: "test" });
      expect(intent.metadata).toEqual({
        capabilities: ["read"],
        resources: ["public-data"],
        authority: undefined,
      });
      expect(intent.createdAt).toBeDefined();
      expect(intent.updatedAt).toBeDefined();
      expect(intent.source).toBe("governance-bridge");
    });

    it("should map GovernanceResult to Decision shape", async () => {
      const bridge = new GovernanceProofBridge(engine, {
        createProof: mockProof.fn,
        tenantId: "tenant-test",
      });
      const request = createTestRequest({ trustLevel: 2 });

      await bridge.evaluateWithProof(request);

      const proofRequest = mockProof.calls[0];
      const decision = proofRequest.decision;

      expect(decision.intentId).toBe("req-001");
      expect(decision.action).toBeDefined();
      expect(decision.trustLevel).toBe(2);
      expect(decision.trustScore).toBeGreaterThanOrEqual(0);
      expect(decision.trustScore).toBeLessThanOrEqual(1000);
      expect(decision.decidedAt).toBeDefined();
      expect(Array.isArray(decision.constraintsEvaluated)).toBe(true);
    });

    it("should scale confidence to trustScore (0-1 → 0-1000)", async () => {
      const bridge = new GovernanceProofBridge(engine, {
        createProof: mockProof.fn,
        tenantId: "tenant-test",
      });

      await bridge.evaluateWithProof(createTestRequest());

      const decision = mockProof.calls[0].decision;
      // Confidence is between 0 and 1, trustScore should be 0-1000
      expect(decision.trustScore).toBeGreaterThanOrEqual(0);
      expect(decision.trustScore).toBeLessThanOrEqual(1000);
      expect(Number.isInteger(decision.trustScore)).toBe(true);
    });

    it("should pass ControlAction through directly", async () => {
      const bridge = new GovernanceProofBridge(engine, {
        createProof: mockProof.fn,
        tenantId: "tenant-test",
      });

      // read_data should match the Allow Read rule
      const { result } = await bridge.evaluateWithProof(
        createTestRequest({ action: "read_data" }),
      );

      const decision = mockProof.calls[0].decision;
      expect(decision.action).toBe(result.decision);
    });

    it("should map evaluated rules to constraintsEvaluated", async () => {
      const bridge = new GovernanceProofBridge(engine, {
        createProof: mockProof.fn,
        tenantId: "tenant-test",
      });

      await bridge.evaluateWithProof(createTestRequest());

      const constraints = mockProof.calls[0].decision.constraintsEvaluated;
      expect(constraints.length).toBeGreaterThan(0);

      for (const constraint of constraints) {
        expect(constraint.constraintId).toBeDefined();
        expect(typeof constraint.passed).toBe("boolean");
        expect(constraint.action).toBeDefined();
        expect(constraint.reason).toBeDefined();
        expect(constraint.details).toBeDefined();
        expect(typeof constraint.durationMs).toBe("number");
        expect(constraint.evaluatedAt).toBeDefined();
      }
    });

    it("should include inputs and outputs in proof request", async () => {
      const bridge = new GovernanceProofBridge(engine, {
        createProof: mockProof.fn,
        tenantId: "tenant-test",
      });

      await bridge.evaluateWithProof(createTestRequest());

      const proofRequest = mockProof.calls[0];

      // Inputs should contain request details
      expect(proofRequest.inputs.requestId).toBe("req-001");
      expect(proofRequest.inputs.entityId).toBe("agent-test");
      expect(proofRequest.inputs.action).toBe("read_data");

      // Outputs should contain result details
      expect(proofRequest.outputs.resultId).toBeDefined();
      expect(proofRequest.outputs.decision).toBeDefined();
      expect(proofRequest.outputs.confidence).toBeDefined();
      expect(typeof proofRequest.outputs.rulesMatched).toBe("number");
      expect(typeof proofRequest.outputs.rulesEvaluated).toBe("number");
    });

    it("should include tenantId in proof request", async () => {
      const bridge = new GovernanceProofBridge(engine, {
        createProof: mockProof.fn,
        tenantId: "tenant-xyz",
      });

      await bridge.evaluateWithProof(createTestRequest());

      expect(mockProof.calls[0].tenantId).toBe("tenant-xyz");
    });

    it("should handle deny decisions", async () => {
      const bridge = new GovernanceProofBridge(engine, {
        createProof: mockProof.fn,
        tenantId: "tenant-test",
      });

      const { result, proofId } = await bridge.evaluateWithProof(
        createTestRequest({ action: "delete_data", trustLevel: 0 }),
      );

      expect(result.decision).toBe("deny");
      expect(proofId).toBe("proof-1");
      // Proof should still be created for deny decisions
      expect(mockProof.fn).toHaveBeenCalledTimes(1);
    });

    it("should handle no-match default decisions", async () => {
      const bridge = new GovernanceProofBridge(engine, {
        createProof: mockProof.fn,
        tenantId: "tenant-test",
      });

      // Action that no rule matches
      const { result, proofId } = await bridge.evaluateWithProof(
        createTestRequest({ action: "unknown_action" }),
      );

      // Default action is 'deny'
      expect(result.decision).toBe("deny");
      expect(proofId).toBeDefined();
      expect(mockProof.fn).toHaveBeenCalledTimes(1);
    });

    it("should propagate createProof errors", async () => {
      const failingProof = vi.fn(async () => {
        throw new Error("Proof chain unavailable");
      });

      const bridge = new GovernanceProofBridge(engine, {
        createProof: failingProof,
        tenantId: "tenant-test",
      });

      await expect(
        bridge.evaluateWithProof(createTestRequest()),
      ).rejects.toThrow("Proof chain unavailable");
    });

    it("should handle multiple sequential evaluations", async () => {
      const bridge = new GovernanceProofBridge(engine, {
        createProof: mockProof.fn,
        tenantId: "tenant-test",
      });

      const r1 = await bridge.evaluateWithProof(
        createTestRequest({ requestId: "req-1" }),
      );
      const r2 = await bridge.evaluateWithProof(
        createTestRequest({ requestId: "req-2" }),
      );
      const r3 = await bridge.evaluateWithProof(
        createTestRequest({ requestId: "req-3" }),
      );

      expect(r1.proofId).toBe("proof-1");
      expect(r2.proofId).toBe("proof-2");
      expect(r3.proofId).toBe("proof-3");
      expect(mockProof.fn).toHaveBeenCalledTimes(3);
    });
  });
});
