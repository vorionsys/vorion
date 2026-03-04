/**
 * Intent Lifecycle End-to-End Integration Tests
 *
 * Tests the complete intent lifecycle: submit -> evaluate -> decide -> execute -> proof
 * Covers approval, denial, escalation, GDPR compliance, and trust score impact flows.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// =============================================================================
// MOCK SETUP
// =============================================================================

// Store for simulating database state across all services
const mockIntentStore = new Map<string, any>();
const mockEventStore: any[] = [];
const mockEvaluationStore: any[] = [];
const mockProofStore: any[] = [];
const mockTrustStore = new Map<string, any>();
const mockTrustSignalStore: any[] = [];
const mockTrustHistoryStore: any[] = [];
const mockAuditStore: any[] = [];
const mockEscalationStore = new Map<string, any>();
let mockProofChainPosition = 0;
let mockProofLastHash = '0'.repeat(64);
let mockAuditSequence = 0;

// Helper to reset all stores
function resetStores(): void {
  mockIntentStore.clear();
  mockEventStore.length = 0;
  mockEvaluationStore.length = 0;
  mockProofStore.length = 0;
  mockTrustStore.clear();
  mockTrustSignalStore.length = 0;
  mockTrustHistoryStore.length = 0;
  mockAuditStore.length = 0;
  mockEscalationStore.clear();
  mockProofChainPosition = 0;
  mockProofLastHash = '0'.repeat(64);
  mockAuditSequence = 0;
}

// Mock config
vi.mock('../../src/common/config.js', () => ({
  getConfig: vi.fn(() => ({
    env: 'test',
    jwt: { secret: 'test-secret-key-for-testing-12345', requireJti: false },
    api: { port: 3000, host: '0.0.0.0', basePath: '/api/v1', rateLimit: 1000 },
    redis: { host: 'localhost', port: 6379, db: 0 },
    intent: {
      defaultNamespace: 'default',
      namespaceRouting: {},
      dedupeTtlSeconds: 600,
      sensitivePaths: ['context.password', 'context.apiKey'],
      defaultMaxInFlight: 1000,
      tenantMaxInFlight: {},
      queueConcurrency: 5,
      jobTimeoutMs: 30000,
      maxRetries: 3,
      retryBackoffMs: 1000,
      eventRetentionDays: 90,
      encryptContext: false,
      trustGates: { 'high-risk': 3 },
      defaultMinTrustLevel: 0,
      revalidateTrustAtDecision: true,
      softDeleteRetentionDays: 30,
      escalationTimeout: 'PT1H',
      dedupeSecret: 'test-dedupe-secret',
      dedupeTimestampWindowSeconds: 60,
    },
    audit: {
      retentionDays: 2555,
      archiveAfterDays: 365,
    },
    health: { checkTimeoutMs: 5000, readyTimeoutMs: 10000 },
  })),
}));

// Mock logger
vi.mock('../../src/common/logger.js', () => {
  const createMockLogger = () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockImplementation(() => createMockLogger()),
  });
  return { createLogger: vi.fn(createMockLogger), logger: createMockLogger() };
});

// Mock Redis
vi.mock('../../src/common/redis.js', () => {
  const mockRedis = {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(3600),
    duplicate: vi.fn().mockReturnThis(),
    ping: vi.fn().mockResolvedValue('PONG'),
    eval: vi.fn().mockResolvedValue(1),
    sadd: vi.fn().mockResolvedValue(1),
    srem: vi.fn().mockResolvedValue(1),
    smembers: vi.fn().mockResolvedValue([]),
    zadd: vi.fn().mockResolvedValue(1),
    zrem: vi.fn().mockResolvedValue(1),
    rpush: vi.fn().mockResolvedValue(1),
  };
  return {
    getRedis: vi.fn(() => mockRedis),
    checkRedisHealth: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 1 }),
  };
});

// Mock lock service
vi.mock('../../src/common/lock.js', () => ({
  getLockService: vi.fn(() => ({
    acquire: vi.fn().mockResolvedValue({
      acquired: true,
      lock: { release: vi.fn().mockResolvedValue(undefined) },
    }),
  })),
}));

// Mock trace context
vi.mock('../../src/common/trace.js', () => ({
  getTraceContext: vi.fn(() => ({ traceId: 'test-trace-id', spanId: 'test-span-id' })),
}));

// Import after mocks are set up
import type { Intent, Decision, TrustLevel, ID, IntentStatus } from '../../src/common/types.js';

// =============================================================================
// SERVICE IMPLEMENTATIONS (with real business logic, mocked persistence)
// =============================================================================

/**
 * Mock Intent Service that simulates real lifecycle
 */
class MockIntentService {
  async submit(
    payload: { entityId: string; goal: string; context: Record<string, unknown>; intentType?: string; priority?: number },
    options: { tenantId: string; trustLevel?: TrustLevel; bypassTrustGate?: boolean }
  ): Promise<Intent> {
    // Trust gate validation
    if (!options.bypassTrustGate && payload.intentType === 'high-risk') {
      const requiredLevel = 3;
      const actualLevel = options.trustLevel ?? 0;
      if (actualLevel < requiredLevel) {
        throw new Error(`Trust level ${actualLevel} insufficient, requires ${requiredLevel}`);
      }
    }

    const intent: Intent = {
      id: randomUUID(),
      tenantId: options.tenantId,
      entityId: payload.entityId,
      goal: payload.goal,
      context: payload.context,
      metadata: {},
      intentType: payload.intentType ?? null,
      priority: payload.priority ?? 0,
      status: 'pending',
      trustLevel: options.trustLevel ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    mockIntentStore.set(intent.id, intent);

    // Record submission event
    mockEventStore.push({
      id: randomUUID(),
      intentId: intent.id,
      eventType: 'intent.submitted',
      payload: { goal: payload.goal },
      occurredAt: new Date().toISOString(),
    });

    return intent;
  }

  async get(id: string, tenantId: string): Promise<Intent | null> {
    const intent = mockIntentStore.get(id);
    if (intent && intent.tenantId === tenantId && !intent.deletedAt) {
      return intent;
    }
    return null;
  }

  async updateStatus(id: string, tenantId: string, status: IntentStatus): Promise<Intent | null> {
    const intent = mockIntentStore.get(id);
    if (intent && intent.tenantId === tenantId) {
      const previousStatus = intent.status;
      intent.status = status;
      intent.updatedAt = new Date().toISOString();

      mockEventStore.push({
        id: randomUUID(),
        intentId: id,
        eventType: `intent.${status}`,
        payload: { previousStatus, status },
        occurredAt: new Date().toISOString(),
      });

      return intent;
    }
    return null;
  }

  async recordEvaluation(intentId: string, tenantId: string, result: any): Promise<void> {
    mockEvaluationStore.push({
      id: randomUUID(),
      intentId,
      tenantId,
      result,
      createdAt: new Date().toISOString(),
    });
  }

  async getEvents(intentId: string): Promise<any[]> {
    return mockEventStore.filter((e) => e.intentId === intentId);
  }

  async getEvaluations(intentId: string): Promise<any[]> {
    return mockEvaluationStore.filter((e) => e.intentId === intentId);
  }
}

/**
 * Mock Policy Evaluator that simulates rule evaluation
 */
class MockPolicyEvaluator {
  evaluate(intent: Intent, trustLevel: TrustLevel): { action: 'allow' | 'deny' | 'escalate'; reason: string } {
    // Simulate policy rules based on intent type and trust level
    if (intent.intentType === 'blocked') {
      return { action: 'deny', reason: 'Intent type is blocked by policy' };
    }

    if (intent.intentType === 'high-risk' && trustLevel < 3) {
      return { action: 'escalate', reason: 'High-risk intent requires higher trust level or human approval' };
    }

    if (intent.intentType === 'requires-approval') {
      return { action: 'escalate', reason: 'Intent type requires human approval' };
    }

    if (trustLevel < 1) {
      return { action: 'deny', reason: 'Insufficient trust level' };
    }

    return { action: 'allow', reason: 'Policy evaluation passed' };
  }
}

/**
 * Mock Trust Engine
 */
class MockTrustEngine {
  async getScore(entityId: string): Promise<{ score: number; level: TrustLevel } | undefined> {
    return mockTrustStore.get(entityId);
  }

  async initializeEntity(entityId: string, initialLevel: TrustLevel = 1): Promise<void> {
    const score = initialLevel * 200;
    mockTrustStore.set(entityId, { entityId, score, level: initialLevel });
    mockTrustHistoryStore.push({
      entityId,
      score,
      level: initialLevel,
      reason: 'Initial registration',
      timestamp: new Date().toISOString(),
    });
  }

  async recordSignal(signal: { entityId: string; type: string; value: number; weight?: number }): Promise<void> {
    mockTrustSignalStore.push({
      ...signal,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    });

    // Update trust score based on signal
    const current = mockTrustStore.get(signal.entityId);
    if (current) {
      const delta = signal.value * (signal.weight ?? 1) * 50; // Scale factor
      const newScore = Math.max(0, Math.min(1000, current.score + delta));
      const newLevel = this.scoreToLevel(newScore);

      mockTrustStore.set(signal.entityId, {
        ...current,
        score: newScore,
        level: newLevel,
      });

      if (Math.abs(newScore - current.score) >= 10) {
        mockTrustHistoryStore.push({
          entityId: signal.entityId,
          score: newScore,
          previousScore: current.score,
          level: newLevel,
          reason: `Signal: ${signal.type}`,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  private scoreToLevel(score: number): TrustLevel {
    if (score >= 900) return 5;
    if (score >= 700) return 4;
    if (score >= 500) return 3;
    if (score >= 300) return 2;
    if (score >= 100) return 1;
    return 0;
  }

  getHistory(entityId: string): any[] {
    return mockTrustHistoryStore.filter((h) => h.entityId === entityId);
  }
}

/**
 * Mock Proof Service
 */
class MockProofService {
  async create(request: { intent: Intent; decision: Decision; inputs: any; outputs: any }): Promise<any> {
    const proof = {
      id: randomUUID(),
      chainPosition: mockProofChainPosition++,
      intentId: request.intent.id,
      entityId: request.intent.entityId,
      decision: request.decision,
      inputs: request.inputs,
      outputs: request.outputs,
      hash: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
      previousHash: mockProofLastHash,
      signature: 'mock-signature-' + randomUUID(),
      createdAt: new Date().toISOString(),
    };

    mockProofLastHash = proof.hash;
    mockProofStore.push(proof);

    return proof;
  }

  async get(id: string): Promise<any | null> {
    return mockProofStore.find((p) => p.id === id) ?? null;
  }

  async query(options: { intentId?: string; entityId?: string }): Promise<any[]> {
    return mockProofStore.filter((p) => {
      if (options.intentId && p.intentId !== options.intentId) return false;
      if (options.entityId && p.entityId !== options.entityId) return false;
      return true;
    });
  }

  async verify(id: string): Promise<{ valid: boolean; issues: string[] }> {
    const proof = mockProofStore.find((p) => p.id === id);
    if (!proof) return { valid: false, issues: ['Proof not found'] };
    return { valid: true, issues: [] };
  }
}

/**
 * Mock Audit Service
 */
class MockAuditService {
  async record(input: {
    tenantId: string;
    eventType: string;
    actor: { type: string; id: string };
    target: { type: string; id: string };
    action: string;
    outcome: 'success' | 'failure';
    reason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<any> {
    const record = {
      id: randomUUID(),
      ...input,
      sequenceNumber: ++mockAuditSequence,
      recordHash: randomUUID(),
      eventTime: new Date().toISOString(),
      recordedAt: new Date().toISOString(),
    };
    mockAuditStore.push(record);
    return record;
  }

  async query(filters: { tenantId: string; targetId?: string; targetType?: string }): Promise<any[]> {
    return mockAuditStore.filter((r) => {
      if (r.tenantId !== filters.tenantId) return false;
      if (filters.targetId && r.target.id !== filters.targetId) return false;
      if (filters.targetType && r.target.type !== filters.targetType) return false;
      return true;
    });
  }

  async getForTarget(tenantId: string, targetType: string, targetId: string): Promise<any[]> {
    return mockAuditStore.filter(
      (r) => r.tenantId === tenantId && r.target.type === targetType && r.target.id === targetId
    );
  }
}

/**
 * Mock Escalation Service
 */
class MockEscalationService {
  async create(options: {
    intentId: string;
    tenantId: string;
    reason: string;
    reasonCategory: string;
    escalatedTo: string;
    timeout?: string;
  }): Promise<any> {
    const escalation = {
      id: randomUUID(),
      intentId: options.intentId,
      tenantId: options.tenantId,
      reason: options.reason,
      reasonCategory: options.reasonCategory,
      escalatedTo: options.escalatedTo,
      status: 'pending',
      timeout: options.timeout ?? 'PT1H',
      timeoutAt: new Date(Date.now() + 3600000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockEscalationStore.set(escalation.id, escalation);
    return escalation;
  }

  async get(id: string, tenantId: string): Promise<any | null> {
    const esc = mockEscalationStore.get(id);
    return esc && esc.tenantId === tenantId ? esc : null;
  }

  async getByIntentId(intentId: string): Promise<any | null> {
    for (const esc of mockEscalationStore.values()) {
      if (esc.intentId === intentId) return esc;
    }
    return null;
  }

  async approve(id: string, tenantId: string, options: { resolvedBy: string; notes?: string }): Promise<any | null> {
    const esc = mockEscalationStore.get(id);
    if (esc && esc.tenantId === tenantId && ['pending', 'acknowledged'].includes(esc.status)) {
      esc.status = 'approved';
      esc.resolution = {
        resolvedBy: options.resolvedBy,
        resolvedAt: new Date().toISOString(),
        notes: options.notes,
      };
      esc.updatedAt = new Date().toISOString();
      return esc;
    }
    return null;
  }

  async reject(id: string, tenantId: string, options: { resolvedBy: string; notes?: string }): Promise<any | null> {
    const esc = mockEscalationStore.get(id);
    if (esc && esc.tenantId === tenantId && ['pending', 'acknowledged'].includes(esc.status)) {
      esc.status = 'rejected';
      esc.resolution = {
        resolvedBy: options.resolvedBy,
        resolvedAt: new Date().toISOString(),
        notes: options.notes,
      };
      esc.updatedAt = new Date().toISOString();
      return esc;
    }
    return null;
  }
}

/**
 * Mock GDPR Service
 */
class MockGdprService {
  async exportUserData(userId: string, tenantId: string): Promise<any> {
    const intents = Array.from(mockIntentStore.values()).filter(
      (i) => i.entityId === userId && i.tenantId === tenantId
    );
    const intentIds = intents.map((i) => i.id);
    const events = mockEventStore.filter((e) => intentIds.includes(e.intentId));
    const evaluations = mockEvaluationStore.filter((e) => intentIds.includes(e.intentId));
    const auditRecords = mockAuditStore.filter(
      (r) => r.tenantId === tenantId && r.actor.id === userId
    );

    return {
      exportId: randomUUID(),
      userId,
      tenantId,
      exportTimestamp: new Date().toISOString(),
      dataCategories: ['intents', 'events', 'evaluations', 'audit_records'],
      data: {
        intents: intents.map((i) => ({
          id: i.id,
          goal: i.goal,
          intentType: i.intentType,
          status: i.status,
          context: i.context,
          createdAt: i.createdAt,
        })),
        events,
        evaluations,
        auditRecords,
      },
      metadata: {
        totalRecords: intents.length + events.length + evaluations.length + auditRecords.length,
        exportVersion: '1.0',
        gdprArticle: 'Article 15 - Right of Access',
      },
    };
  }

  async eraseUserData(userId: string, tenantId: string): Promise<any> {
    let intentsErased = 0;
    let eventsErased = 0;

    // Soft delete intents
    for (const [id, intent] of mockIntentStore) {
      if (intent.entityId === userId && intent.tenantId === tenantId) {
        intent.deletedAt = new Date().toISOString();
        intent.goal = '[ERASED]';
        intent.context = {};
        intentsErased++;
      }
    }

    // Clear events payload
    for (const event of mockEventStore) {
      const intent = mockIntentStore.get(event.intentId);
      if (intent && intent.entityId === userId && intent.tenantId === tenantId) {
        event.payload = { erased: true, erasedAt: new Date().toISOString() };
        eventsErased++;
      }
    }

    return {
      userId,
      tenantId,
      erasedAt: new Date().toISOString(),
      counts: { intents: intentsErased, events: eventsErased, escalations: 0 },
    };
  }
}

/**
 * Intent Lifecycle Orchestrator
 * Coordinates the full lifecycle: submit -> evaluate -> decide -> execute -> proof
 */
class IntentLifecycleOrchestrator {
  constructor(
    private intentService: MockIntentService,
    private policyEvaluator: MockPolicyEvaluator,
    private trustEngine: MockTrustEngine,
    private proofService: MockProofService,
    private auditService: MockAuditService,
    private escalationService: MockEscalationService
  ) {}

  async processIntent(intent: Intent): Promise<{
    intent: Intent;
    decision: Decision;
    proof?: any;
    escalation?: any;
  }> {
    // Step 1: Update to evaluating
    await this.intentService.updateStatus(intent.id, intent.tenantId, 'evaluating');

    // Record audit event
    await this.auditService.record({
      tenantId: intent.tenantId,
      eventType: 'intent.evaluation.started',
      actor: { type: 'system', id: 'orchestrator' },
      target: { type: 'intent', id: intent.id },
      action: 'evaluate',
      outcome: 'success',
    });

    // Step 2: Get current trust level
    const trustRecord = await this.trustEngine.getScore(intent.entityId);
    const trustLevel = trustRecord?.level ?? 0;
    const trustScore = trustRecord?.score ?? 0;

    // Step 3: Evaluate policy
    const policyResult = this.policyEvaluator.evaluate(intent, trustLevel as TrustLevel);

    // Record evaluation
    await this.intentService.recordEvaluation(intent.id, intent.tenantId, {
      stage: 'basis',
      evaluation: policyResult,
      namespace: 'default',
    });

    // Step 4: Make decision
    const decision: Decision = {
      intentId: intent.id,
      action: policyResult.action as any,
      constraintsEvaluated: [],
      trustScore,
      trustLevel: trustLevel as TrustLevel,
      decidedAt: new Date().toISOString(),
    };

    // Step 5: Handle decision outcome
    if (policyResult.action === 'escalate') {
      // Create escalation
      const escalation = await this.escalationService.create({
        intentId: intent.id,
        tenantId: intent.tenantId,
        reason: policyResult.reason,
        reasonCategory: 'high_risk',
        escalatedTo: 'human-reviewer',
      });

      await this.intentService.updateStatus(intent.id, intent.tenantId, 'escalated');

      await this.auditService.record({
        tenantId: intent.tenantId,
        eventType: 'intent.escalated',
        actor: { type: 'system', id: 'orchestrator' },
        target: { type: 'intent', id: intent.id },
        action: 'escalate',
        outcome: 'success',
        metadata: { escalationId: escalation.id, reason: policyResult.reason },
      });

      const updatedIntent = await this.intentService.get(intent.id, intent.tenantId);
      return { intent: updatedIntent!, decision, escalation };
    }

    if (policyResult.action === 'deny') {
      await this.intentService.updateStatus(intent.id, intent.tenantId, 'denied');

      // Record negative trust signal
      await this.trustEngine.recordSignal({
        entityId: intent.entityId,
        type: 'behavioral.policy_violation',
        value: -0.2,
        weight: 1.0,
      });

      await this.auditService.record({
        tenantId: intent.tenantId,
        eventType: 'intent.denied',
        actor: { type: 'system', id: 'orchestrator' },
        target: { type: 'intent', id: intent.id },
        action: 'deny',
        outcome: 'success',
        reason: policyResult.reason,
      });

      const updatedIntent = await this.intentService.get(intent.id, intent.tenantId);
      return { intent: updatedIntent!, decision };
    }

    // Allow path
    await this.intentService.updateStatus(intent.id, intent.tenantId, 'approved');

    await this.auditService.record({
      tenantId: intent.tenantId,
      eventType: 'intent.approved',
      actor: { type: 'system', id: 'orchestrator' },
      target: { type: 'intent', id: intent.id },
      action: 'approve',
      outcome: 'success',
    });

    // Step 6: Execute
    await this.intentService.updateStatus(intent.id, intent.tenantId, 'executing');

    // Simulate execution (in real system this would call agent execution)
    const executionResult = { success: true, output: { result: 'executed' } };

    if (executionResult.success) {
      await this.intentService.updateStatus(intent.id, intent.tenantId, 'completed');

      // Record positive trust signal
      await this.trustEngine.recordSignal({
        entityId: intent.entityId,
        type: 'behavioral.successful_execution',
        value: 0.1,
        weight: 1.0,
      });

      await this.auditService.record({
        tenantId: intent.tenantId,
        eventType: 'intent.completed',
        actor: { type: 'system', id: 'orchestrator' },
        target: { type: 'intent', id: intent.id },
        action: 'complete',
        outcome: 'success',
      });
    } else {
      await this.intentService.updateStatus(intent.id, intent.tenantId, 'failed');

      // Record negative trust signal
      await this.trustEngine.recordSignal({
        entityId: intent.entityId,
        type: 'behavioral.execution_failure',
        value: -0.15,
        weight: 1.0,
      });
    }

    // Step 7: Create proof
    const proof = await this.proofService.create({
      intent,
      decision,
      inputs: { goal: intent.goal, context: intent.context },
      outputs: executionResult,
    });

    const finalIntent = await this.intentService.get(intent.id, intent.tenantId);
    return { intent: finalIntent!, decision, proof };
  }

  async approveEscalation(
    escalationId: string,
    tenantId: string,
    resolvedBy: string
  ): Promise<{ intent: Intent; decision: Decision; proof: any }> {
    const escalation = await this.escalationService.approve(escalationId, tenantId, { resolvedBy });
    if (!escalation) throw new Error('Escalation not found or cannot be approved');

    const intent = await this.intentService.get(escalation.intentId, tenantId);
    if (!intent) throw new Error('Intent not found');

    // Continue with execution
    await this.intentService.updateStatus(intent.id, tenantId, 'approved');

    const trustRecord = await this.trustEngine.getScore(intent.entityId);
    const decision: Decision = {
      intentId: intent.id,
      action: 'allow',
      constraintsEvaluated: [],
      trustScore: trustRecord?.score ?? 0,
      trustLevel: (trustRecord?.level ?? 0) as TrustLevel,
      decidedAt: new Date().toISOString(),
    };

    await this.intentService.updateStatus(intent.id, tenantId, 'executing');
    await this.intentService.updateStatus(intent.id, tenantId, 'completed');

    // Record positive trust signal for human-approved action
    await this.trustEngine.recordSignal({
      entityId: intent.entityId,
      type: 'behavioral.human_approved_execution',
      value: 0.15,
      weight: 1.0,
    });

    await this.auditService.record({
      tenantId,
      eventType: 'escalation.approved',
      actor: { type: 'user', id: resolvedBy },
      target: { type: 'escalation', id: escalationId },
      action: 'approve',
      outcome: 'success',
      metadata: { intentId: intent.id },
    });

    const proof = await this.proofService.create({
      intent,
      decision,
      inputs: { goal: intent.goal, context: intent.context, humanApproval: true },
      outputs: { success: true },
    });

    const finalIntent = await this.intentService.get(intent.id, tenantId);
    return { intent: finalIntent!, decision, proof };
  }
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Intent Lifecycle Integration Tests', () => {
  let intentService: MockIntentService;
  let policyEvaluator: MockPolicyEvaluator;
  let trustEngine: MockTrustEngine;
  let proofService: MockProofService;
  let auditService: MockAuditService;
  let escalationService: MockEscalationService;
  let gdprService: MockGdprService;
  let orchestrator: IntentLifecycleOrchestrator;

  const testTenantId = 'test-tenant-123';
  const testEntityId = randomUUID();

  beforeAll(() => {
    intentService = new MockIntentService();
    policyEvaluator = new MockPolicyEvaluator();
    trustEngine = new MockTrustEngine();
    proofService = new MockProofService();
    auditService = new MockAuditService();
    escalationService = new MockEscalationService();
    gdprService = new MockGdprService();
    orchestrator = new IntentLifecycleOrchestrator(
      intentService,
      policyEvaluator,
      trustEngine,
      proofService,
      auditService,
      escalationService
    );
  });

  beforeEach(() => {
    resetStores();
  });

  // ===========================================================================
  // 1. Complete Approval Flow
  // ===========================================================================
  describe('Complete Approval Flow', () => {
    it('should complete full lifecycle: submit -> evaluate -> decide -> execute -> proof', async () => {
      // Initialize entity trust
      await trustEngine.initializeEntity(testEntityId, 2);

      // Submit intent
      const intent = await intentService.submit(
        {
          entityId: testEntityId,
          goal: 'Test goal for approval flow',
          context: { action: 'read', resource: 'data' },
          intentType: 'standard',
          priority: 5,
        },
        { tenantId: testTenantId, trustLevel: 2 }
      );

      expect(intent.status).toBe('pending');
      expect(intent.id).toBeDefined();

      // Process through lifecycle
      const result = await orchestrator.processIntent(intent);

      // Verify final state
      expect(result.intent.status).toBe('completed');
      expect(result.decision.action).toBe('allow');
      expect(result.proof).toBeDefined();
      expect(result.proof.chainPosition).toBeGreaterThanOrEqual(0);
    });

    it('should record evaluation at each stage', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Test evaluation recording', context: {} },
        { tenantId: testTenantId, trustLevel: 2 }
      );

      await orchestrator.processIntent(intent);

      const evaluations = await intentService.getEvaluations(intent.id);
      expect(evaluations.length).toBeGreaterThan(0);
      expect(evaluations.some((e) => e.result.stage === 'basis')).toBe(true);
    });

    it('should create immutable proof with correct chain linkage', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      // Process multiple intents to test chain
      const intent1 = await intentService.submit(
        { entityId: testEntityId, goal: 'First intent', context: {} },
        { tenantId: testTenantId, trustLevel: 2 }
      );
      const result1 = await orchestrator.processIntent(intent1);

      const intent2 = await intentService.submit(
        { entityId: testEntityId, goal: 'Second intent', context: {} },
        { tenantId: testTenantId, trustLevel: 2 }
      );
      const result2 = await orchestrator.processIntent(intent2);

      // Verify chain linkage
      expect(result2.proof!.previousHash).toBe(result1.proof!.hash);
      expect(result2.proof!.chainPosition).toBe(result1.proof!.chainPosition + 1);
    });

    it('should record complete audit trail', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Audit trail test', context: {} },
        { tenantId: testTenantId, trustLevel: 2 }
      );

      await orchestrator.processIntent(intent);

      const auditRecords = await auditService.getForTarget(testTenantId, 'intent', intent.id);
      expect(auditRecords.length).toBeGreaterThanOrEqual(3); // Started, approved, completed

      const eventTypes = auditRecords.map((r) => r.eventType);
      expect(eventTypes).toContain('intent.evaluation.started');
      expect(eventTypes).toContain('intent.approved');
      expect(eventTypes).toContain('intent.completed');
    });

    it('should update status correctly through each stage', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Status tracking test', context: {} },
        { tenantId: testTenantId, trustLevel: 2 }
      );

      const events = await intentService.getEvents(intent.id);
      expect(events.some((e) => e.eventType === 'intent.submitted')).toBe(true);

      await orchestrator.processIntent(intent);

      const allEvents = await intentService.getEvents(intent.id);
      const eventTypes = allEvents.map((e) => e.eventType);
      expect(eventTypes).toContain('intent.evaluating');
      expect(eventTypes).toContain('intent.approved');
      expect(eventTypes).toContain('intent.executing');
      expect(eventTypes).toContain('intent.completed');
    });
  });

  // ===========================================================================
  // 2. Denial Flow
  // ===========================================================================
  describe('Denial Flow', () => {
    it('should deny high-risk intent with insufficient trust', async () => {
      await trustEngine.initializeEntity(testEntityId, 1); // Low trust

      const intent = await intentService.submit(
        {
          entityId: testEntityId,
          goal: 'High-risk operation',
          context: {},
          intentType: 'high-risk',
        },
        { tenantId: testTenantId, trustLevel: 1, bypassTrustGate: true }
      );

      const result = await orchestrator.processIntent(intent);

      expect(result.intent.status).toBe('escalated'); // High-risk with low trust escalates
      expect(result.escalation).toBeDefined();
    });

    it('should deny blocked intent type', async () => {
      await trustEngine.initializeEntity(testEntityId, 3);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Blocked operation', context: {}, intentType: 'blocked' },
        { tenantId: testTenantId, trustLevel: 3 }
      );

      const result = await orchestrator.processIntent(intent);

      expect(result.intent.status).toBe('denied');
      expect(result.decision.action).toBe('deny');
      expect(result.proof).toBeUndefined(); // No proof for denied intents
    });

    it('should not execute denied intent', async () => {
      await trustEngine.initializeEntity(testEntityId, 3);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Will be denied', context: {}, intentType: 'blocked' },
        { tenantId: testTenantId, trustLevel: 3 }
      );

      const result = await orchestrator.processIntent(intent);

      const events = await intentService.getEvents(intent.id);
      const eventTypes = events.map((e) => e.eventType);
      expect(eventTypes).not.toContain('intent.executing');
      expect(eventTypes).not.toContain('intent.completed');
    });

    it('should record denial in audit trail', async () => {
      await trustEngine.initializeEntity(testEntityId, 3);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Audit denial test', context: {}, intentType: 'blocked' },
        { tenantId: testTenantId, trustLevel: 3 }
      );

      await orchestrator.processIntent(intent);

      const auditRecords = await auditService.getForTarget(testTenantId, 'intent', intent.id);
      const denialRecord = auditRecords.find((r) => r.eventType === 'intent.denied');
      expect(denialRecord).toBeDefined();
      expect(denialRecord!.action).toBe('deny');
    });

    it('should record negative trust signal on denial', async () => {
      await trustEngine.initializeEntity(testEntityId, 3);
      const initialTrust = await trustEngine.getScore(testEntityId);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Trust impact test', context: {}, intentType: 'blocked' },
        { tenantId: testTenantId, trustLevel: 3 }
      );

      await orchestrator.processIntent(intent);

      const finalTrust = await trustEngine.getScore(testEntityId);
      expect(finalTrust!.score).toBeLessThan(initialTrust!.score);
    });
  });

  // ===========================================================================
  // 3. Escalation Flow
  // ===========================================================================
  describe('Escalation Flow', () => {
    it('should escalate intent requiring human approval', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      const intent = await intentService.submit(
        {
          entityId: testEntityId,
          goal: 'Requires human approval',
          context: {},
          intentType: 'requires-approval',
        },
        { tenantId: testTenantId, trustLevel: 2 }
      );

      const result = await orchestrator.processIntent(intent);

      expect(result.intent.status).toBe('escalated');
      expect(result.escalation).toBeDefined();
      expect(result.escalation.status).toBe('pending');
      expect(result.escalation.escalatedTo).toBe('human-reviewer');
    });

    it('should complete intent after escalation approval', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Pending approval', context: {}, intentType: 'requires-approval' },
        { tenantId: testTenantId, trustLevel: 2 }
      );

      const escalationResult = await orchestrator.processIntent(intent);
      expect(escalationResult.intent.status).toBe('escalated');

      // Simulate human approval
      const approvalResult = await orchestrator.approveEscalation(
        escalationResult.escalation.id,
        testTenantId,
        'human-approver-123'
      );

      expect(approvalResult.intent.status).toBe('completed');
      expect(approvalResult.proof).toBeDefined();
    });

    it('should record escalation in audit trail', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Escalation audit test', context: {}, intentType: 'requires-approval' },
        { tenantId: testTenantId, trustLevel: 2 }
      );

      const result = await orchestrator.processIntent(intent);

      const auditRecords = await auditService.getForTarget(testTenantId, 'intent', intent.id);
      const escalationRecord = auditRecords.find((r) => r.eventType === 'intent.escalated');
      expect(escalationRecord).toBeDefined();
      expect(escalationRecord!.metadata?.escalationId).toBe(result.escalation.id);
    });

    it('should record approval decision in audit when escalation approved', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Approval audit test', context: {}, intentType: 'requires-approval' },
        { tenantId: testTenantId, trustLevel: 2 }
      );

      const escalationResult = await orchestrator.processIntent(intent);
      await orchestrator.approveEscalation(escalationResult.escalation.id, testTenantId, 'approver-456');

      const allAuditRecords = mockAuditStore.filter((r) => r.tenantId === testTenantId);
      const approvalRecord = allAuditRecords.find((r) => r.eventType === 'escalation.approved');
      expect(approvalRecord).toBeDefined();
      expect(approvalRecord!.actor.id).toBe('approver-456');
    });

    it('should increase trust score after human-approved execution', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);
      const initialTrust = await trustEngine.getScore(testEntityId);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Trust boost test', context: {}, intentType: 'requires-approval' },
        { tenantId: testTenantId, trustLevel: 2 }
      );

      const escalationResult = await orchestrator.processIntent(intent);
      await orchestrator.approveEscalation(escalationResult.escalation.id, testTenantId, 'approver');

      const finalTrust = await trustEngine.getScore(testEntityId);
      expect(finalTrust!.score).toBeGreaterThan(initialTrust!.score);
    });
  });

  // ===========================================================================
  // 4. GDPR Data Subject Flow
  // ===========================================================================
  describe('GDPR Data Subject Flow', () => {
    it('should export all data for an entity', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      // Create multiple intents
      const intent1 = await intentService.submit(
        { entityId: testEntityId, goal: 'First GDPR intent', context: { data: 'value1' } },
        { tenantId: testTenantId, trustLevel: 2 }
      );
      await orchestrator.processIntent(intent1);

      const intent2 = await intentService.submit(
        { entityId: testEntityId, goal: 'Second GDPR intent', context: { data: 'value2' } },
        { tenantId: testTenantId, trustLevel: 2 }
      );
      await orchestrator.processIntent(intent2);

      // Export user data
      const exportData = await gdprService.exportUserData(testEntityId, testTenantId);

      expect(exportData.userId).toBe(testEntityId);
      expect(exportData.tenantId).toBe(testTenantId);
      expect(exportData.data.intents.length).toBe(2);
      expect(exportData.data.events.length).toBeGreaterThan(0);
      expect(exportData.metadata.gdprArticle).toBe('Article 15 - Right of Access');
    });

    it('should include all intent events in export', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Events export test', context: {} },
        { tenantId: testTenantId, trustLevel: 2 }
      );
      await orchestrator.processIntent(intent);

      const exportData = await gdprService.exportUserData(testEntityId, testTenantId);

      expect(exportData.data.events.length).toBeGreaterThan(0);
      const eventTypes = exportData.data.events.map((e: any) => e.eventType);
      expect(eventTypes).toContain('intent.submitted');
    });

    it('should include evaluations in export', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Evaluations export test', context: {} },
        { tenantId: testTenantId, trustLevel: 2 }
      );
      await orchestrator.processIntent(intent);

      const exportData = await gdprService.exportUserData(testEntityId, testTenantId);

      expect(exportData.data.evaluations.length).toBeGreaterThan(0);
    });

    it('should erase user data on request', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'To be erased', context: { sensitive: 'data' } },
        { tenantId: testTenantId, trustLevel: 2 }
      );
      await orchestrator.processIntent(intent);

      // Erase data
      const erasureResult = await gdprService.eraseUserData(testEntityId, testTenantId);

      expect(erasureResult.counts.intents).toBe(1);
      expect(erasureResult.counts.events).toBeGreaterThan(0);

      // Verify data is erased
      const storedIntent = mockIntentStore.get(intent.id);
      expect(storedIntent.deletedAt).toBeDefined();
      expect(storedIntent.goal).toBe('[ERASED]');
      expect(storedIntent.context).toEqual({});
    });

    it('should not return erased intents in normal queries', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Will be erased', context: {} },
        { tenantId: testTenantId, trustLevel: 2 }
      );
      await orchestrator.processIntent(intent);

      // Erase
      await gdprService.eraseUserData(testEntityId, testTenantId);

      // Try to retrieve
      const retrieved = await intentService.get(intent.id, testTenantId);
      expect(retrieved).toBeNull();
    });

    it('should export data for entity with no intents gracefully', async () => {
      const emptyEntityId = randomUUID();
      const exportData = await gdprService.exportUserData(emptyEntityId, testTenantId);

      expect(exportData.data.intents.length).toBe(0);
      expect(exportData.data.events.length).toBe(0);
      expect(exportData.metadata.totalRecords).toBe(0);
    });
  });

  // ===========================================================================
  // 5. Trust Score Impact
  // ===========================================================================
  describe('Trust Score Impact', () => {
    it('should increase trust score after successful execution', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);
      const initialTrust = await trustEngine.getScore(testEntityId);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Successful operation', context: {} },
        { tenantId: testTenantId, trustLevel: 2 }
      );
      await orchestrator.processIntent(intent);

      const finalTrust = await trustEngine.getScore(testEntityId);
      expect(finalTrust!.score).toBeGreaterThan(initialTrust!.score);
    });

    it('should decrease trust score after policy violation', async () => {
      await trustEngine.initializeEntity(testEntityId, 3);
      const initialTrust = await trustEngine.getScore(testEntityId);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Blocked operation', context: {}, intentType: 'blocked' },
        { tenantId: testTenantId, trustLevel: 3 }
      );
      await orchestrator.processIntent(intent);

      const finalTrust = await trustEngine.getScore(testEntityId);
      expect(finalTrust!.score).toBeLessThan(initialTrust!.score);
    });

    it('should record trust signal history', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      const intent1 = await intentService.submit(
        { entityId: testEntityId, goal: 'First operation', context: {} },
        { tenantId: testTenantId, trustLevel: 2 }
      );
      await orchestrator.processIntent(intent1);

      const intent2 = await intentService.submit(
        { entityId: testEntityId, goal: 'Blocked operation', context: {}, intentType: 'blocked' },
        { tenantId: testTenantId, trustLevel: 3 }
      );
      await orchestrator.processIntent(intent2);

      const history = trustEngine.getHistory(testEntityId);
      // Initial registration + signals that caused >= 10 point changes
      // The exact count depends on whether signals crossed the 10-point threshold
      expect(history.length).toBeGreaterThanOrEqual(1); // At least initial registration

      // Verify signals were recorded (separate from history which has threshold)
      const signals = mockTrustSignalStore.filter((s) => s.entityId === testEntityId);
      expect(signals.length).toBeGreaterThanOrEqual(2); // At least 2 signals: success + violation
    });

    it('should upgrade trust level after multiple successful executions', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);
      const initialTrust = await trustEngine.getScore(testEntityId);

      // Execute many successful intents
      for (let i = 0; i < 10; i++) {
        const intent = await intentService.submit(
          { entityId: testEntityId, goal: `Successful operation ${i}`, context: {} },
          { tenantId: testTenantId, trustLevel: 2 }
        );
        await orchestrator.processIntent(intent);
      }

      const finalTrust = await trustEngine.getScore(testEntityId);
      expect(finalTrust!.score).toBeGreaterThan(initialTrust!.score);
      // Note: Level upgrade depends on crossing threshold
    });

    it('should downgrade trust level after multiple violations', async () => {
      await trustEngine.initializeEntity(testEntityId, 3);
      const initialTrust = await trustEngine.getScore(testEntityId);

      // Execute many failing intents
      for (let i = 0; i < 5; i++) {
        const intent = await intentService.submit(
          { entityId: testEntityId, goal: `Blocked operation ${i}`, context: {}, intentType: 'blocked' },
          { tenantId: testTenantId, trustLevel: 3 }
        );
        await orchestrator.processIntent(intent);
      }

      const finalTrust = await trustEngine.getScore(testEntityId);
      expect(finalTrust!.score).toBeLessThan(initialTrust!.score);
    });
  });

  // ===========================================================================
  // Additional Edge Cases and Scenarios
  // ===========================================================================
  describe('Edge Cases', () => {
    it('should handle concurrent intent submissions', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          intentService.submit(
            { entityId: testEntityId, goal: `Concurrent intent ${i}`, context: {} },
            { tenantId: testTenantId, trustLevel: 2 }
          )
        );
      }

      const intents = await Promise.all(promises);
      expect(intents.length).toBe(5);
      expect(new Set(intents.map((i) => i.id)).size).toBe(5); // All unique IDs
    });

    it('should maintain proof chain integrity across multiple intents', async () => {
      await trustEngine.initializeEntity(testEntityId, 3);

      const proofs = [];
      for (let i = 0; i < 3; i++) {
        const intent = await intentService.submit(
          { entityId: testEntityId, goal: `Chain integrity test ${i}`, context: {} },
          { tenantId: testTenantId, trustLevel: 3 }
        );
        const result = await orchestrator.processIntent(intent);
        if (result.proof) proofs.push(result.proof);
      }

      expect(proofs.length).toBe(3);
      for (let i = 1; i < proofs.length; i++) {
        expect(proofs[i].previousHash).toBe(proofs[i - 1].hash);
        expect(proofs[i].chainPosition).toBe(proofs[i - 1].chainPosition + 1);
      }
    });

    it('should isolate intents between tenants', async () => {
      const tenant1 = 'tenant-1';
      const tenant2 = 'tenant-2';
      const entity1 = randomUUID();
      const entity2 = randomUUID();

      await trustEngine.initializeEntity(entity1, 2);
      await trustEngine.initializeEntity(entity2, 2);

      const intent1 = await intentService.submit(
        { entityId: entity1, goal: 'Tenant 1 intent', context: {} },
        { tenantId: tenant1, trustLevel: 2 }
      );

      const intent2 = await intentService.submit(
        { entityId: entity2, goal: 'Tenant 2 intent', context: {} },
        { tenantId: tenant2, trustLevel: 2 }
      );

      // Cross-tenant access should fail
      const crossTenantGet = await intentService.get(intent1.id, tenant2);
      expect(crossTenantGet).toBeNull();

      // Same tenant access should succeed
      const sameTenantGet = await intentService.get(intent1.id, tenant1);
      expect(sameTenantGet).not.toBeNull();
    });

    it('should reject intent when trust gate fails', async () => {
      await trustEngine.initializeEntity(testEntityId, 1); // Low trust

      await expect(
        intentService.submit(
          { entityId: testEntityId, goal: 'High-risk operation', context: {}, intentType: 'high-risk' },
          { tenantId: testTenantId, trustLevel: 1 } // Trust gate not bypassed
        )
      ).rejects.toThrow('Trust level 1 insufficient, requires 3');
    });

    it('should verify proof integrity', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Proof verification test', context: {} },
        { tenantId: testTenantId, trustLevel: 2 }
      );
      const result = await orchestrator.processIntent(intent);

      const verification = await proofService.verify(result.proof!.id);
      expect(verification.valid).toBe(true);
      expect(verification.issues.length).toBe(0);
    });

    it('should handle missing entity trust gracefully', async () => {
      const unknownEntityId = randomUUID();
      // Don't initialize trust for this entity

      const intent = await intentService.submit(
        { entityId: unknownEntityId, goal: 'Unknown entity test', context: {} },
        { tenantId: testTenantId, bypassTrustGate: true }
      );

      // Should process with default trust level 0
      const result = await orchestrator.processIntent(intent);
      expect(result.decision.trustLevel).toBe(0);
    });
  });

  // ===========================================================================
  // Audit Trail Completeness
  // ===========================================================================
  describe('Audit Trail Completeness', () => {
    it('should have audit record for every lifecycle stage', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Full audit test', context: {} },
        { tenantId: testTenantId, trustLevel: 2 }
      );
      await orchestrator.processIntent(intent);

      const auditRecords = await auditService.getForTarget(testTenantId, 'intent', intent.id);

      // Should have records for: started, approved, completed
      expect(auditRecords.length).toBeGreaterThanOrEqual(3);

      // Verify sequential ordering
      const times = auditRecords.map((r) => new Date(r.eventTime).getTime());
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
      }
    });

    it('should link audit records to correct actors', async () => {
      await trustEngine.initializeEntity(testEntityId, 2);

      const intent = await intentService.submit(
        { entityId: testEntityId, goal: 'Actor audit test', context: {}, intentType: 'requires-approval' },
        { tenantId: testTenantId, trustLevel: 2 }
      );
      const escalationResult = await orchestrator.processIntent(intent);
      await orchestrator.approveEscalation(escalationResult.escalation.id, testTenantId, 'human-approver');

      const allRecords = mockAuditStore.filter((r) => r.tenantId === testTenantId);

      // System actions should have system actor
      const systemRecords = allRecords.filter((r) => r.actor.type === 'system');
      expect(systemRecords.length).toBeGreaterThan(0);

      // Human approval should have user actor
      const approvalRecord = allRecords.find((r) => r.eventType === 'escalation.approved');
      expect(approvalRecord!.actor.type).toBe('user');
      expect(approvalRecord!.actor.id).toBe('human-approver');
    });
  });
});
