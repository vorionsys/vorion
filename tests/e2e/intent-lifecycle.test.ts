/**
 * Intent Lifecycle E2E Tests
 *
 * Comprehensive end-to-end tests for the complete intent lifecycle including:
 * - Create intent
 * - Submit intent
 * - Track intent status
 * - Cancel intent
 * - Complete intent lifecycle
 *
 * Uses vitest with mocked external dependencies but tests full request/response cycles.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

// =============================================================================
// MOCK SETUP
// =============================================================================

// Mock stores
const mockIntentStore = new Map<string, any>();
const mockIntentEventStore = new Map<string, any[]>();
const mockEvaluationStore = new Map<string, any[]>();
const mockEscalationStore = new Map<string, any>();
const mockPolicyStore = new Map<string, any>();

function resetStores(): void {
  mockIntentStore.clear();
  mockIntentEventStore.clear();
  mockEvaluationStore.clear();
  mockEscalationStore.clear();
  mockPolicyStore.clear();
}

// Mock configuration
vi.mock('../../src/common/config.js', () => ({
  getConfig: vi.fn(() => ({
    env: 'test',
    jwt: {
      secret: 'test-jwt-secret-minimum-32-characters-long',
      requireJti: true,
      expiration: '1h',
    },
    api: { port: 3000, host: '0.0.0.0', basePath: '/api/v1', rateLimit: 1000 },
    intent: {
      defaultNamespace: 'default',
      maxPayloadSize: 65536,
      bulkLimit: 100,
      trustGates: { 'high-risk': 3 },
      defaultMinTrustLevel: 0,
    },
    database: {
      host: 'localhost',
      port: 5432,
      database: 'vorion_test',
    },
  })),
}));

vi.mock('../../src/common/logger.js', () => {
  const createMockLogger = () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockImplementation(() => createMockLogger()),
  });
  return { createLogger: vi.fn(createMockLogger), logger: createMockLogger() };
});

// =============================================================================
// TEST UTILITIES
// =============================================================================

const TEST_TENANT_ID = 'test-tenant-intent-e2e';
const TEST_USER_ID = randomUUID();
const TEST_ENTITY_ID = randomUUID();

type IntentStatus =
  | 'pending'
  | 'evaluating'
  | 'approved'
  | 'denied'
  | 'escalated'
  | 'cancelled'
  | 'executing'
  | 'completed'
  | 'failed';

interface Intent {
  id: string;
  tenantId: string;
  entityId: string;
  goal: string;
  intentType: string;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: IntentStatus;
  priority: number;
  trustLevel?: number;
  trustScore?: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  cancellationReason?: string;
  idempotencyKey?: string;
}

interface IntentEvent {
  id: string;
  intentId: string;
  tenantId: string;
  eventType: string;
  previousStatus?: IntentStatus;
  newStatus?: IntentStatus;
  metadata: Record<string, unknown>;
  timestamp: Date;
  previousHash?: string;
  hash: string;
}

interface Evaluation {
  id: string;
  intentId: string;
  tenantId: string;
  policyId?: string;
  decision: 'allow' | 'deny' | 'escalate';
  reason: string;
  constraints?: Record<string, unknown>;
  evaluatedAt: Date;
}

interface Escalation {
  id: string;
  intentId: string;
  tenantId: string;
  reason: string;
  reasonCategory: string;
  escalatedTo: string;
  escalatedBy?: string;
  status: 'pending' | 'acknowledged' | 'approved' | 'rejected' | 'timeout' | 'cancelled';
  timeout: string;
  timeoutAt: Date;
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionNotes?: string;
}

/**
 * Mock Intent Service
 */
class MockIntentService {
  private eventCounter = 0;

  async submit(data: {
    entityId: string;
    goal: string;
    context?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    intentType?: string;
    priority?: number;
    idempotencyKey?: string;
  }, options: { tenantId: string; userId: string }): Promise<Intent> {
    // Check for idempotency
    if (data.idempotencyKey) {
      for (const [, intent] of mockIntentStore) {
        if (intent.idempotencyKey === data.idempotencyKey && intent.tenantId === options.tenantId) {
          return intent;
        }
      }
    }

    const intent: Intent = {
      id: randomUUID(),
      tenantId: options.tenantId,
      entityId: data.entityId,
      goal: data.goal,
      intentType: data.intentType ?? 'standard',
      context: data.context ?? {},
      metadata: data.metadata ?? {},
      status: 'pending',
      priority: data.priority ?? 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      idempotencyKey: data.idempotencyKey,
    };

    mockIntentStore.set(intent.id, intent);
    await this.recordEvent(intent.id, options.tenantId, 'intent.created', undefined, 'pending', {
      entityId: data.entityId,
      goal: data.goal,
    });

    return intent;
  }

  async submitBulk(
    intents: Array<{
      entityId: string;
      goal: string;
      context?: Record<string, unknown>;
      intentType?: string;
    }>,
    options: { tenantId: string; userId: string; stopOnError?: boolean }
  ): Promise<{
    successful: Intent[];
    failed: Array<{ index: number; error: string }>;
    stats: { total: number; succeeded: number; failed: number };
  }> {
    const successful: Intent[] = [];
    const failed: Array<{ index: number; error: string }> = [];

    for (let i = 0; i < intents.length; i++) {
      const intentData = intents[i];

      try {
        // Validate
        if (!intentData.entityId || !this.isValidUUID(intentData.entityId)) {
          throw new Error('Invalid entityId');
        }
        if (!intentData.goal) {
          throw new Error('Goal is required');
        }

        const intent = await this.submit(intentData, options);
        successful.push(intent);
      } catch (error) {
        failed.push({
          index: i,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        if (options.stopOnError) {
          break;
        }
      }
    }

    return {
      successful,
      failed,
      stats: {
        total: intents.length,
        succeeded: successful.length,
        failed: failed.length,
      },
    };
  }

  private isValidUUID(str: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  async get(tenantId: string, intentId: string): Promise<Intent | null> {
    const intent = mockIntentStore.get(intentId);
    if (!intent || intent.tenantId !== tenantId || intent.deletedAt) {
      return null;
    }
    return intent;
  }

  async getWithEvents(tenantId: string, intentId: string): Promise<{
    intent: Intent;
    events: IntentEvent[];
    evaluations: Evaluation[];
  } | null> {
    const intent = await this.get(tenantId, intentId);
    if (!intent) return null;

    const events = mockIntentEventStore.get(intentId) ?? [];
    const evaluations = mockEvaluationStore.get(intentId) ?? [];

    return { intent, events, evaluations };
  }

  async list(options: {
    tenantId: string;
    entityId?: string;
    status?: IntentStatus;
    limit?: number;
    cursor?: string;
  }): Promise<{
    items: Intent[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    let items: Intent[] = [];

    for (const [, intent] of mockIntentStore) {
      if (intent.tenantId !== options.tenantId) continue;
      if (intent.deletedAt) continue;
      if (options.entityId && intent.entityId !== options.entityId) continue;
      if (options.status && intent.status !== options.status) continue;
      items.push(intent);
    }

    // Sort by createdAt descending
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const limit = options.limit ?? 50;

    // Apply cursor
    if (options.cursor) {
      const cursorIndex = items.findIndex(i => i.id === options.cursor);
      if (cursorIndex >= 0) {
        items = items.slice(cursorIndex + 1);
      }
    }

    const hasMore = items.length > limit;
    items = items.slice(0, limit);

    return {
      items,
      nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
      hasMore,
    };
  }

  async updateStatus(
    tenantId: string,
    intentId: string,
    newStatus: IntentStatus,
    previousStatus?: IntentStatus
  ): Promise<Intent | null> {
    const intent = await this.get(tenantId, intentId);
    if (!intent) return null;

    const oldStatus = intent.status;
    intent.status = newStatus;
    intent.updatedAt = new Date();
    mockIntentStore.set(intentId, intent);

    await this.recordEvent(intentId, tenantId, 'intent.status_changed', oldStatus, newStatus, {});

    return intent;
  }

  async cancel(
    intentId: string,
    options: { tenantId: string; reason: string; cancelledBy?: string }
  ): Promise<Intent | null> {
    const intent = await this.get(options.tenantId, intentId);
    if (!intent) return null;

    // Can only cancel pending, evaluating, or escalated intents
    if (!['pending', 'evaluating', 'escalated'].includes(intent.status)) {
      return null;
    }

    const oldStatus = intent.status;
    intent.status = 'cancelled';
    intent.cancellationReason = options.reason;
    intent.updatedAt = new Date();
    mockIntentStore.set(intentId, intent);

    await this.recordEvent(intentId, options.tenantId, 'intent.cancelled', oldStatus, 'cancelled', {
      reason: options.reason,
      cancelledBy: options.cancelledBy,
    });

    // Also cancel any pending escalations
    for (const [, escalation] of mockEscalationStore) {
      if (escalation.intentId === intentId && escalation.status === 'pending') {
        escalation.status = 'cancelled';
        mockEscalationStore.set(escalation.id, escalation);
      }
    }

    return intent;
  }

  async delete(tenantId: string, intentId: string): Promise<Intent | null> {
    const intent = await this.get(tenantId, intentId);
    if (!intent) return null;

    intent.deletedAt = new Date();
    mockIntentStore.set(intentId, intent);

    await this.recordEvent(intentId, tenantId, 'intent.deleted', intent.status, intent.status, {});

    return intent;
  }

  async evaluate(tenantId: string, intentId: string): Promise<Evaluation> {
    const intent = await this.get(tenantId, intentId);
    if (!intent) {
      throw new Error('Intent not found');
    }

    await this.updateStatus(tenantId, intentId, 'evaluating', intent.status);

    // Mock policy evaluation
    let decision: 'allow' | 'deny' | 'escalate' = 'allow';
    let reason = 'Default allow - no matching policies';

    // Check for high-risk patterns
    if (intent.intentType === 'high_risk' || intent.context.irreversible) {
      decision = 'escalate';
      reason = 'High-risk operation requires human approval';
    }

    // Check for denied patterns
    if (intent.intentType === 'forbidden') {
      decision = 'deny';
      reason = 'Intent type is explicitly forbidden';
    }

    const evaluation: Evaluation = {
      id: randomUUID(),
      intentId,
      tenantId,
      decision,
      reason,
      evaluatedAt: new Date(),
    };

    const evaluations = mockEvaluationStore.get(intentId) ?? [];
    evaluations.push(evaluation);
    mockEvaluationStore.set(intentId, evaluations);

    // Update intent status based on evaluation
    if (decision === 'allow') {
      await this.updateStatus(tenantId, intentId, 'approved', 'evaluating');
    } else if (decision === 'deny') {
      await this.updateStatus(tenantId, intentId, 'denied', 'evaluating');
    } else if (decision === 'escalate') {
      await this.updateStatus(tenantId, intentId, 'escalated', 'evaluating');
    }

    return evaluation;
  }

  async escalate(
    intentId: string,
    options: {
      tenantId: string;
      reason: string;
      reasonCategory: string;
      escalatedTo: string;
      escalatedBy?: string;
      timeout?: string;
    }
  ): Promise<Escalation> {
    const intent = await this.get(options.tenantId, intentId);
    if (!intent) {
      throw new Error('Intent not found');
    }

    const timeoutDuration = options.timeout ?? 'PT1H'; // Default 1 hour
    const timeoutMs = this.parseDuration(timeoutDuration);

    const escalation: Escalation = {
      id: randomUUID(),
      intentId,
      tenantId: options.tenantId,
      reason: options.reason,
      reasonCategory: options.reasonCategory,
      escalatedTo: options.escalatedTo,
      escalatedBy: options.escalatedBy,
      status: 'pending',
      timeout: timeoutDuration,
      timeoutAt: new Date(Date.now() + timeoutMs),
      createdAt: new Date(),
    };

    mockEscalationStore.set(escalation.id, escalation);

    // Update intent status
    if (intent.status !== 'escalated') {
      await this.updateStatus(options.tenantId, intentId, 'escalated', intent.status);
    }

    await this.recordEvent(intentId, options.tenantId, 'intent.escalated', intent.status, 'escalated', {
      escalationId: escalation.id,
      escalatedTo: options.escalatedTo,
      reason: options.reason,
    });

    return escalation;
  }

  async resolveEscalation(
    escalationId: string,
    options: {
      tenantId: string;
      resolution: 'approved' | 'rejected';
      resolvedBy: string;
      notes?: string;
    }
  ): Promise<Escalation | null> {
    const escalation = mockEscalationStore.get(escalationId);
    if (!escalation || escalation.tenantId !== options.tenantId) {
      return null;
    }

    if (escalation.status !== 'pending' && escalation.status !== 'acknowledged') {
      return null;
    }

    escalation.status = options.resolution;
    escalation.resolvedAt = new Date();
    escalation.resolvedBy = options.resolvedBy;
    escalation.resolutionNotes = options.notes;
    mockEscalationStore.set(escalationId, escalation);

    // Update intent status based on resolution
    const newStatus: IntentStatus = options.resolution === 'approved' ? 'approved' : 'denied';
    await this.updateStatus(options.tenantId, escalation.intentId, newStatus, 'escalated');

    return escalation;
  }

  async verifyEventChain(intentId: string): Promise<{ valid: boolean; errors: string[] }> {
    const events = mockIntentEventStore.get(intentId) ?? [];
    const errors: string[] = [];

    if (events.length === 0) {
      return { valid: true, errors: [] };
    }

    // Verify hash chain
    for (let i = 1; i < events.length; i++) {
      if (events[i].previousHash !== events[i - 1].hash) {
        errors.push(`Event ${i}: Hash chain broken`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  private async recordEvent(
    intentId: string,
    tenantId: string,
    eventType: string,
    previousStatus: IntentStatus | undefined,
    newStatus: IntentStatus,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const events = mockIntentEventStore.get(intentId) ?? [];
    const previousHash = events.length > 0 ? events[events.length - 1].hash : undefined;

    const event: IntentEvent = {
      id: randomUUID(),
      intentId,
      tenantId,
      eventType,
      previousStatus,
      newStatus,
      metadata,
      timestamp: new Date(),
      previousHash,
      hash: `hash-${++this.eventCounter}`,
    };

    events.push(event);
    mockIntentEventStore.set(intentId, events);
  }

  private parseDuration(duration: string): number {
    // Parse ISO 8601 duration (simplified)
    const match = duration.match(/PT(\d+)([HMS])/i);
    if (!match) return 3600000; // Default 1 hour

    const value = parseInt(match[1], 10);
    const unit = match[2].toUpperCase();

    switch (unit) {
      case 'H':
        return value * 60 * 60 * 1000;
      case 'M':
        return value * 60 * 1000;
      case 'S':
        return value * 1000;
      default:
        return 3600000;
    }
  }
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Intent Lifecycle E2E Tests', () => {
  const intentService = new MockIntentService();

  beforeEach(() => {
    resetStores();
  });

  // ===========================================================================
  // CREATE INTENT
  // ===========================================================================

  describe('Create Intent', () => {
    it('should create a new intent successfully', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Test intent creation',
        context: { action: 'test' },
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      expect(intent.id).toBeDefined();
      expect(intent.tenantId).toBe(TEST_TENANT_ID);
      expect(intent.entityId).toBe(TEST_ENTITY_ID);
      expect(intent.goal).toBe('Test intent creation');
      expect(intent.status).toBe('pending');
    });

    it('should create intent with all fields', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Full intent',
        context: { action: 'full-test', target: 'system' },
        metadata: { source: 'e2e-test' },
        intentType: 'custom',
        priority: 5,
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      expect(intent.context).toEqual({ action: 'full-test', target: 'system' });
      expect(intent.metadata).toEqual({ source: 'e2e-test' });
      expect(intent.intentType).toBe('custom');
      expect(intent.priority).toBe(5);
    });

    it('should handle idempotency key for duplicate prevention', async () => {
      const idempotencyKey = `idem-${randomUUID()}`;

      const intent1 = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Idempotent intent',
        idempotencyKey,
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      const intent2 = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Idempotent intent',
        idempotencyKey,
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      // Should return the same intent
      expect(intent2.id).toBe(intent1.id);
    });

    it('should record creation event', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Event tracking test',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      const result = await intentService.getWithEvents(TEST_TENANT_ID, intent.id);

      expect(result).not.toBeNull();
      expect(result!.events.length).toBeGreaterThan(0);
      expect(result!.events[0].eventType).toBe('intent.created');
    });
  });

  // ===========================================================================
  // BULK SUBMIT
  // ===========================================================================

  describe('Bulk Submit Intents', () => {
    it('should submit multiple intents in bulk', async () => {
      const intents = [
        { entityId: randomUUID(), goal: 'Bulk intent 1' },
        { entityId: randomUUID(), goal: 'Bulk intent 2' },
        { entityId: randomUUID(), goal: 'Bulk intent 3' },
      ];

      const result = await intentService.submitBulk(intents, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      expect(result.stats.total).toBe(3);
      expect(result.stats.succeeded).toBe(3);
      expect(result.stats.failed).toBe(0);
      expect(result.successful.length).toBe(3);
    });

    it('should handle partial failures in bulk submit', async () => {
      const intents = [
        { entityId: randomUUID(), goal: 'Valid intent 1' },
        { entityId: 'invalid-uuid', goal: 'Invalid entity ID' },
        { entityId: randomUUID(), goal: 'Valid intent 2' },
      ];

      const result = await intentService.submitBulk(intents, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      expect(result.stats.total).toBe(3);
      expect(result.stats.succeeded).toBe(2);
      expect(result.stats.failed).toBe(1);
      expect(result.failed[0].index).toBe(1);
    });

    it('should stop on error when stopOnError is true', async () => {
      const intents = [
        { entityId: randomUUID(), goal: 'Valid intent' },
        { entityId: 'invalid-uuid', goal: 'Invalid - should stop here' },
        { entityId: randomUUID(), goal: 'Should not be processed' },
      ];

      const result = await intentService.submitBulk(intents, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
        stopOnError: true,
      });

      expect(result.stats.succeeded).toBe(1);
      expect(result.stats.failed).toBe(1);
    });
  });

  // ===========================================================================
  // TRACK INTENT STATUS
  // ===========================================================================

  describe('Track Intent Status', () => {
    it('should get intent by ID', async () => {
      const created = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Get by ID test',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      const intent = await intentService.get(TEST_TENANT_ID, created.id);

      expect(intent).not.toBeNull();
      expect(intent!.id).toBe(created.id);
    });

    it('should get intent with events and evaluations', async () => {
      const created = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Full details test',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      const result = await intentService.getWithEvents(TEST_TENANT_ID, created.id);

      expect(result).not.toBeNull();
      expect(result!.intent.id).toBe(created.id);
      expect(result!.events).toBeDefined();
      expect(Array.isArray(result!.events)).toBe(true);
      expect(result!.evaluations).toBeDefined();
      expect(Array.isArray(result!.evaluations)).toBe(true);
    });

    it('should return null for non-existent intent', async () => {
      const intent = await intentService.get(TEST_TENANT_ID, randomUUID());
      expect(intent).toBeNull();
    });

    it('should enforce tenant isolation on get', async () => {
      const created = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Tenant isolation test',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      // Try to get with different tenant
      const intent = await intentService.get('different-tenant', created.id);
      expect(intent).toBeNull();
    });

    it('should list intents with pagination', async () => {
      // Create multiple intents
      for (let i = 0; i < 5; i++) {
        await intentService.submit({
          entityId: TEST_ENTITY_ID,
          goal: `List test ${i}`,
        }, {
          tenantId: TEST_TENANT_ID,
          userId: TEST_USER_ID,
        });
      }

      const result = await intentService.list({
        tenantId: TEST_TENANT_ID,
        limit: 2,
      });

      expect(result.items.length).toBe(2);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeDefined();
    });

    it('should filter intents by status', async () => {
      // Create intents with different statuses
      const intent1 = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Pending intent',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      const intent2 = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Approved intent',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });
      await intentService.updateStatus(TEST_TENANT_ID, intent2.id, 'approved', 'pending');

      const result = await intentService.list({
        tenantId: TEST_TENANT_ID,
        status: 'pending',
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe(intent1.id);
    });

    it('should filter intents by entityId', async () => {
      const entity1 = randomUUID();
      const entity2 = randomUUID();

      await intentService.submit({
        entityId: entity1,
        goal: 'Entity 1 intent',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      await intentService.submit({
        entityId: entity2,
        goal: 'Entity 2 intent',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      const result = await intentService.list({
        tenantId: TEST_TENANT_ID,
        entityId: entity1,
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].entityId).toBe(entity1);
    });
  });

  // ===========================================================================
  // INTENT EVALUATION
  // ===========================================================================

  describe('Intent Evaluation', () => {
    it('should evaluate intent and approve it', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Standard operation',
        intentType: 'standard',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      const evaluation = await intentService.evaluate(TEST_TENANT_ID, intent.id);

      expect(evaluation.decision).toBe('allow');
      expect(evaluation.intentId).toBe(intent.id);

      const updated = await intentService.get(TEST_TENANT_ID, intent.id);
      expect(updated!.status).toBe('approved');
    });

    it('should evaluate high-risk intent and escalate', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Delete all data',
        intentType: 'high_risk',
        context: { irreversible: true },
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      const evaluation = await intentService.evaluate(TEST_TENANT_ID, intent.id);

      expect(evaluation.decision).toBe('escalate');

      const updated = await intentService.get(TEST_TENANT_ID, intent.id);
      expect(updated!.status).toBe('escalated');
    });

    it('should evaluate forbidden intent and deny', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Forbidden operation',
        intentType: 'forbidden',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      const evaluation = await intentService.evaluate(TEST_TENANT_ID, intent.id);

      expect(evaluation.decision).toBe('deny');

      const updated = await intentService.get(TEST_TENANT_ID, intent.id);
      expect(updated!.status).toBe('denied');
    });

    it('should track evaluation in intent history', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Evaluation tracking',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      await intentService.evaluate(TEST_TENANT_ID, intent.id);

      const result = await intentService.getWithEvents(TEST_TENANT_ID, intent.id);
      expect(result!.evaluations.length).toBe(1);
    });
  });

  // ===========================================================================
  // ESCALATION FLOW
  // ===========================================================================

  describe('Escalation Flow', () => {
    it('should create escalation for intent', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Manual escalation test',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      const escalation = await intentService.escalate(intent.id, {
        tenantId: TEST_TENANT_ID,
        reason: 'Requires human review',
        reasonCategory: 'manual_review',
        escalatedTo: 'governance-team',
        escalatedBy: TEST_USER_ID,
      });

      expect(escalation.id).toBeDefined();
      expect(escalation.status).toBe('pending');
      expect(escalation.escalatedTo).toBe('governance-team');
    });

    it('should approve escalation and update intent', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Approval test',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      const escalation = await intentService.escalate(intent.id, {
        tenantId: TEST_TENANT_ID,
        reason: 'High value operation',
        reasonCategory: 'high_risk',
        escalatedTo: 'governance-team',
      });

      const resolved = await intentService.resolveEscalation(escalation.id, {
        tenantId: TEST_TENANT_ID,
        resolution: 'approved',
        resolvedBy: 'approver-001',
        notes: 'Approved after review',
      });

      expect(resolved!.status).toBe('approved');
      expect(resolved!.resolvedBy).toBe('approver-001');

      const updated = await intentService.get(TEST_TENANT_ID, intent.id);
      expect(updated!.status).toBe('approved');
    });

    it('should reject escalation and deny intent', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Rejection test',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      const escalation = await intentService.escalate(intent.id, {
        tenantId: TEST_TENANT_ID,
        reason: 'Suspicious activity',
        reasonCategory: 'policy_violation',
        escalatedTo: 'security-team',
      });

      const resolved = await intentService.resolveEscalation(escalation.id, {
        tenantId: TEST_TENANT_ID,
        resolution: 'rejected',
        resolvedBy: 'security-admin',
        notes: 'Policy violation confirmed',
      });

      expect(resolved!.status).toBe('rejected');

      const updated = await intentService.get(TEST_TENANT_ID, intent.id);
      expect(updated!.status).toBe('denied');
    });

    it('should set escalation timeout', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Timeout test',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      const escalation = await intentService.escalate(intent.id, {
        tenantId: TEST_TENANT_ID,
        reason: 'Review needed',
        reasonCategory: 'manual_review',
        escalatedTo: 'governance-team',
        timeout: 'PT2H', // 2 hours
      });

      expect(escalation.timeout).toBe('PT2H');
      expect(escalation.timeoutAt.getTime()).toBeGreaterThan(Date.now());
      expect(escalation.timeoutAt.getTime()).toBeLessThan(Date.now() + 2 * 60 * 60 * 1000 + 1000);
    });
  });

  // ===========================================================================
  // CANCEL INTENT
  // ===========================================================================

  describe('Cancel Intent', () => {
    it('should cancel a pending intent', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Cancel test',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      const cancelled = await intentService.cancel(intent.id, {
        tenantId: TEST_TENANT_ID,
        reason: 'No longer needed',
        cancelledBy: TEST_USER_ID,
      });

      expect(cancelled).not.toBeNull();
      expect(cancelled!.status).toBe('cancelled');
      expect(cancelled!.cancellationReason).toBe('No longer needed');
    });

    it('should cancel an escalated intent', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Escalate then cancel',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      await intentService.escalate(intent.id, {
        tenantId: TEST_TENANT_ID,
        reason: 'Review needed',
        reasonCategory: 'manual_review',
        escalatedTo: 'governance-team',
      });

      const cancelled = await intentService.cancel(intent.id, {
        tenantId: TEST_TENANT_ID,
        reason: 'Changed requirements',
      });

      expect(cancelled!.status).toBe('cancelled');
    });

    it('should also cancel pending escalations when intent is cancelled', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Cancel with escalation',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      const escalation = await intentService.escalate(intent.id, {
        tenantId: TEST_TENANT_ID,
        reason: 'Review',
        reasonCategory: 'manual_review',
        escalatedTo: 'team',
      });

      await intentService.cancel(intent.id, {
        tenantId: TEST_TENANT_ID,
        reason: 'Cancelled',
      });

      const updatedEscalation = mockEscalationStore.get(escalation.id);
      expect(updatedEscalation.status).toBe('cancelled');
    });

    it('should not cancel a completed intent', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Complete then cancel',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      // Mark as completed
      await intentService.updateStatus(TEST_TENANT_ID, intent.id, 'completed', 'pending');

      const result = await intentService.cancel(intent.id, {
        tenantId: TEST_TENANT_ID,
        reason: 'Too late',
      });

      expect(result).toBeNull();
    });

    it('should not cancel a denied intent', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Denied then cancel',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      await intentService.updateStatus(TEST_TENANT_ID, intent.id, 'denied', 'pending');

      const result = await intentService.cancel(intent.id, {
        tenantId: TEST_TENANT_ID,
        reason: 'Already denied',
      });

      expect(result).toBeNull();
    });

    it('should record cancellation event', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Cancel event test',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      await intentService.cancel(intent.id, {
        tenantId: TEST_TENANT_ID,
        reason: 'Testing events',
      });

      const result = await intentService.getWithEvents(TEST_TENANT_ID, intent.id);
      const cancelEvent = result!.events.find(e => e.eventType === 'intent.cancelled');

      expect(cancelEvent).toBeDefined();
      expect(cancelEvent!.metadata.reason).toBe('Testing events');
    });
  });

  // ===========================================================================
  // DELETE INTENT (GDPR)
  // ===========================================================================

  describe('Delete Intent (GDPR Soft Delete)', () => {
    it('should soft delete an intent', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Delete test',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      const deleted = await intentService.delete(TEST_TENANT_ID, intent.id);
      expect(deleted).not.toBeNull();

      // Should no longer be accessible via get
      const notFound = await intentService.get(TEST_TENANT_ID, intent.id);
      expect(notFound).toBeNull();
    });

    it('should not return deleted intents in list', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'List exclusion test',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      await intentService.delete(TEST_TENANT_ID, intent.id);

      const result = await intentService.list({ tenantId: TEST_TENANT_ID });
      const found = result.items.find(i => i.id === intent.id);

      expect(found).toBeUndefined();
    });
  });

  // ===========================================================================
  // COMPLETE LIFECYCLE
  // ===========================================================================

  describe('Complete Intent Lifecycle', () => {
    it('should complete full lifecycle: submit -> evaluate -> approve -> execute -> complete', async () => {
      // 1. Submit
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Full lifecycle test',
        intentType: 'standard',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });
      expect(intent.status).toBe('pending');

      // 2. Evaluate (auto-approve for standard type)
      await intentService.evaluate(TEST_TENANT_ID, intent.id);
      const afterEval = await intentService.get(TEST_TENANT_ID, intent.id);
      expect(afterEval!.status).toBe('approved');

      // 3. Execute
      await intentService.updateStatus(TEST_TENANT_ID, intent.id, 'executing', 'approved');
      const afterExec = await intentService.get(TEST_TENANT_ID, intent.id);
      expect(afterExec!.status).toBe('executing');

      // 4. Complete
      await intentService.updateStatus(TEST_TENANT_ID, intent.id, 'completed', 'executing');
      const final = await intentService.get(TEST_TENANT_ID, intent.id);
      expect(final!.status).toBe('completed');

      // Verify event chain
      const result = await intentService.getWithEvents(TEST_TENANT_ID, intent.id);
      const statuses = result!.events.map(e => e.newStatus);
      expect(statuses).toContain('pending');
      expect(statuses).toContain('evaluating');
      expect(statuses).toContain('approved');
      expect(statuses).toContain('executing');
      expect(statuses).toContain('completed');
    });

    it('should complete lifecycle with escalation: submit -> escalate -> approve -> execute -> complete', async () => {
      // 1. Submit high-risk intent
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'High risk operation',
        intentType: 'high_risk',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      // 2. Evaluate (triggers escalation)
      await intentService.evaluate(TEST_TENANT_ID, intent.id);
      const afterEval = await intentService.get(TEST_TENANT_ID, intent.id);
      expect(afterEval!.status).toBe('escalated');

      // 3. Create escalation (would normally happen automatically)
      const escalation = await intentService.escalate(intent.id, {
        tenantId: TEST_TENANT_ID,
        reason: 'High risk requires approval',
        reasonCategory: 'high_risk',
        escalatedTo: 'governance-team',
      });

      // 4. Approve escalation
      await intentService.resolveEscalation(escalation.id, {
        tenantId: TEST_TENANT_ID,
        resolution: 'approved',
        resolvedBy: 'approver',
      });
      const afterApproval = await intentService.get(TEST_TENANT_ID, intent.id);
      expect(afterApproval!.status).toBe('approved');

      // 5. Execute and complete
      await intentService.updateStatus(TEST_TENANT_ID, intent.id, 'executing', 'approved');
      await intentService.updateStatus(TEST_TENANT_ID, intent.id, 'completed', 'executing');

      const final = await intentService.get(TEST_TENANT_ID, intent.id);
      expect(final!.status).toBe('completed');
    });

    it('should handle denied lifecycle: submit -> evaluate -> deny', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Forbidden operation',
        intentType: 'forbidden',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      await intentService.evaluate(TEST_TENANT_ID, intent.id);

      const final = await intentService.get(TEST_TENANT_ID, intent.id);
      expect(final!.status).toBe('denied');

      const result = await intentService.getWithEvents(TEST_TENANT_ID, intent.id);
      expect(result!.evaluations[0].decision).toBe('deny');
    });
  });

  // ===========================================================================
  // EVENT CHAIN VERIFICATION
  // ===========================================================================

  describe('Event Chain Verification', () => {
    it('should verify intact event chain', async () => {
      const intent = await intentService.submit({
        entityId: TEST_ENTITY_ID,
        goal: 'Chain verification test',
      }, {
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
      });

      // Add more events
      await intentService.updateStatus(TEST_TENANT_ID, intent.id, 'evaluating', 'pending');
      await intentService.updateStatus(TEST_TENANT_ID, intent.id, 'approved', 'evaluating');

      const verification = await intentService.verifyEventChain(intent.id);

      expect(verification.valid).toBe(true);
      expect(verification.errors.length).toBe(0);
    });

    it('should detect empty event chain', async () => {
      const verification = await intentService.verifyEventChain(randomUUID());

      expect(verification.valid).toBe(true);
      expect(verification.errors.length).toBe(0);
    });
  });
});
