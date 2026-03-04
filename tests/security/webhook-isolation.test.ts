/**
 * Webhook Multi-Tenant Isolation Security Tests
 *
 * Validates that the webhook system enforces strict tenant isolation:
 * - Webhook registrations are scoped per-tenant
 * - Webhook deliveries only fire for the correct tenant
 * - Management operations (delete, circuit breaker) respect tenant boundaries
 * - Adversarial scenarios (IDOR, replay, enumeration, injection) are blocked
 *
 * Uses a self-contained mock webhook service that mirrors the real
 * WebhookService's tenant-keyed Redis storage patterns.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';

// =============================================================================
// Types (mirrors production types from webhooks.ts)
// =============================================================================

type ID = string;

type WebhookEventType =
  | 'escalation.created'
  | 'escalation.approved'
  | 'escalation.rejected'
  | 'escalation.timeout'
  | 'intent.approved'
  | 'intent.denied'
  | 'intent.completed'
  | 'decision.green'
  | 'decision.yellow'
  | 'decision.red'
  | 'decision.refined'
  | 'workflow.state_changed';

interface WebhookConfig {
  url: string;
  secret?: string;
  enabled: boolean;
  events: WebhookEventType[];
}

interface WebhookPayload {
  id: string;
  eventType: WebhookEventType;
  timestamp: string;
  tenantId: ID;
  data: Record<string, unknown>;
}

interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  attempts: number;
  deliveredAt?: string;
  skippedByCircuitBreaker?: boolean;
}

type CircuitBreakerState = 'closed' | 'open' | 'half_open';

interface CircuitBreakerData {
  failures: number;
  openedAt: number | null;
  state: CircuitBreakerState;
}

interface DeliveryRecord {
  id: string;
  webhookId: string;
  tenantId: ID;
  eventType: WebhookEventType;
  payload: WebhookPayload;
  result: WebhookDeliveryResult;
  deliveredAt: string;
}

interface EscalationRecord {
  id: ID;
  intentId: ID;
  tenantId: ID;
  reason: string;
  reasonCategory: 'trust_insufficient' | 'high_risk' | 'policy_violation' | 'manual_review' | 'constraint_escalate';
  escalatedTo: string;
  escalatedBy?: string;
  status: 'pending' | 'approved' | 'rejected' | 'timeout';
  resolution?: {
    resolvedBy: string;
    resolvedAt: string;
    notes?: string;
  };
  timeout: string;
  timeoutAt: string;
  acknowledgedAt?: string;
  slaBreached: boolean;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Mock Webhook Service
// =============================================================================

/**
 * Self-contained mock webhook service that replicates the tenant-keyed
 * storage architecture of the real WebhookService.
 *
 * Storage layout mirrors the Redis key patterns:
 *   webhook:config:{tenantId}:{webhookId} -> WebhookConfig
 *   webhook:tenants:{tenantId}            -> Set<webhookId>
 *   webhook:circuit:{tenantId}:{webhookId} -> CircuitBreakerData
 *   webhook:delivery:{tenantId}:{webhookId}:{deliveryId} -> DeliveryRecord
 */
class MockWebhookService {
  /** Map<tenantId, Map<webhookId, WebhookConfig>> */
  private webhookStore = new Map<string, Map<string, WebhookConfig>>();

  /** Map<`${tenantId}:${webhookId}`, CircuitBreakerData> */
  private circuitStore = new Map<string, CircuitBreakerData>();

  /** Map<tenantId, DeliveryRecord[]> */
  private deliveryStore = new Map<string, DeliveryRecord[]>();

  /** HTTP delivery spy: records every outbound POST attempt */
  public deliveryLog: Array<{
    webhookId: string;
    tenantId: ID;
    url: string;
    payload: WebhookPayload;
  }> = [];

  /** Simulated HTTP response for deliveries (controllable per test) */
  public mockDeliveryResponse: { ok: boolean; status: number } = { ok: true, status: 200 };

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  async registerWebhook(tenantId: ID, config: WebhookConfig): Promise<string> {
    const webhookId = randomUUID();
    if (!this.webhookStore.has(tenantId)) {
      this.webhookStore.set(tenantId, new Map());
    }
    // Each tenant gets a unique secret even when config.secret is omitted
    const storedConfig: WebhookConfig = {
      ...config,
      secret: config.secret ?? `whsec_${randomUUID()}`,
    };
    this.webhookStore.get(tenantId)!.set(webhookId, storedConfig);
    return webhookId;
  }

  // -------------------------------------------------------------------------
  // Retrieval
  // -------------------------------------------------------------------------

  async getWebhooks(tenantId: ID): Promise<Array<{ id: string; config: WebhookConfig }>> {
    const tenantWebhooks = this.webhookStore.get(tenantId);
    if (!tenantWebhooks) return [];
    return Array.from(tenantWebhooks.entries()).map(([id, config]) => ({ id, config }));
  }

  async getWebhook(tenantId: ID, webhookId: string): Promise<WebhookConfig | null> {
    const tenantWebhooks = this.webhookStore.get(tenantId);
    if (!tenantWebhooks) return null;
    return tenantWebhooks.get(webhookId) ?? null;
  }

  // -------------------------------------------------------------------------
  // Deletion
  // -------------------------------------------------------------------------

  async deleteWebhook(tenantId: ID, webhookId: string): Promise<boolean> {
    const tenantWebhooks = this.webhookStore.get(tenantId);
    if (!tenantWebhooks) return false;
    return tenantWebhooks.delete(webhookId);
  }

  // -------------------------------------------------------------------------
  // Enable / Disable
  // -------------------------------------------------------------------------

  async setWebhookEnabled(tenantId: ID, webhookId: string, enabled: boolean): Promise<boolean> {
    const tenantWebhooks = this.webhookStore.get(tenantId);
    if (!tenantWebhooks) return false;
    const config = tenantWebhooks.get(webhookId);
    if (!config) return false;
    config.enabled = enabled;
    return true;
  }

  // -------------------------------------------------------------------------
  // Delivery
  // -------------------------------------------------------------------------

  async notifyIntent(
    eventType: 'intent.approved' | 'intent.denied' | 'intent.completed',
    intentId: ID,
    tenantId: ID,
    additionalData?: Record<string, unknown>,
  ): Promise<WebhookDeliveryResult[]> {
    const payload: WebhookPayload = {
      id: randomUUID(),
      eventType,
      timestamp: new Date().toISOString(),
      tenantId,
      data: { intentId, ...additionalData },
    };
    return this.deliverToTenant(tenantId, eventType, payload);
  }

  async notifyEscalation(
    eventType: 'escalation.created' | 'escalation.approved' | 'escalation.rejected' | 'escalation.timeout',
    escalation: EscalationRecord,
  ): Promise<WebhookDeliveryResult[]> {
    const payload: WebhookPayload = {
      id: randomUUID(),
      eventType,
      timestamp: new Date().toISOString(),
      tenantId: escalation.tenantId,
      data: {
        escalationId: escalation.id,
        intentId: escalation.intentId,
        reason: escalation.reason,
        status: escalation.status,
      },
    };
    // Uses escalation.tenantId, not caller-provided tenantId
    return this.deliverToTenant(escalation.tenantId, eventType, payload);
  }

  private async deliverToTenant(
    tenantId: ID,
    eventType: WebhookEventType,
    payload: WebhookPayload,
  ): Promise<WebhookDeliveryResult[]> {
    const webhooks = await this.getWebhooks(tenantId);
    const eligible = webhooks.filter(
      ({ config }) => config.enabled && config.events.includes(eventType),
    );

    if (eligible.length === 0) return [];

    const results: WebhookDeliveryResult[] = [];

    for (const { id: webhookId, config } of eligible) {
      // Circuit breaker check
      const circuitKey = `${tenantId}:${webhookId}`;
      const circuit = this.circuitStore.get(circuitKey) ?? { failures: 0, openedAt: null, state: 'closed' as CircuitBreakerState };
      if (circuit.state === 'open') {
        results.push({
          success: false,
          error: 'Circuit breaker open - webhook delivery skipped',
          attempts: 0,
          skippedByCircuitBreaker: true,
        });
        continue;
      }

      // Record delivery attempt
      this.deliveryLog.push({ webhookId, tenantId, url: config.url, payload });

      const deliveryRecord: DeliveryRecord = {
        id: randomUUID(),
        webhookId,
        tenantId,
        eventType,
        payload,
        result: {
          success: this.mockDeliveryResponse.ok,
          statusCode: this.mockDeliveryResponse.status,
          attempts: 1,
          deliveredAt: new Date().toISOString(),
        },
        deliveredAt: new Date().toISOString(),
      };

      if (!this.deliveryStore.has(tenantId)) {
        this.deliveryStore.set(tenantId, []);
      }
      this.deliveryStore.get(tenantId)!.push(deliveryRecord);

      // Update circuit breaker on failure
      if (!this.mockDeliveryResponse.ok) {
        circuit.failures += 1;
        if (circuit.failures >= 5) {
          circuit.state = 'open';
          circuit.openedAt = Date.now();
        }
        this.circuitStore.set(circuitKey, circuit);
      } else if (circuit.state === 'half_open') {
        circuit.state = 'closed';
        circuit.failures = 0;
        circuit.openedAt = null;
        this.circuitStore.set(circuitKey, circuit);
      }

      results.push(deliveryRecord.result);
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Delivery History
  // -------------------------------------------------------------------------

  async getDeliveries(tenantId: ID): Promise<DeliveryRecord[]> {
    return this.deliveryStore.get(tenantId) ?? [];
  }

  // -------------------------------------------------------------------------
  // Circuit Breaker
  // -------------------------------------------------------------------------

  async getCircuitBreakerStatus(tenantId: ID, webhookId: string): Promise<CircuitBreakerData> {
    const key = `${tenantId}:${webhookId}`;
    return this.circuitStore.get(key) ?? { failures: 0, openedAt: null, state: 'closed' };
  }

  async setCircuitBreakerState(tenantId: ID, webhookId: string, data: CircuitBreakerData): Promise<void> {
    const key = `${tenantId}:${webhookId}`;
    this.circuitStore.set(key, data);
  }

  async resetCircuitBreaker(tenantId: ID, webhookId: string): Promise<void> {
    const key = `${tenantId}:${webhookId}`;
    this.circuitStore.set(key, { failures: 0, openedAt: null, state: 'closed' });
  }

  // -------------------------------------------------------------------------
  // Signature helpers (mirrors generateSignature / verifyWebhookSignature)
  // -------------------------------------------------------------------------

  generateSignature(payload: string, secret: string, timestamp: number): string {
    const signedPayload = `${timestamp}.${payload}`;
    const hmac = createHmac('sha256', secret).update(signedPayload).digest('hex');
    return `v1=${hmac}`;
  }

  verifySignature(payload: string, signature: string, secret: string, timestamp: number): boolean {
    const expected = this.generateSignature(payload, secret, timestamp);
    return signature === expected;
  }
}

// =============================================================================
// Test Helpers
// =============================================================================

const TENANT_A = 'tenant-alpha-001';
const TENANT_B = 'tenant-bravo-002';
const TENANT_C = 'tenant-charlie-003';

function makeConfig(overrides: Partial<WebhookConfig> = {}): WebhookConfig {
  return {
    url: `https://hooks.example.com/${randomUUID()}`,
    enabled: true,
    events: ['intent.approved', 'escalation.created'],
    ...overrides,
  };
}

function makeEscalation(tenantId: ID, overrides: Partial<EscalationRecord> = {}): EscalationRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    intentId: randomUUID(),
    tenantId,
    reason: 'High-risk operation',
    reasonCategory: 'high_risk',
    escalatedTo: 'admin@example.com',
    status: 'pending',
    timeout: 'PT1H',
    timeoutAt: new Date(Date.now() + 3600000).toISOString(),
    slaBreached: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Webhook Multi-Tenant Isolation Security Tests', () => {
  let service: MockWebhookService;

  beforeEach(() => {
    service = new MockWebhookService();
  });

  // ===========================================================================
  // 1. Webhook Registration Isolation
  // ===========================================================================

  describe('Webhook Registration Isolation', () => {
    it('webhook registered in tenant A must not appear in getWebhooks(tenantB)', async () => {
      const configA = makeConfig({ url: 'https://hooks.tenantA.example.com/wh' });
      await service.registerWebhook(TENANT_A, configA);

      const webhooksA = await service.getWebhooks(TENANT_A);
      const webhooksB = await service.getWebhooks(TENANT_B);

      expect(webhooksA).toHaveLength(1);
      expect(webhooksA[0].config.url).toBe('https://hooks.tenantA.example.com/wh');
      expect(webhooksB).toHaveLength(0);
    });

    it('same URL registered in different tenants produces independent webhooks', async () => {
      const sharedUrl = 'https://shared-receiver.example.com/webhook';
      const idA = await service.registerWebhook(TENANT_A, makeConfig({ url: sharedUrl }));
      const idB = await service.registerWebhook(TENANT_B, makeConfig({ url: sharedUrl }));

      // IDs must be different (independent registrations)
      expect(idA).not.toBe(idB);

      const webhooksA = await service.getWebhooks(TENANT_A);
      const webhooksB = await service.getWebhooks(TENANT_B);

      expect(webhooksA).toHaveLength(1);
      expect(webhooksB).toHaveLength(1);
      expect(webhooksA[0].id).not.toBe(webhooksB[0].id);
    });

    it('webhook ID from tenant A returns null when fetched via getWebhook(tenantB, id)', async () => {
      const webhookIdA = await service.registerWebhook(TENANT_A, makeConfig());

      // Lookup using the correct tenant succeeds
      const fromA = await service.getWebhook(TENANT_A, webhookIdA);
      expect(fromA).not.toBeNull();

      // Cross-tenant lookup must return null
      const fromB = await service.getWebhook(TENANT_B, webhookIdA);
      expect(fromB).toBeNull();
    });

    it('webhook secrets are generated per-tenant and are not shared', async () => {
      const sharedUrl = 'https://shared-receiver.example.com/hook';
      await service.registerWebhook(TENANT_A, makeConfig({ url: sharedUrl }));
      await service.registerWebhook(TENANT_B, makeConfig({ url: sharedUrl }));

      const [whA] = await service.getWebhooks(TENANT_A);
      const [whB] = await service.getWebhooks(TENANT_B);

      // Each webhook must have a unique auto-generated secret
      expect(whA.config.secret).toBeDefined();
      expect(whB.config.secret).toBeDefined();
      expect(whA.config.secret).not.toBe(whB.config.secret);
    });

    it('registering many webhooks in tenant A does not leak into tenant B or C', async () => {
      const count = 10;
      for (let i = 0; i < count; i++) {
        await service.registerWebhook(TENANT_A, makeConfig());
      }
      await service.registerWebhook(TENANT_B, makeConfig());

      const webhooksA = await service.getWebhooks(TENANT_A);
      const webhooksB = await service.getWebhooks(TENANT_B);
      const webhooksC = await service.getWebhooks(TENANT_C);

      expect(webhooksA).toHaveLength(count);
      expect(webhooksB).toHaveLength(1);
      expect(webhooksC).toHaveLength(0);
    });
  });

  // ===========================================================================
  // 2. Webhook Delivery Isolation
  // ===========================================================================

  describe('Webhook Delivery Isolation', () => {
    it('notifyIntent only fires webhooks for the specified tenantId', async () => {
      await service.registerWebhook(TENANT_A, makeConfig({ events: ['intent.approved'] }));
      await service.registerWebhook(TENANT_B, makeConfig({ events: ['intent.approved'] }));

      await service.notifyIntent('intent.approved', 'intent-001', TENANT_A);

      // Only tenant A's webhook should have been called
      expect(service.deliveryLog).toHaveLength(1);
      expect(service.deliveryLog[0].tenantId).toBe(TENANT_A);
    });

    it('event in tenant A does not trigger tenant B webhooks', async () => {
      const idB = await service.registerWebhook(TENANT_B, makeConfig({ events: ['intent.approved'] }));

      // Fire event for tenant A (which has no webhooks)
      const results = await service.notifyIntent('intent.approved', 'intent-001', TENANT_A);

      expect(results).toHaveLength(0);
      // Tenant B's webhook must not appear in the delivery log
      const bDeliveries = service.deliveryLog.filter((d) => d.tenantId === TENANT_B);
      expect(bDeliveries).toHaveLength(0);
    });

    it('webhook payload contains only the originating tenant data', async () => {
      await service.registerWebhook(TENANT_A, makeConfig({ events: ['intent.approved'] }));
      await service.registerWebhook(TENANT_B, makeConfig({ events: ['intent.approved'] }));

      await service.notifyIntent('intent.approved', 'intent-abc', TENANT_A, {
        sensitiveField: 'tenant-a-data',
      });

      // Verify the payload is scoped to tenant A
      expect(service.deliveryLog).toHaveLength(1);
      const deliveredPayload = service.deliveryLog[0].payload;
      expect(deliveredPayload.tenantId).toBe(TENANT_A);
      expect(deliveredPayload.data.intentId).toBe('intent-abc');
      expect(deliveredPayload.data.sensitiveField).toBe('tenant-a-data');

      // Tenant B should never have received any payload
      const bPayloads = service.deliveryLog.filter((d) => d.tenantId === TENANT_B);
      expect(bPayloads).toHaveLength(0);
    });

    it('notifyEscalation uses escalation.tenantId, not an externally supplied value', async () => {
      await service.registerWebhook(TENANT_A, makeConfig({ events: ['escalation.created'] }));
      await service.registerWebhook(TENANT_B, makeConfig({ events: ['escalation.created'] }));

      // The escalation record declares tenantId = TENANT_B
      const escalation = makeEscalation(TENANT_B);
      await service.notifyEscalation('escalation.created', escalation);

      // Only tenant B's webhook must fire
      expect(service.deliveryLog).toHaveLength(1);
      expect(service.deliveryLog[0].tenantId).toBe(TENANT_B);
      expect(service.deliveryLog[0].payload.tenantId).toBe(TENANT_B);
    });

    it('delivery history is tenant-scoped', async () => {
      await service.registerWebhook(TENANT_A, makeConfig({ events: ['intent.approved'] }));
      await service.registerWebhook(TENANT_B, makeConfig({ events: ['intent.approved'] }));

      await service.notifyIntent('intent.approved', 'intent-001', TENANT_A);
      await service.notifyIntent('intent.approved', 'intent-002', TENANT_B);

      const deliveriesA = await service.getDeliveries(TENANT_A);
      const deliveriesB = await service.getDeliveries(TENANT_B);
      const deliveriesC = await service.getDeliveries(TENANT_C);

      expect(deliveriesA).toHaveLength(1);
      expect(deliveriesA[0].tenantId).toBe(TENANT_A);
      expect(deliveriesB).toHaveLength(1);
      expect(deliveriesB[0].tenantId).toBe(TENANT_B);
      expect(deliveriesC).toHaveLength(0);
    });

    it('failed delivery retry only affects the correct tenant webhook', async () => {
      service.mockDeliveryResponse = { ok: false, status: 500 };

      const whIdA = await service.registerWebhook(TENANT_A, makeConfig({ events: ['intent.approved'] }));
      await service.registerWebhook(TENANT_B, makeConfig({ events: ['intent.approved'] }));

      // Trigger failure for tenant A
      await service.notifyIntent('intent.approved', 'intent-fail', TENANT_A);

      // Only tenant A's circuit breaker should have recorded failures
      const circuitA = await service.getCircuitBreakerStatus(TENANT_A, whIdA);
      expect(circuitA.failures).toBeGreaterThan(0);

      // Tenant B's webhooks were never called, no circuit damage
      const webhooksB = await service.getWebhooks(TENANT_B);
      for (const wb of webhooksB) {
        const circuitB = await service.getCircuitBreakerStatus(TENANT_B, wb.id);
        expect(circuitB.failures).toBe(0);
        expect(circuitB.state).toBe('closed');
      }
    });

    it('disabled webhook in tenant A does not receive deliveries even when event fires', async () => {
      await service.registerWebhook(TENANT_A, makeConfig({ enabled: false, events: ['intent.approved'] }));
      await service.registerWebhook(TENANT_B, makeConfig({ enabled: true, events: ['intent.approved'] }));

      await service.notifyIntent('intent.approved', 'intent-x', TENANT_A);

      // Tenant A's disabled webhook must not fire
      expect(service.deliveryLog).toHaveLength(0);
    });

    it('multiple events across tenants produce isolated delivery logs', async () => {
      await service.registerWebhook(TENANT_A, makeConfig({ events: ['intent.approved', 'intent.denied'] }));
      await service.registerWebhook(TENANT_B, makeConfig({ events: ['intent.approved'] }));

      await service.notifyIntent('intent.approved', 'i-1', TENANT_A);
      await service.notifyIntent('intent.denied', 'i-2', TENANT_A);
      await service.notifyIntent('intent.approved', 'i-3', TENANT_B);

      const deliveriesA = await service.getDeliveries(TENANT_A);
      const deliveriesB = await service.getDeliveries(TENANT_B);

      expect(deliveriesA).toHaveLength(2);
      expect(deliveriesB).toHaveLength(1);
      expect(deliveriesA.every((d) => d.tenantId === TENANT_A)).toBe(true);
      expect(deliveriesB.every((d) => d.tenantId === TENANT_B)).toBe(true);
    });
  });

  // ===========================================================================
  // 3. Webhook Management Isolation
  // ===========================================================================

  describe('Webhook Management Isolation', () => {
    it('deleteWebhook(tenantB, webhookIdOfA) returns false and does not delete', async () => {
      const whIdA = await service.registerWebhook(TENANT_A, makeConfig());

      // Attempt cross-tenant deletion
      const deleted = await service.deleteWebhook(TENANT_B, whIdA);
      expect(deleted).toBe(false);

      // Webhook in tenant A should still exist
      const fromA = await service.getWebhook(TENANT_A, whIdA);
      expect(fromA).not.toBeNull();
    });

    it('circuit breaker state is scoped per-tenant-per-webhook', async () => {
      const sharedUrl = 'https://shared.example.com/hook';
      const whIdA = await service.registerWebhook(TENANT_A, makeConfig({ url: sharedUrl }));
      const whIdB = await service.registerWebhook(TENANT_B, makeConfig({ url: sharedUrl }));

      // Trip circuit breaker for tenant A
      await service.setCircuitBreakerState(TENANT_A, whIdA, {
        failures: 10,
        openedAt: Date.now(),
        state: 'open',
      });

      // Tenant A's circuit should be open
      const circuitA = await service.getCircuitBreakerStatus(TENANT_A, whIdA);
      expect(circuitA.state).toBe('open');
      expect(circuitA.failures).toBe(10);

      // Tenant B's circuit must be unaffected
      const circuitB = await service.getCircuitBreakerStatus(TENANT_B, whIdB);
      expect(circuitB.state).toBe('closed');
      expect(circuitB.failures).toBe(0);
    });

    it('resetting circuit breaker for tenant A does not affect tenant B', async () => {
      const whIdA = await service.registerWebhook(TENANT_A, makeConfig());
      const whIdB = await service.registerWebhook(TENANT_B, makeConfig());

      // Open both circuits
      await service.setCircuitBreakerState(TENANT_A, whIdA, {
        failures: 7, openedAt: Date.now(), state: 'open',
      });
      await service.setCircuitBreakerState(TENANT_B, whIdB, {
        failures: 12, openedAt: Date.now(), state: 'open',
      });

      // Reset tenant A only
      await service.resetCircuitBreaker(TENANT_A, whIdA);

      const circuitA = await service.getCircuitBreakerStatus(TENANT_A, whIdA);
      const circuitB = await service.getCircuitBreakerStatus(TENANT_B, whIdB);

      expect(circuitA.state).toBe('closed');
      expect(circuitA.failures).toBe(0);

      // Tenant B must remain open
      expect(circuitB.state).toBe('open');
      expect(circuitB.failures).toBe(12);
    });

    it('enabling/disabling a webhook is tenant-scoped', async () => {
      const sharedUrl = 'https://shared.example.com/toggle';
      const whIdA = await service.registerWebhook(TENANT_A, makeConfig({ url: sharedUrl, enabled: true }));
      const whIdB = await service.registerWebhook(TENANT_B, makeConfig({ url: sharedUrl, enabled: true }));

      // Disable webhook in tenant A
      await service.setWebhookEnabled(TENANT_A, whIdA, false);

      const configA = await service.getWebhook(TENANT_A, whIdA);
      const configB = await service.getWebhook(TENANT_B, whIdB);

      expect(configA!.enabled).toBe(false);
      expect(configB!.enabled).toBe(true);
    });

    it('cross-tenant setWebhookEnabled attempt has no effect', async () => {
      const whIdA = await service.registerWebhook(TENANT_A, makeConfig({ enabled: true }));

      // Try to disable tenant A's webhook via tenant B
      const result = await service.setWebhookEnabled(TENANT_B, whIdA, false);
      expect(result).toBe(false);

      // Tenant A's webhook must remain enabled
      const configA = await service.getWebhook(TENANT_A, whIdA);
      expect(configA!.enabled).toBe(true);
    });

    it('deleting a webhook from tenant A has no effect on tenant B webhooks with same URL', async () => {
      const url = 'https://shared.example.com/deletion-test';
      const whIdA = await service.registerWebhook(TENANT_A, makeConfig({ url }));
      const whIdB = await service.registerWebhook(TENANT_B, makeConfig({ url }));

      await service.deleteWebhook(TENANT_A, whIdA);

      // Tenant A: webhook removed
      const fromA = await service.getWebhook(TENANT_A, whIdA);
      expect(fromA).toBeNull();

      // Tenant B: webhook still exists
      const fromB = await service.getWebhook(TENANT_B, whIdB);
      expect(fromB).not.toBeNull();
      expect(fromB!.url).toBe(url);
    });
  });

  // ===========================================================================
  // 4. Adversarial Scenarios
  // ===========================================================================

  describe('Adversarial Scenarios', () => {
    it('IDOR: using webhook ID from tenant A in tenant B context is blocked', async () => {
      const whIdA = await service.registerWebhook(TENANT_A, makeConfig());

      // Attacker attempts to use tenant A's webhook ID in tenant B context
      const retrievedViaB = await service.getWebhook(TENANT_B, whIdA);
      expect(retrievedViaB).toBeNull();

      const deletedViaB = await service.deleteWebhook(TENANT_B, whIdA);
      expect(deletedViaB).toBe(false);

      const enabledViaB = await service.setWebhookEnabled(TENANT_B, whIdA, false);
      expect(enabledViaB).toBe(false);

      // Original tenant A webhook is unaffected
      const original = await service.getWebhook(TENANT_A, whIdA);
      expect(original).not.toBeNull();
      expect(original!.enabled).toBe(true);
    });

    it('replay attack: valid signature for tenant A is rejected for tenant B', async () => {
      const secretA = `whsec_${randomUUID()}`;
      const secretB = `whsec_${randomUUID()}`;

      await service.registerWebhook(TENANT_A, makeConfig({ secret: secretA }));
      await service.registerWebhook(TENANT_B, makeConfig({ secret: secretB }));

      const payload = JSON.stringify({
        id: randomUUID(),
        eventType: 'intent.approved',
        tenantId: TENANT_A,
        data: { intentId: 'intent-sensitive' },
      });
      const timestamp = Math.floor(Date.now() / 1000);

      // Generate signature using tenant A's secret
      const signatureA = service.generateSignature(payload, secretA, timestamp);

      // Signature is valid for tenant A
      expect(service.verifySignature(payload, signatureA, secretA, timestamp)).toBe(true);

      // Signature must be invalid for tenant B's secret
      expect(service.verifySignature(payload, signatureA, secretB, timestamp)).toBe(false);
    });

    it('webhook enumeration: listing webhooks returns empty for non-member tenant', async () => {
      await service.registerWebhook(TENANT_A, makeConfig());
      await service.registerWebhook(TENANT_A, makeConfig());
      await service.registerWebhook(TENANT_A, makeConfig());

      // Attacker using TENANT_C cannot enumerate TENANT_A's webhooks
      const webhooksC = await service.getWebhooks(TENANT_C);
      expect(webhooksC).toHaveLength(0);

      // Also verify no information about TENANT_A is returned
      const webhooksA = await service.getWebhooks(TENANT_A);
      expect(webhooksA).toHaveLength(3);
      for (const wh of webhooksA) {
        expect(wh.config.secret).toBeDefined();
      }
    });

    it('cross-tenant event injection: event for tenant B only fires tenant B hooks', async () => {
      await service.registerWebhook(TENANT_A, makeConfig({ events: ['intent.approved'] }));
      await service.registerWebhook(TENANT_B, makeConfig({ events: ['intent.approved'] }));

      // An attacker could try to forge an event "for" tenant A but the delivery
      // system uses the explicit tenantId parameter to select webhooks.
      // Here, firing the event for TENANT_B must only hit TENANT_B's hooks.
      await service.notifyIntent('intent.approved', 'injected-intent', TENANT_B);

      expect(service.deliveryLog).toHaveLength(1);
      expect(service.deliveryLog[0].tenantId).toBe(TENANT_B);

      // Ensure tenant A was not affected
      const deliveriesA = await service.getDeliveries(TENANT_A);
      expect(deliveriesA).toHaveLength(0);
    });

    it('webhook ID guessing: random UUID does not match any tenant webhook', async () => {
      await service.registerWebhook(TENANT_A, makeConfig());
      await service.registerWebhook(TENANT_B, makeConfig());

      // Attacker guesses a random UUID
      const guessedId = randomUUID();

      const fromA = await service.getWebhook(TENANT_A, guessedId);
      const fromB = await service.getWebhook(TENANT_B, guessedId);

      expect(fromA).toBeNull();
      expect(fromB).toBeNull();
    });

    it('circuit breaker manipulation: attacker cannot reset another tenant circuit', async () => {
      const whIdA = await service.registerWebhook(TENANT_A, makeConfig());

      // Set circuit to open for tenant A
      await service.setCircuitBreakerState(TENANT_A, whIdA, {
        failures: 20,
        openedAt: Date.now(),
        state: 'open',
      });

      // Attacker tries to reset using tenant B context (would need to know whIdA)
      // The reset operates on the composite key tenantId:webhookId, so even if
      // they know the webhookId, resetting under tenant B creates a different key
      await service.resetCircuitBreaker(TENANT_B, whIdA);

      // Tenant A's circuit breaker must still be open
      const circuitA = await service.getCircuitBreakerStatus(TENANT_A, whIdA);
      expect(circuitA.state).toBe('open');
      expect(circuitA.failures).toBe(20);

      // Tenant B now has a "closed" entry under its own scope (harmless)
      const circuitB = await service.getCircuitBreakerStatus(TENANT_B, whIdA);
      expect(circuitB.state).toBe('closed');
    });
  });
});
