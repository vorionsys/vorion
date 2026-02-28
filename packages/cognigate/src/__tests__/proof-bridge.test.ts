/**
 * Cognigate SDK - Proof Bridge Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProofBridge } from "../proof-bridge.js";
import type { ProofPlaneEmitter } from "../proof-bridge.js";
import { WebhookRouter } from "../webhooks.js";
import type { WebhookEvent } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProofPlane(): ProofPlaneEmitter {
  return {
    logDecisionMade: vi.fn().mockResolvedValue(undefined),
  };
}

function makeGovernanceEvent(
  payloadOverrides: Record<string, unknown> = {},
): WebhookEvent & { type: "governance.decision" } {
  return {
    id: "evt_gov_001",
    type: "governance.decision",
    entityId: "agent_bridge_test",
    payload: {
      decisionId: "dec_123",
      intentId: "int_456",
      agentId: "agent_789",
      correlationId: "corr_abc",
      permitted: true,
      trustBand: 5,
      trustScore: 800,
      reasoning: ["trust score high", "capability granted"],
      decidedAt: "2026-02-15T10:00:00Z",
      expiresAt: "2026-02-16T10:00:00Z",
      latencyMs: 42,
      version: 2,
      ...payloadOverrides,
    },
    timestamp: new Date("2026-02-15T10:00:00Z"),
    signature: "test-sig",
  };
}

// ===========================================================================
// createProofBridge
// ===========================================================================

describe("createProofBridge", () => {
  let proofPlane: ProofPlaneEmitter;
  let router: WebhookRouter;

  beforeEach(() => {
    proofPlane = makeProofPlane();
    router = new WebhookRouter();
  });

  it("returns a handle with a disconnect function", () => {
    const handle = createProofBridge({ proofPlane, webhookRouter: router });

    expect(handle).toBeDefined();
    expect(typeof handle.disconnect).toBe("function");
  });

  // -------------------------------------------------------------------------
  // Forwarding
  // -------------------------------------------------------------------------

  describe("forwarding", () => {
    it("calls logDecisionMade when a governance.decision event fires", async () => {
      createProofBridge({ proofPlane, webhookRouter: router });

      const event = makeGovernanceEvent();
      await router.handle(event);

      expect(proofPlane.logDecisionMade).toHaveBeenCalledTimes(1);
    });

    it("does not call logDecisionMade for non-governance events", async () => {
      createProofBridge({ proofPlane, webhookRouter: router });

      await router.handle({
        id: "evt_other",
        type: "agent.created",
        entityId: "agent_other",
        payload: {},
        timestamp: new Date(),
        signature: "sig",
      });

      expect(proofPlane.logDecisionMade).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Field mapping
  // -------------------------------------------------------------------------

  describe("field mapping", () => {
    it("maps all payload fields correctly to logDecisionMade", async () => {
      createProofBridge({ proofPlane, webhookRouter: router });

      const event = makeGovernanceEvent();
      await router.handle(event);

      const call = (proofPlane.logDecisionMade as ReturnType<typeof vi.fn>)
        .mock.calls[0];
      const decision = call[0];
      const correlationId = call[1];

      expect(decision.decisionId).toBe("dec_123");
      expect(decision.intentId).toBe("int_456");
      expect(decision.agentId).toBe("agent_789");
      expect(decision.correlationId).toBe("corr_abc");
      expect(decision.permitted).toBe(true);
      expect(decision.trustBand).toBe(5);
      expect(decision.trustScore).toBe(800);
      expect(decision.reasoning).toEqual([
        "trust score high",
        "capability granted",
      ]);
      expect(decision.decidedAt).toEqual(new Date("2026-02-15T10:00:00Z"));
      expect(decision.expiresAt).toEqual(new Date("2026-02-16T10:00:00Z"));
      expect(decision.latencyMs).toBe(42);
      expect(decision.version).toBe(2);

      // correlationId is passed as the second argument
      expect(correlationId).toBe("corr_abc");
    });

    it("wraps a single string reasoning into an array", async () => {
      createProofBridge({ proofPlane, webhookRouter: router });

      await router.handle(
        makeGovernanceEvent({ reasoning: "single reason" }),
      );

      const decision = (proofPlane.logDecisionMade as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(decision.reasoning).toEqual(["single reason"]);
    });

    it("defaults reasoning to empty array when not provided", async () => {
      createProofBridge({ proofPlane, webhookRouter: router });

      await router.handle(makeGovernanceEvent({ reasoning: undefined }));

      const decision = (proofPlane.logDecisionMade as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(decision.reasoning).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Default values
  // -------------------------------------------------------------------------

  describe("default values", () => {
    it("uses event.id as decisionId when payload.decisionId is missing", async () => {
      createProofBridge({ proofPlane, webhookRouter: router });

      await router.handle(
        makeGovernanceEvent({ decisionId: undefined }),
      );

      const decision = (proofPlane.logDecisionMade as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(decision.decisionId).toBe("evt_gov_001");
    });

    it("uses empty string for intentId when missing", async () => {
      createProofBridge({ proofPlane, webhookRouter: router });

      await router.handle(
        makeGovernanceEvent({ intentId: undefined }),
      );

      const decision = (proofPlane.logDecisionMade as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(decision.intentId).toBe("");
    });

    it("uses event.entityId as agentId when missing", async () => {
      createProofBridge({ proofPlane, webhookRouter: router });

      await router.handle(
        makeGovernanceEvent({ agentId: undefined }),
      );

      const decision = (proofPlane.logDecisionMade as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(decision.agentId).toBe("agent_bridge_test");
    });

    it("uses event.id as correlationId when missing", async () => {
      createProofBridge({ proofPlane, webhookRouter: router });

      await router.handle(
        makeGovernanceEvent({ correlationId: undefined }),
      );

      const decision = (proofPlane.logDecisionMade as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(decision.correlationId).toBe("evt_gov_001");
    });

    it("defaults trustBand to 4 when missing", async () => {
      createProofBridge({ proofPlane, webhookRouter: router });

      await router.handle(
        makeGovernanceEvent({ trustBand: undefined }),
      );

      const decision = (proofPlane.logDecisionMade as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(decision.trustBand).toBe(4);
    });

    it("defaults trustScore to 0 when missing", async () => {
      createProofBridge({ proofPlane, webhookRouter: router });

      await router.handle(
        makeGovernanceEvent({ trustScore: undefined }),
      );

      const decision = (proofPlane.logDecisionMade as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(decision.trustScore).toBe(0);
    });

    it("defaults latencyMs to 0 when missing", async () => {
      createProofBridge({ proofPlane, webhookRouter: router });

      await router.handle(
        makeGovernanceEvent({ latencyMs: undefined }),
      );

      const decision = (proofPlane.logDecisionMade as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(decision.latencyMs).toBe(0);
    });

    it("defaults version to 1 when missing", async () => {
      createProofBridge({ proofPlane, webhookRouter: router });

      await router.handle(
        makeGovernanceEvent({ version: undefined }),
      );

      const decision = (proofPlane.logDecisionMade as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(decision.version).toBe(1);
    });

    it("uses current time for decidedAt when missing", async () => {
      createProofBridge({ proofPlane, webhookRouter: router });

      const before = new Date();
      await router.handle(
        makeGovernanceEvent({ decidedAt: undefined }),
      );
      const after = new Date();

      const decision = (proofPlane.logDecisionMade as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(decision.decidedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(decision.decidedAt.getTime()).toBeLessThanOrEqual(
        after.getTime(),
      );
    });

    it("uses decidedAt + 24h for expiresAt when missing", async () => {
      createProofBridge({ proofPlane, webhookRouter: router });

      const before = new Date();
      await router.handle(
        makeGovernanceEvent({ expiresAt: undefined, decidedAt: undefined }),
      );
      const after = new Date();

      const decision = (proofPlane.logDecisionMade as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];

      const dayMs = 24 * 60 * 60 * 1000;
      expect(decision.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime() + dayMs,
      );
      expect(decision.expiresAt.getTime()).toBeLessThanOrEqual(
        after.getTime() + dayMs,
      );
    });

    it("falls back to decision === 'ALLOW' check for permitted when permitted is missing", async () => {
      createProofBridge({ proofPlane, webhookRouter: router });

      // When permitted is not in payload but decision is "ALLOW"
      await router.handle(
        makeGovernanceEvent({ permitted: undefined, decision: "ALLOW" }),
      );

      const decision = (proofPlane.logDecisionMade as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(decision.permitted).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Disconnect
  // -------------------------------------------------------------------------

  describe("disconnect", () => {
    it("stops forwarding events after disconnect is called", async () => {
      const handle = createProofBridge({
        proofPlane,
        webhookRouter: router,
      });

      // First event should forward
      await router.handle(makeGovernanceEvent());
      expect(proofPlane.logDecisionMade).toHaveBeenCalledTimes(1);

      // Disconnect
      handle.disconnect();

      // Second event should NOT forward
      await router.handle(makeGovernanceEvent());
      expect(proofPlane.logDecisionMade).toHaveBeenCalledTimes(1);
    });
  });
});
