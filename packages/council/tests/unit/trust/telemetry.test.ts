import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs and path to avoid real file system operations
vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  readFileSync: vi.fn().mockReturnValue("{}"),
  writeFileSync: vi.fn(),
}));

vi.mock("path", () => ({
  join: (...args: string[]) => args.join("/"),
}));

import {
  TelemetryCollector,
  EVENT_FACTOR_MAP,
} from "../../../src/trust/telemetry.js";

describe("TelemetryCollector", () => {
  let collector: TelemetryCollector;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = new TelemetryCollector("/tmp/test-trust");
  });

  describe("initAgent", () => {
    it("should create agent state with default T0 tier", () => {
      const state = collector.initAgent("agent_test", "Test Agent");
      expect(state.agentId).toBe("agent_test");
      expect(state.agentName).toBe("Test Agent");
      expect(state.tier).toBe("T0");
    });

    it("should create agent state with specified tier", () => {
      const state = collector.initAgent("agent_test", "Test Agent", "T3");
      expect(state.tier).toBe("T3");
    });

    it("should initialize all 16 factors", () => {
      const state = collector.initAgent("agent_test", "Test Agent");
      const factorCodes = Object.keys(state.factors);
      expect(factorCodes).toHaveLength(16);
      expect(factorCodes).toContain("CT-OBS");
      expect(factorCodes).toContain("CT-COMP");
      expect(factorCodes).toContain("SF-LEARN");
    });

    it("should set all factor trends to stable", () => {
      const state = collector.initAgent("agent_test", "Test Agent");
      for (const factor of Object.values(state.factors)) {
        expect(factor.trend).toBe("stable");
      }
    });

    it("should include initial history snapshot", () => {
      const state = collector.initAgent("agent_test", "Test Agent");
      expect(state.history).toHaveLength(1);
      expect(state.history[0]!.event).toBe("Agent initialized");
    });
  });

  describe("recordEvent", () => {
    it("should update factor score on task_complete", () => {
      collector.initAgent("agent_1", "Agent 1");
      collector.recordEvent({
        agentId: "agent_1",
        eventType: "task_complete",
        factorCode: "CT-COMP",
        delta: 5,
        source: "test_task",
      });

      const state = collector.getState("agent_1");
      expect(state).toBeDefined();
      // Score should have increased from baseline
      expect(state!.factors["CT-COMP"]!.recentEvents).toBe(1);
    });

    it("should auto-initialize unknown agents", () => {
      collector.recordEvent({
        agentId: "unknown_agent",
        eventType: "task_complete",
        factorCode: "CT-COMP",
        delta: 5,
        source: "test",
      });

      const state = collector.getState("unknown_agent");
      expect(state).toBeDefined();
      expect(state!.agentId).toBe("unknown_agent");
    });

    it("should decrease score on negative events", () => {
      const state = collector.initAgent("agent_neg", "Negative Agent", "T3");
      const initialComp = state.factors["CT-COMP"]!.score;

      collector.recordEvent({
        agentId: "agent_neg",
        eventType: "task_failed",
        factorCode: "CT-COMP",
        delta: -10,
        source: "failed_task",
      });

      const updated = collector.getState("agent_neg");
      expect(updated!.factors["CT-COMP"]!.score).toBe(initialComp - 10);
    });

    it("should clamp scores to 0-1000", () => {
      collector.initAgent("agent_clamp", "Clamp Agent", "T0");

      // Try to go below 0
      collector.recordEvent({
        agentId: "agent_clamp",
        eventType: "task_failed",
        factorCode: "CT-COMP",
        delta: -5000,
        source: "test",
      });

      const state = collector.getState("agent_clamp");
      expect(state!.factors["CT-COMP"]!.score).toBe(0);
    });

    it("should add event to event log", () => {
      collector.initAgent("agent_log", "Log Agent");
      collector.recordEvent({
        agentId: "agent_log",
        eventType: "task_complete",
        factorCode: "CT-COMP",
        delta: 5,
        source: "task_1",
      });

      const state = collector.getState("agent_log");
      expect(state!.eventLog.length).toBe(1);
      expect(state!.eventLog[0]!.source).toBe("task_1");
    });

    it("should update trend to up on positive delta", () => {
      collector.initAgent("agent_trend", "Trend Agent");
      collector.recordEvent({
        agentId: "agent_trend",
        eventType: "task_complete",
        factorCode: "CT-COMP",
        delta: 10,
        source: "task_1",
      });

      const state = collector.getState("agent_trend");
      expect(state!.factors["CT-COMP"]!.trend).toBe("up");
    });

    it("should update trend to down on negative delta", () => {
      collector.initAgent("agent_trend_down", "Trend Down Agent");
      collector.recordEvent({
        agentId: "agent_trend_down",
        eventType: "task_failed",
        factorCode: "CT-COMP",
        delta: -10,
        source: "task_1",
      });

      const state = collector.getState("agent_trend_down");
      expect(state!.factors["CT-COMP"]!.trend).toBe("down");
    });
  });

  describe("getState", () => {
    it("should return undefined for unknown agent", () => {
      expect(collector.getState("nonexistent")).toBeUndefined();
    });

    it("should return state for initialized agent", () => {
      collector.initAgent("agent_get", "Get Agent");
      expect(collector.getState("agent_get")).toBeDefined();
    });
  });

  describe("getAllStates", () => {
    it("should return all agent states", () => {
      collector.initAgent("agent_a", "Agent A");
      collector.initAgent("agent_b", "Agent B");

      const states = collector.getAllStates();
      expect(states).toHaveLength(2);
    });

    it("should return empty array when no agents", () => {
      const states = collector.getAllStates();
      expect(states).toHaveLength(0);
    });
  });

  describe("checkPromotion", () => {
    it("should return canPromote false for unknown agent", () => {
      const result = collector.checkPromotion("unknown");
      expect(result.canPromote).toBe(false);
      expect(result.blockedBy).toContain("Agent not found");
    });

    it("should return promotion check result for known agent", () => {
      collector.initAgent("agent_promo", "Promo Agent", "T0");
      const result = collector.checkPromotion("agent_promo");
      expect(typeof result.canPromote).toBe("boolean");
      expect(result.nextTier).toBeDefined();
    });
  });
});

describe("EVENT_FACTOR_MAP", () => {
  it("should map all event types to factor codes", () => {
    const expectedEvents = [
      "task_complete",
      "task_failed",
      "policy_violation",
      "policy_compliance",
      "escalation",
      "collaboration",
      "consent_grant",
      "consent_violation",
    ];

    for (const event of expectedEvents) {
      expect(
        EVENT_FACTOR_MAP[event as keyof typeof EVENT_FACTOR_MAP],
      ).toBeDefined();
    }
  });

  it("task_complete should map to CT-COMP with positive delta", () => {
    expect(EVENT_FACTOR_MAP.task_complete.factorCode).toBe("CT-COMP");
    expect(EVENT_FACTOR_MAP.task_complete.baseDelta).toBeGreaterThan(0);
  });

  it("policy_violation should map to CT-ACCT with negative delta", () => {
    expect(EVENT_FACTOR_MAP.policy_violation.factorCode).toBe("CT-ACCT");
    expect(EVENT_FACTOR_MAP.policy_violation.baseDelta).toBeLessThan(0);
  });

  it("security_breach should have high negative delta", () => {
    expect(EVENT_FACTOR_MAP.security_breach.baseDelta).toBeLessThanOrEqual(-20);
  });

  it("consent_violation should have high negative delta", () => {
    expect(EVENT_FACTOR_MAP.consent_violation.baseDelta).toBeLessThanOrEqual(
      -20,
    );
  });
});
