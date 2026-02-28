/**
 * Cognigate SDK - Webhook Utilities Tests
 */

import { describe, it, expect, vi } from "vitest";
import {
  verifyWebhookSignature,
  parseWebhookPayload,
  WebhookRouter,
} from "../webhooks.js";
import type { WebhookEvent, WebhookEventType } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Produce a valid HMAC-SHA256 hex signature for a given payload + secret. */
async function signPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Build a minimal WebhookEvent object for testing. */
function makeEvent(
  overrides: Partial<WebhookEvent> = {},
): WebhookEvent {
  return {
    id: "evt_001",
    type: "agent.created",
    entityId: "agent_abc",
    payload: {},
    timestamp: new Date("2026-01-15T00:00:00Z"),
    signature: "test-sig",
    ...overrides,
  };
}

const TEST_SECRET = "whsec_test_secret_key";

// ===========================================================================
// verifyWebhookSignature
// ===========================================================================

describe("verifyWebhookSignature", () => {
  it("returns true for a valid signature", async () => {
    const payload = '{"event":"test"}';
    const signature = await signPayload(payload, TEST_SECRET);

    const result = await verifyWebhookSignature(payload, signature, TEST_SECRET);
    expect(result).toBe(true);
  });

  it("returns false for an invalid signature", async () => {
    const payload = '{"event":"test"}';
    const badSig = "0000000000000000000000000000000000000000000000000000000000000000";

    const result = await verifyWebhookSignature(payload, badSig, TEST_SECRET);
    expect(result).toBe(false);
  });

  it("returns false when signature has wrong length", async () => {
    const payload = '{"event":"test"}';
    const result = await verifyWebhookSignature(payload, "tooshort", TEST_SECRET);
    expect(result).toBe(false);
  });

  it("returns false when payload is tampered", async () => {
    const payload = '{"event":"test"}';
    const signature = await signPayload(payload, TEST_SECRET);

    const tampered = '{"event":"hacked"}';
    const result = await verifyWebhookSignature(tampered, signature, TEST_SECRET);
    expect(result).toBe(false);
  });

  it("returns false when a different secret is used", async () => {
    const payload = '{"event":"test"}';
    const signature = await signPayload(payload, TEST_SECRET);

    const result = await verifyWebhookSignature(payload, signature, "wrong_secret");
    expect(result).toBe(false);
  });
});

// ===========================================================================
// parseWebhookPayload
// ===========================================================================

describe("parseWebhookPayload", () => {
  it("parses a valid signed payload", async () => {
    const event: WebhookEvent = {
      id: "evt_100",
      type: "trust.score_changed",
      entityId: "agent_xyz",
      payload: { newScore: 750 },
      timestamp: new Date("2026-02-01T12:00:00Z"),
      signature: "ignored-in-body",
    };
    const body = JSON.stringify(event);
    const signature = await signPayload(body, TEST_SECRET);

    const parsed = await parseWebhookPayload(body, signature, TEST_SECRET);

    expect(parsed.id).toBe("evt_100");
    expect(parsed.type).toBe("trust.score_changed");
    expect(parsed.entityId).toBe("agent_xyz");
    expect(parsed.payload).toEqual({ newScore: 750 });
    expect(parsed.timestamp).toBeInstanceOf(Date);
  });

  it("throws on invalid signature", async () => {
    const body = JSON.stringify(makeEvent());
    const badSig = "00".repeat(32);

    await expect(
      parseWebhookPayload(body, badSig, TEST_SECRET),
    ).rejects.toThrow("Invalid webhook signature");
  });

  it("throws on invalid JSON even when signature is valid", async () => {
    const body = "NOT VALID JSON {{{";
    const signature = await signPayload(body, TEST_SECRET);

    await expect(
      parseWebhookPayload(body, signature, TEST_SECRET),
    ).rejects.toThrow("Invalid webhook payload");
  });
});

// ===========================================================================
// WebhookRouter
// ===========================================================================

describe("WebhookRouter", () => {
  describe("on()", () => {
    it("registers and fires a handler for a specific event type", async () => {
      const router = new WebhookRouter();
      const handler = vi.fn();

      router.on("agent.created", handler);

      const event = makeEvent({ type: "agent.created" });
      await router.handle(event);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it("does not fire handler for a different event type", async () => {
      const router = new WebhookRouter();
      const handler = vi.fn();

      router.on("agent.deleted", handler);

      await router.handle(makeEvent({ type: "agent.created" }));

      expect(handler).not.toHaveBeenCalled();
    });

    it("supports multiple handlers for the same event type", async () => {
      const router = new WebhookRouter();
      const h1 = vi.fn();
      const h2 = vi.fn();

      router.on("trust.score_changed", h1);
      router.on("trust.score_changed", h2);

      await router.handle(makeEvent({ type: "trust.score_changed" }));

      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it("returns this for chaining", () => {
      const router = new WebhookRouter();
      const result = router.on("agent.created", vi.fn());
      expect(result).toBe(router);
    });
  });

  describe("onAll()", () => {
    it("fires for any event type", async () => {
      const router = new WebhookRouter();
      const handler = vi.fn();

      router.onAll(handler);

      const types: WebhookEventType[] = [
        "agent.created",
        "trust.tier_changed",
        "governance.decision",
        "proof.recorded",
      ];

      for (const type of types) {
        await router.handle(makeEvent({ type }));
      }

      expect(handler).toHaveBeenCalledTimes(types.length);
    });

    it("fires alongside type-specific handlers", async () => {
      const router = new WebhookRouter();
      const specific = vi.fn();
      const catchAll = vi.fn();

      router.on("alert.triggered", specific);
      router.onAll(catchAll);

      await router.handle(makeEvent({ type: "alert.triggered" }));

      expect(specific).toHaveBeenCalledTimes(1);
      expect(catchAll).toHaveBeenCalledTimes(1);
    });

    it("returns this for chaining", () => {
      const router = new WebhookRouter();
      const result = router.onAll(vi.fn());
      expect(result).toBe(router);
    });
  });

  describe("handle()", () => {
    it("dispatches to type-specific handlers then catch-all handlers", async () => {
      const router = new WebhookRouter();
      const order: string[] = [];

      router.on("agent.updated", async () => {
        order.push("specific");
      });
      router.onAll(async () => {
        order.push("catchAll");
      });

      await router.handle(makeEvent({ type: "agent.updated" }));

      // Type-specific handlers run first, then catch-all
      expect(order).toEqual(["specific", "catchAll"]);
    });

    it("handles events with no registered handlers without error", async () => {
      const router = new WebhookRouter();
      // Should not throw
      await router.handle(makeEvent({ type: "proof.recorded" }));
    });

    it("awaits async handlers", async () => {
      const router = new WebhookRouter();
      let resolved = false;

      router.on("agent.status_changed", async () => {
        await new Promise<void>((r) => setTimeout(r, 10));
        resolved = true;
      });

      await router.handle(makeEvent({ type: "agent.status_changed" }));
      expect(resolved).toBe(true);
    });
  });

  describe("middleware()", () => {
    it("responds 200 on valid signed request with string body", async () => {
      const router = new WebhookRouter();
      const handler = vi.fn();
      router.on("agent.created", handler);

      const event = makeEvent({ type: "agent.created" });
      const body = JSON.stringify(event);
      const signature = await signPayload(body, TEST_SECRET);

      const jsonFn = vi.fn();
      const req = {
        headers: { "x-cognigate-signature": signature } as Record<string, string>,
        body,
      };
      const res = {
        status: vi.fn().mockReturnValue({ json: jsonFn }),
      };

      const mw = router.middleware(TEST_SECRET);
      await mw(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(jsonFn).toHaveBeenCalledWith({ received: true });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("responds 200 when body is an object (auto-stringified)", async () => {
      const router = new WebhookRouter();
      const handler = vi.fn();
      router.on("trust.tier_changed", handler);

      const event = makeEvent({ type: "trust.tier_changed" });
      // Middleware stringifies non-string bodies with JSON.stringify
      const bodyStr = JSON.stringify(event);
      const signature = await signPayload(bodyStr, TEST_SECRET);

      const jsonFn = vi.fn();
      const req = {
        headers: { "x-cognigate-signature": signature } as Record<string, string>,
        body: event, // object, not string
      };
      const res = {
        status: vi.fn().mockReturnValue({ json: jsonFn }),
      };

      const mw = router.middleware(TEST_SECRET);
      await mw(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(jsonFn).toHaveBeenCalledWith({ received: true });
    });

    it("responds 400 on invalid signature", async () => {
      const router = new WebhookRouter();
      const body = JSON.stringify(makeEvent());
      const badSig = "00".repeat(32);

      const jsonFn = vi.fn();
      const req = {
        headers: { "x-cognigate-signature": badSig } as Record<string, string>,
        body,
      };
      const res = {
        status: vi.fn().mockReturnValue({ json: jsonFn }),
      };

      const mw = router.middleware(TEST_SECRET);
      await mw(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(jsonFn).toHaveBeenCalledWith({ error: "Invalid webhook signature" });
    });
  });
});
