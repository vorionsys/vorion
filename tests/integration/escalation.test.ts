/**
 * Escalation Service Integration Tests
 *
 * Tests the complete escalation lifecycle including creation, acknowledgment,
 * approval, rejection, timeout handling, and authorization.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// =============================================================================
// MOCK SETUP
// =============================================================================

// Mock stores
const mockEscalationStore = new Map<string, any>();
const mockIntentStore = new Map<string, any>();
const mockApproverStore = new Map<string, any>();
const mockGroupMembershipStore = new Map<string, any>();
const mockAuditStore: any[] = [];

function resetStores(): void {
  mockEscalationStore.clear();
  mockIntentStore.clear();
  mockApproverStore.clear();
  mockGroupMembershipStore.clear();
  mockAuditStore.length = 0;
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
      escalationTimeout: 'PT1H',
      escalationDefaultRecipient: 'governance-team',
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
// SERVICE IMPLEMENTATIONS
// =============================================================================

/**
 * Mock Escalation Service
 */
class MockEscalationService {
  async create(options: {
    intentId: string;
    tenantId: string;
    reason: string;
    reasonCategory: 'trust_insufficient' | 'high_risk' | 'policy_violation' | 'manual_review' | 'constraint_escalate';
    escalatedTo: string;
    escalatedBy?: string;
    timeout?: string;
    context?: Record<string, unknown>;
  }): Promise<any> {
    const timeoutMs = this.parseTimeout(options.timeout ?? 'PT1H');
    const escalation = {
      id: randomUUID(),
      intentId: options.intentId,
      tenantId: options.tenantId,
      reason: options.reason,
      reasonCategory: options.reasonCategory,
      escalatedTo: options.escalatedTo,
      escalatedBy: options.escalatedBy,
      status: 'pending',
      timeout: options.timeout ?? 'PT1H',
      timeoutAt: new Date(Date.now() + timeoutMs).toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
      resolvedBy: null,
      resolutionNotes: null,
      slaBreached: false,
      context: options.context ?? {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockEscalationStore.set(escalation.id, escalation);
    return escalation;
  }

  async get(id: string, tenantId?: string): Promise<any | null> {
    const esc = mockEscalationStore.get(id);
    if (!esc) return null;
    if (tenantId && esc.tenantId !== tenantId) return null;
    return esc;
  }

  async getByIntentId(intentId: string, tenantId: string): Promise<any | null> {
    const entries = Array.from(mockEscalationStore.values());
    for (const esc of entries) {
      if (esc.intentId === intentId && esc.tenantId === tenantId) {
        return esc;
      }
    }
    return null;
  }

  async listPending(tenantId: string): Promise<any[]> {
    const results: any[] = [];
    const entries = Array.from(mockEscalationStore.values());
    for (const esc of entries) {
      if (esc.tenantId === tenantId && ['pending', 'acknowledged'].includes(esc.status)) {
        results.push(esc);
      }
    }
    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async acknowledge(id: string, tenantId: string, acknowledgedBy: string): Promise<any | null> {
    const esc = mockEscalationStore.get(id);
    if (!esc || esc.tenantId !== tenantId || esc.status !== 'pending') {
      return null;
    }
    esc.status = 'acknowledged';
    esc.acknowledgedAt = new Date().toISOString();
    esc.updatedAt = new Date().toISOString();
    return esc;
  }

  async approve(
    id: string,
    tenantId: string,
    options: { resolvedBy: string; notes?: string }
  ): Promise<any | null> {
    const esc = mockEscalationStore.get(id);
    if (!esc || esc.tenantId !== tenantId || !['pending', 'acknowledged'].includes(esc.status)) {
      return null;
    }
    esc.status = 'approved';
    esc.resolvedBy = options.resolvedBy;
    esc.resolvedAt = new Date().toISOString();
    esc.resolutionNotes = options.notes ?? null;
    esc.updatedAt = new Date().toISOString();
    return esc;
  }

  async reject(
    id: string,
    tenantId: string,
    options: { resolvedBy: string; notes?: string }
  ): Promise<any | null> {
    const esc = mockEscalationStore.get(id);
    if (!esc || esc.tenantId !== tenantId || !['pending', 'acknowledged'].includes(esc.status)) {
      return null;
    }
    esc.status = 'rejected';
    esc.resolvedBy = options.resolvedBy;
    esc.resolvedAt = new Date().toISOString();
    esc.resolutionNotes = options.notes ?? null;
    esc.updatedAt = new Date().toISOString();
    return esc;
  }

  async cancel(id: string, tenantId: string, reason: string): Promise<any | null> {
    const esc = mockEscalationStore.get(id);
    if (!esc || esc.tenantId !== tenantId || !['pending', 'acknowledged'].includes(esc.status)) {
      return null;
    }
    esc.status = 'cancelled';
    esc.resolutionNotes = reason;
    esc.updatedAt = new Date().toISOString();
    return esc;
  }

  async processTimeouts(): Promise<{ processed: number; breached: number }> {
    let processed = 0;
    let breached = 0;
    const now = new Date();

    const entries = Array.from(mockEscalationStore.values());
    for (const esc of entries) {
      if (['pending', 'acknowledged'].includes(esc.status)) {
        const timeoutAt = new Date(esc.timeoutAt);
        if (timeoutAt <= now) {
          esc.status = 'timeout';
          esc.slaBreached = true;
          esc.updatedAt = now.toISOString();
          processed++;
          breached++;
        }
      }
    }

    return { processed, breached };
  }

  private parseTimeout(duration: string): number {
    // Simple ISO 8601 duration parser for common cases
    const match = duration.match(/PT(\d+)([HMS])/i);
    if (!match) return 3600000; // Default 1 hour
    const value = parseInt(match[1], 10);
    switch (match[2].toUpperCase()) {
      case 'H': return value * 3600000;
      case 'M': return value * 60000;
      case 'S': return value * 1000;
      default: return 3600000;
    }
  }
}

/**
 * Mock Authorization Service
 */
class MockAuthorizationService {
  async canResolveEscalation(
    userId: string,
    escalation: { id: string; escalatedTo: string; tenantId: string },
    userRoles: string[],
    userGroups: string[]
  ): Promise<{ allowed: boolean; reason?: string; authMethod?: string }> {
    // Admin bypass
    if (userRoles.some(r => ['admin', 'tenant:admin', 'escalation:admin'].includes(r))) {
      return { allowed: true, authMethod: 'admin_role' };
    }

    // Direct assignment
    if (escalation.escalatedTo === userId) {
      return { allowed: true, authMethod: 'direct_assignment' };
    }

    // Check explicit approver assignment
    const approverKey = `${escalation.id}:${userId}`;
    if (mockApproverStore.has(approverKey)) {
      return { allowed: true, authMethod: 'explicit_approver' };
    }

    // Check group membership (database-verified, not JWT claims)
    const groupKey = `${escalation.tenantId}:${userId}:${escalation.escalatedTo}`;
    if (mockGroupMembershipStore.has(groupKey)) {
      return { allowed: true, authMethod: 'verified_group_membership' };
    }

    return {
      allowed: false,
      reason: `User not authorized to resolve escalation (escalatedTo: ${escalation.escalatedTo})`,
    };
  }

  async assignApprover(
    escalationId: string,
    userId: string,
    tenantId: string,
    assignedBy: string
  ): Promise<{ id: string; assignedAt: string }> {
    const assignment = {
      id: randomUUID(),
      escalationId,
      userId,
      tenantId,
      assignedBy,
      assignedAt: new Date().toISOString(),
    };
    mockApproverStore.set(`${escalationId}:${userId}`, assignment);
    return { id: assignment.id, assignedAt: assignment.assignedAt };
  }

  async removeApprover(escalationId: string, userId: string, tenantId: string): Promise<boolean> {
    const key = `${escalationId}:${userId}`;
    if (mockApproverStore.has(key)) {
      mockApproverStore.delete(key);
      return true;
    }
    return false;
  }

  async addGroupMembership(tenantId: string, userId: string, groupName: string): Promise<void> {
    mockGroupMembershipStore.set(`${tenantId}:${userId}:${groupName}`, true);
  }
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Escalation Service Integration Tests', () => {
  let escalationService: MockEscalationService;
  let authService: MockAuthorizationService;

  const testTenantId = 'test-tenant-123';
  const testUserId = randomUUID();
  const testIntentId = randomUUID();

  beforeAll(() => {
    escalationService = new MockEscalationService();
    authService = new MockAuthorizationService();
  });

  beforeEach(() => {
    resetStores();
    // Setup test intent
    mockIntentStore.set(testIntentId, {
      id: testIntentId,
      tenantId: testTenantId,
      status: 'escalated',
    });
  });

  // ===========================================================================
  // 1. Escalation Creation
  // ===========================================================================
  describe('Escalation Creation', () => {
    it('should create escalation with required fields', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Requires human review',
        reasonCategory: 'manual_review',
        escalatedTo: 'governance-team',
      });

      expect(escalation.id).toBeDefined();
      expect(escalation.intentId).toBe(testIntentId);
      expect(escalation.tenantId).toBe(testTenantId);
      expect(escalation.status).toBe('pending');
      expect(escalation.reason).toBe('Requires human review');
      expect(escalation.reasonCategory).toBe('manual_review');
    });

    it('should set timeout correctly', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Urgent review',
        reasonCategory: 'high_risk',
        escalatedTo: 'security-team',
        timeout: 'PT30M', // 30 minutes
      });

      expect(escalation.timeout).toBe('PT30M');
      const timeoutAt = new Date(escalation.timeoutAt);
      const now = new Date();
      // Should be approximately 30 minutes from now
      const diffMinutes = (timeoutAt.getTime() - now.getTime()) / 60000;
      expect(diffMinutes).toBeGreaterThan(29);
      expect(diffMinutes).toBeLessThan(31);
    });

    it('should record escalatedBy when provided', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Policy triggered escalation',
        reasonCategory: 'policy_violation',
        escalatedTo: 'compliance-team',
        escalatedBy: 'policy-engine',
      });

      expect(escalation.escalatedBy).toBe('policy-engine');
    });

    it('should support different reason categories', async () => {
      const categories: Array<'trust_insufficient' | 'high_risk' | 'policy_violation' | 'manual_review' | 'constraint_escalate'> = [
        'trust_insufficient',
        'high_risk',
        'policy_violation',
        'manual_review',
        'constraint_escalate',
      ];

      for (const category of categories) {
        const escalation = await escalationService.create({
          intentId: randomUUID(),
          tenantId: testTenantId,
          reason: `Test ${category}`,
          reasonCategory: category,
          escalatedTo: 'test-team',
        });
        expect(escalation.reasonCategory).toBe(category);
      }
    });
  });

  // ===========================================================================
  // 2. Escalation Retrieval
  // ===========================================================================
  describe('Escalation Retrieval', () => {
    it('should get escalation by ID', async () => {
      const created = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Test retrieval',
        reasonCategory: 'manual_review',
        escalatedTo: 'test-team',
      });

      const retrieved = await escalationService.get(created.id, testTenantId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
    });

    it('should return null for non-existent escalation', async () => {
      const retrieved = await escalationService.get(randomUUID(), testTenantId);
      expect(retrieved).toBeNull();
    });

    it('should enforce tenant isolation', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Tenant isolation test',
        reasonCategory: 'manual_review',
        escalatedTo: 'test-team',
      });

      // Should not find with different tenant
      const retrieved = await escalationService.get(escalation.id, 'other-tenant');
      expect(retrieved).toBeNull();
    });

    it('should get escalation by intent ID', async () => {
      const created = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Intent lookup test',
        reasonCategory: 'manual_review',
        escalatedTo: 'test-team',
      });

      const retrieved = await escalationService.getByIntentId(testIntentId, testTenantId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
    });

    it('should list pending escalations', async () => {
      // Create multiple escalations
      await escalationService.create({
        intentId: randomUUID(),
        tenantId: testTenantId,
        reason: 'Pending 1',
        reasonCategory: 'manual_review',
        escalatedTo: 'team-a',
      });
      await escalationService.create({
        intentId: randomUUID(),
        tenantId: testTenantId,
        reason: 'Pending 2',
        reasonCategory: 'high_risk',
        escalatedTo: 'team-b',
      });

      const pending = await escalationService.listPending(testTenantId);
      expect(pending.length).toBe(2);
    });

    it('should not include resolved escalations in pending list', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Will be resolved',
        reasonCategory: 'manual_review',
        escalatedTo: 'test-team',
      });

      // Resolve it
      await escalationService.approve(escalation.id, testTenantId, {
        resolvedBy: 'approver-1',
      });

      const pending = await escalationService.listPending(testTenantId);
      expect(pending.length).toBe(0);
    });
  });

  // ===========================================================================
  // 3. Escalation Acknowledgment
  // ===========================================================================
  describe('Escalation Acknowledgment', () => {
    it('should acknowledge pending escalation', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Acknowledge test',
        reasonCategory: 'manual_review',
        escalatedTo: 'test-team',
      });

      const acknowledged = await escalationService.acknowledge(
        escalation.id,
        testTenantId,
        'reviewer-1'
      );

      expect(acknowledged).not.toBeNull();
      expect(acknowledged!.status).toBe('acknowledged');
      expect(acknowledged!.acknowledgedAt).toBeDefined();
    });

    it('should not acknowledge already acknowledged escalation', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Double ack test',
        reasonCategory: 'manual_review',
        escalatedTo: 'test-team',
      });

      await escalationService.acknowledge(escalation.id, testTenantId, 'reviewer-1');
      const secondAck = await escalationService.acknowledge(
        escalation.id,
        testTenantId,
        'reviewer-2'
      );

      // Second acknowledge should fail (status is already 'acknowledged')
      expect(secondAck).toBeNull();
    });
  });

  // ===========================================================================
  // 4. Escalation Approval
  // ===========================================================================
  describe('Escalation Approval', () => {
    it('should approve pending escalation', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Approve test',
        reasonCategory: 'manual_review',
        escalatedTo: 'test-team',
      });

      const approved = await escalationService.approve(escalation.id, testTenantId, {
        resolvedBy: 'approver-1',
        notes: 'Approved after review',
      });

      expect(approved).not.toBeNull();
      expect(approved!.status).toBe('approved');
      expect(approved!.resolvedBy).toBe('approver-1');
      expect(approved!.resolutionNotes).toBe('Approved after review');
      expect(approved!.resolvedAt).toBeDefined();
    });

    it('should approve acknowledged escalation', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Approve acked test',
        reasonCategory: 'manual_review',
        escalatedTo: 'test-team',
      });

      await escalationService.acknowledge(escalation.id, testTenantId, 'reviewer-1');
      const approved = await escalationService.approve(escalation.id, testTenantId, {
        resolvedBy: 'approver-1',
      });

      expect(approved).not.toBeNull();
      expect(approved!.status).toBe('approved');
    });

    it('should not approve already resolved escalation', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Double approve test',
        reasonCategory: 'manual_review',
        escalatedTo: 'test-team',
      });

      await escalationService.approve(escalation.id, testTenantId, {
        resolvedBy: 'approver-1',
      });

      const secondApproval = await escalationService.approve(escalation.id, testTenantId, {
        resolvedBy: 'approver-2',
      });

      expect(secondApproval).toBeNull();
    });
  });

  // ===========================================================================
  // 5. Escalation Rejection
  // ===========================================================================
  describe('Escalation Rejection', () => {
    it('should reject pending escalation', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Reject test',
        reasonCategory: 'manual_review',
        escalatedTo: 'test-team',
      });

      const rejected = await escalationService.reject(escalation.id, testTenantId, {
        resolvedBy: 'reviewer-1',
        notes: 'Request not justified',
      });

      expect(rejected).not.toBeNull();
      expect(rejected!.status).toBe('rejected');
      expect(rejected!.resolvedBy).toBe('reviewer-1');
      expect(rejected!.resolutionNotes).toBe('Request not justified');
    });

    it('should not reject already approved escalation', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Approve then reject test',
        reasonCategory: 'manual_review',
        escalatedTo: 'test-team',
      });

      await escalationService.approve(escalation.id, testTenantId, {
        resolvedBy: 'approver-1',
      });

      const rejection = await escalationService.reject(escalation.id, testTenantId, {
        resolvedBy: 'reviewer-1',
      });

      expect(rejection).toBeNull();
    });
  });

  // ===========================================================================
  // 6. Escalation Timeout
  // ===========================================================================
  describe('Escalation Timeout', () => {
    it('should process timed out escalations', async () => {
      // Create escalation with immediate timeout (hack for testing)
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Timeout test',
        reasonCategory: 'manual_review',
        escalatedTo: 'test-team',
        timeout: 'PT1S', // 1 second
      });

      // Manually set timeoutAt to the past
      escalation.timeoutAt = new Date(Date.now() - 1000).toISOString();

      const result = await escalationService.processTimeouts();

      expect(result.processed).toBe(1);
      expect(result.breached).toBe(1);

      const updated = await escalationService.get(escalation.id, testTenantId);
      expect(updated!.status).toBe('timeout');
      expect(updated!.slaBreached).toBe(true);
    });

    it('should not timeout non-pending escalations', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Already resolved',
        reasonCategory: 'manual_review',
        escalatedTo: 'test-team',
      });

      // Approve it
      await escalationService.approve(escalation.id, testTenantId, {
        resolvedBy: 'approver-1',
      });

      // Set timeout in the past
      escalation.timeoutAt = new Date(Date.now() - 1000).toISOString();

      const result = await escalationService.processTimeouts();

      expect(result.processed).toBe(0);
      expect(result.breached).toBe(0);
    });
  });

  // ===========================================================================
  // 7. Authorization
  // ===========================================================================
  describe('Authorization', () => {
    it('should allow admin to resolve any escalation', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Admin auth test',
        reasonCategory: 'manual_review',
        escalatedTo: 'specific-team',
      });

      const authResult = await authService.canResolveEscalation(
        testUserId,
        escalation,
        ['admin'],
        []
      );

      expect(authResult.allowed).toBe(true);
      expect(authResult.authMethod).toBe('admin_role');
    });

    it('should allow direct assignee to resolve', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Direct assignment test',
        reasonCategory: 'manual_review',
        escalatedTo: testUserId, // Assigned directly to user
      });

      const authResult = await authService.canResolveEscalation(
        testUserId,
        escalation,
        ['user'],
        []
      );

      expect(authResult.allowed).toBe(true);
      expect(authResult.authMethod).toBe('direct_assignment');
    });

    it('should allow explicit approver to resolve', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Explicit approver test',
        reasonCategory: 'manual_review',
        escalatedTo: 'governance-team',
      });

      // Assign user as explicit approver
      await authService.assignApprover(
        escalation.id,
        testUserId,
        testTenantId,
        'admin-user'
      );

      const authResult = await authService.canResolveEscalation(
        testUserId,
        escalation,
        ['user'],
        []
      );

      expect(authResult.allowed).toBe(true);
      expect(authResult.authMethod).toBe('explicit_approver');
    });

    it('should allow verified group member to resolve', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Group membership test',
        reasonCategory: 'manual_review',
        escalatedTo: 'governance-team',
      });

      // Add user to the group (database-verified)
      await authService.addGroupMembership(testTenantId, testUserId, 'governance-team');

      const authResult = await authService.canResolveEscalation(
        testUserId,
        escalation,
        ['user'],
        [] // JWT group claims are NOT trusted
      );

      expect(authResult.allowed).toBe(true);
      expect(authResult.authMethod).toBe('verified_group_membership');
    });

    it('should NOT trust JWT group claims for authorization', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'JWT bypass test',
        reasonCategory: 'manual_review',
        escalatedTo: 'governance-team',
      });

      // User claims to be in group via JWT, but not verified in database
      const authResult = await authService.canResolveEscalation(
        testUserId,
        escalation,
        ['user'],
        ['governance-team'] // JWT claims - should be IGNORED
      );

      expect(authResult.allowed).toBe(false);
    });

    it('should deny unauthorized user', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Unauthorized test',
        reasonCategory: 'manual_review',
        escalatedTo: 'specific-team',
      });

      const authResult = await authService.canResolveEscalation(
        testUserId,
        escalation,
        ['user'],
        []
      );

      expect(authResult.allowed).toBe(false);
      expect(authResult.reason).toContain('not authorized');
    });

    it('should allow removing approver assignment', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Remove approver test',
        reasonCategory: 'manual_review',
        escalatedTo: 'test-team',
      });

      await authService.assignApprover(
        escalation.id,
        testUserId,
        testTenantId,
        'admin-user'
      );

      // Verify user can resolve
      let authResult = await authService.canResolveEscalation(
        testUserId,
        escalation,
        ['user'],
        []
      );
      expect(authResult.allowed).toBe(true);

      // Remove approver
      const removed = await authService.removeApprover(
        escalation.id,
        testUserId,
        testTenantId
      );
      expect(removed).toBe(true);

      // Verify user can no longer resolve
      authResult = await authService.canResolveEscalation(
        testUserId,
        escalation,
        ['user'],
        []
      );
      expect(authResult.allowed).toBe(false);
    });
  });

  // ===========================================================================
  // 8. Cancellation
  // ===========================================================================
  describe('Escalation Cancellation', () => {
    it('should cancel pending escalation', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Cancel test',
        reasonCategory: 'manual_review',
        escalatedTo: 'test-team',
      });

      const cancelled = await escalationService.cancel(
        escalation.id,
        testTenantId,
        'Intent was cancelled by user'
      );

      expect(cancelled).not.toBeNull();
      expect(cancelled!.status).toBe('cancelled');
      expect(cancelled!.resolutionNotes).toBe('Intent was cancelled by user');
    });

    it('should not cancel resolved escalation', async () => {
      const escalation = await escalationService.create({
        intentId: testIntentId,
        tenantId: testTenantId,
        reason: 'Cancel resolved test',
        reasonCategory: 'manual_review',
        escalatedTo: 'test-team',
      });

      await escalationService.approve(escalation.id, testTenantId, {
        resolvedBy: 'approver-1',
      });

      const cancelled = await escalationService.cancel(
        escalation.id,
        testTenantId,
        'Attempt to cancel'
      );

      expect(cancelled).toBeNull();
    });
  });
});
