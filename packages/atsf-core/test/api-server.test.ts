import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../src/api/server.js";
import type { FastifyInstance } from "fastify";

describe("API Server", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    // Provide a test JWT secret (min 32 chars required by config schema)
    process.env["VORION_JWT_SECRET"] ??=
      "test-jwt-secret-for-unit-tests-only";
    server = await createServer();
  });

  afterAll(async () => {
    await server.close();
  });

  describe("Health endpoints", () => {
    it("GET /api/v1/health should return healthy status", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/health",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("healthy");
      expect(body.version).toBeDefined();
    });

    it("GET /health should return detailed health", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toMatch(/healthy|degraded|unhealthy/);
      expect(body.checks).toBeDefined();
    });

    it("GET /ready should return readiness status", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/ready",
      });

      expect(response.statusCode).toBeLessThanOrEqual(503);
      const body = JSON.parse(response.body);
      expect(body.status).toMatch(/ready|not_ready/);
    });

    it("GET /live should return alive", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/live",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("alive");
    });
  });

  describe("Trust endpoints", () => {
    const testAgentId = "test-agent-" + Date.now();

    it("POST /api/v1/trust/admit should admit a new agent", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/trust/admit",
        payload: {
          agentId: testAgentId,
          name: "Test Agent",
          capabilities: ["read:*", "write:documents"],
          observationTier: "GRAY_BOX",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.admitted).toBe(true);
      expect(body.initialTier).toBe(3);
      expect(body.initialScore).toBe(500);
      expect(body.observationCeiling).toBe(5); // GRAY_BOX ceiling
      expect(body.capabilities).toContain("read:*");
    });

    it("GET /api/v1/trust/:agentId should return trust info", async () => {
      const response = await server.inject({
        method: "GET",
        url: `/api/v1/trust/${testAgentId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.agentId).toBe(testAgentId);
      expect(body.score).toBe(500);
      expect(body.tier).toBe(3);
      expect(body.tierName).toBe("Monitored");
    });

    it("GET /api/v1/trust/:agentId should return null for non-existent agent", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/trust/non-existent-agent",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.score).toBeNull();
      expect(body.tier).toBeNull();
      expect(body.message).toBe("Agent not found");
    });

    it("POST /api/v1/trust/:agentId/signal should record success signal", async () => {
      const response = await server.inject({
        method: "POST",
        url: `/api/v1/trust/${testAgentId}/signal`,
        payload: {
          type: "success",
          source: "test",
          weight: 0.1,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.accepted).toBe(true);
      expect(body.scoreBefore).toBe(500);
      expect(body.scoreAfter).toBeGreaterThanOrEqual(body.scoreBefore);
    });

    it("POST /api/v1/trust/:agentId/signal should return 404 for non-existent agent", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/trust/non-existent-agent/signal",
        payload: {
          type: "success",
          source: "test",
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("Intent endpoints", () => {
    const testAgentId = "intent-test-agent-" + Date.now();

    beforeAll(async () => {
      // Admit test agent first
      await server.inject({
        method: "POST",
        url: "/api/v1/trust/admit",
        payload: {
          agentId: testAgentId,
          name: "Intent Test Agent",
          capabilities: ["read:*", "write:documents"],
          observationTier: "GRAY_BOX",
        },
      });
    });

    it("POST /api/v1/intents should allow action with capability", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/intents",
        payload: {
          agentId: testAgentId,
          capabilities: ["read:*"],
          action: {
            type: "read",
            resource: "documents/report.pdf",
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.allowed).toBe(true);
      expect(body.tier).toMatch(/GREEN|YELLOW/);
      expect(body.intentId).toBeDefined();
      expect(body.proofId).toBeDefined();
      expect(body.processingTimeMs).toBeDefined();
    });

    it("POST /api/v1/intents should deny action without capability", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/intents",
        payload: {
          agentId: testAgentId,
          capabilities: ["read:*"],
          action: {
            type: "delete",
            resource: "users/admin",
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.allowed).toBe(false);
      expect(body.tier).toBe("RED");
      expect(body.reason).toContain("Missing capability");
    });

    it("POST /api/v1/intents/check should return pre-flight result", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/intents/check",
        payload: {
          agentId: testAgentId,
          capabilities: ["read:*"],
          action: {
            type: "read",
            resource: "documents/file.txt",
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.wouldAllow).toBe(true);
      expect(body.tier).toBeDefined();
      expect(body.reason).toBeDefined();
    });

    it("POST /api/v1/intents should return 400 for missing fields", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/intents",
        payload: {
          agentId: testAgentId,
          // missing action
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("Constraint validation", () => {
    it("POST /api/v1/constraints/validate should validate constraints", async () => {
      // First admit an agent
      const agentId = "constraint-test-agent-" + Date.now();
      await server.inject({
        method: "POST",
        url: "/api/v1/trust/admit",
        payload: {
          agentId,
          name: "Constraint Test Agent",
          capabilities: [],
          observationTier: "GRAY_BOX",
        },
      });

      const response = await server.inject({
        method: "POST",
        url: "/api/v1/constraints/validate",
        payload: {
          entityId: agentId,
          intentType: "read",
          context: {},
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.validation).toBeDefined();
      expect(typeof body.validation.passed).toBe("boolean");
    });
  });
});
