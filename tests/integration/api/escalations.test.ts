/**
 * Escalation API Integration Tests
 *
 * Tests the full HTTP request/response cycle for escalation endpoints.
 * Covers escalation creation, approval, rejection, bulk operations, and SLA handling.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestServer,
  closeTestServer,
  getTestServer,
  cleanupTestData,
  setupTestTenantMembership,
  setupTestConsent,
  setupTestGroupMembership,
  authHeader,
  adminAuthHeader,
  escalationApproverAuthHeader,
  delay,
  TEST_TENANT_ID,
  TEST_TENANT_ID_2,
  TEST_USER_ID,
  TEST_USER_ID_2,
  TEST_ENTITY_ID,
} from '../setup.js';
import {
  IntentFactory,
  resetAllFactories,
} from '../factories.js';
import type { FastifyInstance } from 'fastify';

describe('Escalation API Integration Tests', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await setupTestServer();
    await setupTestTenantMembership(TEST_USER_ID, TEST_TENANT_ID, 'admin');
    await setupTestTenantMembership(TEST_USER_ID_2, TEST_TENANT_ID_2, 'admin');
  });

  afterAll(async () => {
    await cleanupTestData(TEST_TENANT_ID);
    await cleanupTestData(TEST_TENANT_ID_2);
    await closeTestServer();
  });

  beforeEach(async () => {
    resetAllFactories();
    await cleanupTestData(TEST_TENANT_ID);
    await cleanupTestData(TEST_TENANT_ID_2);
    await setupTestTenantMembership(TEST_USER_ID, TEST_TENANT_ID, 'admin');
    await setupTestConsent(TEST_USER_ID, TEST_TENANT_ID);
    await setupTestGroupMembership(TEST_USER_ID, TEST_TENANT_ID, 'governance-team');
  });

  // Helper to create an intent and escalate it
  async function createAndEscalateIntent(options: {
    goal?: string;
    reason?: string;
    reasonCategory?: string;
    escalatedTo?: string;
    timeout?: string;
    tenantId?: string;
  } = {}): Promise<{ intent: any; escalation: any }> {
    const tenantId = options.tenantId ?? TEST_TENANT_ID;
    const headers = authHeader({ tenantId, roles: ['admin'] });

    // Create intent
    const submitResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      headers,
      payload: IntentFactory.createSubmission({
        goal: options.goal ?? 'Escalation test intent',
      }),
    });

    const intent = JSON.parse(submitResponse.body);

    // Escalate intent
    const escalateResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/intents/${intent.id}/escalate`,
      headers,
      payload: {
        reason: options.reason ?? 'Requires review',
        reasonCategory: options.reasonCategory ?? 'manual_review',
        escalatedTo: options.escalatedTo ?? 'governance-team',
        timeout: options.timeout ?? 'PT1H',
      },
    });

    const escalation = JSON.parse(escalateResponse.body);

    return { intent, escalation };
  }

  // ===========================================================================
  // CREATE ESCALATION TESTS
  // ===========================================================================

  describe('POST /api/v1/intents/:id/escalate - Create Escalation', () => {
    it('should create escalation for an intent', async () => {
      // Create intent first
      const submitResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: IntentFactory.createSubmission({ goal: 'Escalation creation test' }),
      });

      const intent = JSON.parse(submitResponse.body);

      // Create escalation
      const escalateResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/intents/${intent.id}/escalate`,
        headers: adminAuthHeader(),
        payload: {
          reason: 'Requires human approval for high-risk operation',
          reasonCategory: 'high_risk',
          escalatedTo: 'governance-team',
          timeout: 'PT1H',
          context: { additionalInfo: 'test context' },
        },
      });

      expect(escalateResponse.statusCode).toBe(201);

      const escalation = JSON.parse(escalateResponse.body);
      expect(escalation.id).toBeDefined();
      expect(escalation.intentId).toBe(intent.id);
      expect(escalation.status).toBe('pending');
      expect(escalation.reason).toBe('Requires human approval for high-risk operation');
      expect(escalation.reasonCategory).toBe('high_risk');
      expect(escalation.escalatedTo).toBe('governance-team');
      expect(escalation.timeout).toBe('PT1H');
      expect(escalation.timeoutAt).toBeDefined();
    });

    it('should update intent status to escalated', async () => {
      const { intent, escalation } = await createAndEscalateIntent();

      // Verify intent status changed
      const getIntentResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/intents/${intent.id}`,
        headers: adminAuthHeader(),
      });

      const updatedIntent = JSON.parse(getIntentResponse.body);
      expect(updatedIntent.status).toBe('escalated');
    });

    it('should reject escalation for non-existent intent', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/intents/00000000-0000-0000-0000-000000000000/escalate',
        headers: adminAuthHeader(),
        payload: {
          reason: 'Test',
          reasonCategory: 'manual_review',
          escalatedTo: 'governance-team',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject escalation with invalid reason category', async () => {
      const submitResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: IntentFactory.createSubmission({ goal: 'Invalid category test' }),
      });

      const intent = JSON.parse(submitResponse.body);

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/intents/${intent.id}/escalate`,
        headers: adminAuthHeader(),
        payload: {
          reason: 'Test',
          reasonCategory: 'invalid_category',
          escalatedTo: 'governance-team',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should accept different reason categories', async () => {
      const categories = [
        'trust_insufficient',
        'high_risk',
        'policy_violation',
        'manual_review',
        'constraint_escalate',
      ];

      for (const category of categories) {
        const submitResponse = await server.inject({
          method: 'POST',
          url: '/api/v1/intents',
          headers: adminAuthHeader(),
          payload: IntentFactory.createSubmission({ goal: `Category test: ${category}` }),
        });

        const intent = JSON.parse(submitResponse.body);

        const escalateResponse = await server.inject({
          method: 'POST',
          url: `/api/v1/intents/${intent.id}/escalate`,
          headers: adminAuthHeader(),
          payload: {
            reason: `Testing ${category}`,
            reasonCategory: category,
            escalatedTo: 'governance-team',
          },
        });

        expect(escalateResponse.statusCode).toBe(201);
      }
    });
  });

  // ===========================================================================
  // APPROVE ESCALATION TESTS
  // ===========================================================================

  describe('PUT /api/v1/intent/escalation/:id/resolve - Approve Escalation', () => {
    it('should approve a pending escalation', async () => {
      const { intent, escalation } = await createAndEscalateIntent({
        reason: 'Approval test',
      });

      const resolveResponse = await server.inject({
        method: 'PUT',
        url: `/api/v1/intent/escalation/${escalation.id}/resolve`,
        headers: escalationApproverAuthHeader(),
        payload: {
          resolution: 'approved',
          notes: 'Approved after careful review',
        },
      });

      expect(resolveResponse.statusCode).toBe(200);

      const resolved = JSON.parse(resolveResponse.body);
      expect(resolved.status).toBe('approved');
      expect(resolved.resolution).toBeDefined();
      expect(resolved.resolution.resolvedBy).toBeDefined();
      expect(resolved.resolution.notes).toBe('Approved after careful review');

      // Verify intent status updated
      const getIntentResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/intents/${intent.id}`,
        headers: adminAuthHeader(),
      });

      const approvedIntent = JSON.parse(getIntentResponse.body);
      expect(approvedIntent.status).toBe('approved');
    });

    it('should reject approval without proper role', async () => {
      const { escalation } = await createAndEscalateIntent();

      // Try to approve with regular user role
      const resolveResponse = await server.inject({
        method: 'PUT',
        url: `/api/v1/intent/escalation/${escalation.id}/resolve`,
        headers: authHeader({ roles: ['user'] }), // Not an approver
        payload: {
          resolution: 'approved',
        },
      });

      expect(resolveResponse.statusCode).toBe(403);
    });
  });

  // ===========================================================================
  // REJECT ESCALATION TESTS
  // ===========================================================================

  describe('PUT /api/v1/intent/escalation/:id/resolve - Reject Escalation', () => {
    it('should reject a pending escalation', async () => {
      const { intent, escalation } = await createAndEscalateIntent({
        reason: 'Rejection test',
      });

      const resolveResponse = await server.inject({
        method: 'PUT',
        url: `/api/v1/intent/escalation/${escalation.id}/resolve`,
        headers: escalationApproverAuthHeader(),
        payload: {
          resolution: 'rejected',
          notes: 'Rejected due to policy violation',
        },
      });

      expect(resolveResponse.statusCode).toBe(200);

      const resolved = JSON.parse(resolveResponse.body);
      expect(resolved.status).toBe('rejected');

      // Verify intent status updated to denied
      const getIntentResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/intents/${intent.id}`,
        headers: adminAuthHeader(),
      });

      const deniedIntent = JSON.parse(getIntentResponse.body);
      expect(deniedIntent.status).toBe('denied');
    });
  });

  // ===========================================================================
  // BULK APPROVE ESCALATIONS
  // ===========================================================================

  describe('POST /api/v1/escalations/bulk-resolve - Bulk Approve/Reject', () => {
    it('should bulk approve multiple escalations', async () => {
      // Create multiple escalations
      const escalations: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { escalation } = await createAndEscalateIntent({
          goal: `Bulk test ${i}`,
        });
        escalations.push(escalation.id);
      }

      const bulkResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/escalations/bulk-resolve',
        headers: escalationApproverAuthHeader(),
        payload: {
          escalationIds: escalations,
          resolution: 'approved',
          notes: 'Bulk approved',
        },
      });

      expect(bulkResponse.statusCode).toBe(200);

      const result = JSON.parse(bulkResponse.body);
      expect(result.successful).toBeDefined();
      expect(result.successful.length).toBe(3);
      expect(result.failed).toBeDefined();
      expect(result.failed.length).toBe(0);
    });

    it('should handle partial failures in bulk resolve', async () => {
      const { escalation } = await createAndEscalateIntent();

      const bulkResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/escalations/bulk-resolve',
        headers: escalationApproverAuthHeader(),
        payload: {
          escalationIds: [
            escalation.id,
            '00000000-0000-0000-0000-000000000000', // Non-existent
          ],
          resolution: 'approved',
        },
      });

      expect(bulkResponse.statusCode).toBe(200);

      const result = JSON.parse(bulkResponse.body);
      expect(result.successful.length).toBe(1);
      expect(result.failed.length).toBe(1);
    });
  });

  // ===========================================================================
  // SLA TIMEOUT HANDLING
  // ===========================================================================

  describe('SLA Timeout Handling', () => {
    it('should track SLA breach status', async () => {
      const { escalation } = await createAndEscalateIntent({
        timeout: 'PT1H', // 1 hour timeout
      });

      // Get escalation and verify SLA tracking fields
      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/intents/${escalation.intentId}/escalation`,
        headers: adminAuthHeader(),
      });

      const esc = JSON.parse(getResponse.body);
      expect(esc.slaBreached).toBe(false);
      expect(esc.timeoutAt).toBeDefined();
    });

    it('should mark SLA as breached when resolved after timeout', async () => {
      // Create escalation with very short timeout
      const { escalation } = await createAndEscalateIntent({
        timeout: 'PT1S', // 1 second
      });

      // Wait for timeout
      await delay(1500);

      // Resolve the escalation (after timeout)
      const resolveResponse = await server.inject({
        method: 'PUT',
        url: `/api/v1/intent/escalation/${escalation.id}/resolve`,
        headers: escalationApproverAuthHeader(),
        payload: {
          resolution: 'approved',
          notes: 'Late approval',
        },
      });

      expect(resolveResponse.statusCode).toBe(200);

      const resolved = JSON.parse(resolveResponse.body);
      expect(resolved.slaBreached).toBe(true);
    });
  });

  // ===========================================================================
  // ASSIGNMENT AND REASSIGNMENT
  // ===========================================================================

  describe('Escalation Assignment', () => {
    it('should create escalation with specific assignee', async () => {
      const submitResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: IntentFactory.createSubmission({ goal: 'Assignment test' }),
      });

      const intent = JSON.parse(submitResponse.body);

      const escalateResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/intents/${intent.id}/escalate`,
        headers: adminAuthHeader(),
        payload: {
          reason: 'Specific assignment',
          reasonCategory: 'manual_review',
          escalatedTo: 'security-team',
        },
      });

      expect(escalateResponse.statusCode).toBe(201);

      const escalation = JSON.parse(escalateResponse.body);
      expect(escalation.escalatedTo).toBe('security-team');
    });

    it('should acknowledge escalation', async () => {
      const { escalation } = await createAndEscalateIntent();

      const ackResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/escalations/${escalation.id}/acknowledge`,
        headers: escalationApproverAuthHeader(),
      });

      expect(ackResponse.statusCode).toBe(200);

      const acknowledged = JSON.parse(ackResponse.body);
      expect(acknowledged.status).toBe('acknowledged');
      expect(acknowledged.acknowledgedAt).toBeDefined();
    });
  });

  // ===========================================================================
  // LIST ESCALATIONS
  // ===========================================================================

  describe('GET /api/v1/escalations - List Escalations', () => {
    it('should list pending escalations', async () => {
      // Create multiple escalations
      for (let i = 0; i < 3; i++) {
        await createAndEscalateIntent({ goal: `List test ${i}` });
      }

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/escalations?status=pending',
        headers: adminAuthHeader(),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.every((e: { status: string }) => e.status === 'pending')).toBe(true);
    });

    it('should filter escalations by escalatedTo', async () => {
      await createAndEscalateIntent({ escalatedTo: 'team-a' });
      await createAndEscalateIntent({ escalatedTo: 'team-b' });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/escalations?escalatedTo=team-a',
        headers: adminAuthHeader(),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.data.every((e: { escalatedTo: string }) => e.escalatedTo === 'team-a')).toBe(true);
    });
  });

  // ===========================================================================
  // ESCALATION HISTORY
  // ===========================================================================

  describe('GET /api/v1/intents/:id/escalation/history - Escalation History', () => {
    it('should retrieve escalation history for an intent', async () => {
      // Create intent
      const submitResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: IntentFactory.createSubmission({ goal: 'History test' }),
      });

      const intent = JSON.parse(submitResponse.body);

      // Create first escalation
      await server.inject({
        method: 'POST',
        url: `/api/v1/intents/${intent.id}/escalate`,
        headers: adminAuthHeader(),
        payload: {
          reason: 'First escalation',
          reasonCategory: 'manual_review',
          escalatedTo: 'governance-team',
        },
      });

      // Get escalation and reject it
      const getEscResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/intents/${intent.id}/escalation`,
        headers: adminAuthHeader(),
      });
      const escalation = JSON.parse(getEscResponse.body);

      await server.inject({
        method: 'PUT',
        url: `/api/v1/intent/escalation/${escalation.id}/resolve`,
        headers: escalationApproverAuthHeader(),
        payload: {
          resolution: 'rejected',
          notes: 'Rejected first time',
        },
      });

      // Get history
      const historyResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/intents/${intent.id}/escalation/history`,
        headers: adminAuthHeader(),
      });

      expect(historyResponse.statusCode).toBe(200);

      const history = JSON.parse(historyResponse.body);
      expect(Array.isArray(history.data)).toBe(true);
      expect(history.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================================================
  // CROSS-TENANT ISOLATION
  // ===========================================================================

  describe('Cross-Tenant Isolation', () => {
    it('should not allow access to another tenant\'s escalation', async () => {
      // Create escalation in tenant 1
      const { escalation } = await createAndEscalateIntent({
        tenantId: TEST_TENANT_ID,
      });

      // Try to resolve as tenant 2
      const resolveResponse = await server.inject({
        method: 'PUT',
        url: `/api/v1/intent/escalation/${escalation.id}/resolve`,
        headers: authHeader({ tenantId: TEST_TENANT_ID_2, roles: ['escalation_approver'] }),
        payload: {
          resolution: 'approved',
        },
      });

      expect(resolveResponse.statusCode).toBe(404);
    });

    it('should only list escalations from own tenant', async () => {
      // Create escalations in both tenants
      await createAndEscalateIntent({ tenantId: TEST_TENANT_ID, goal: 'Tenant 1 esc' });

      // Setup tenant 2
      await setupTestTenantMembership(TEST_USER_ID_2, TEST_TENANT_ID_2, 'admin');
      await setupTestConsent(TEST_USER_ID_2, TEST_TENANT_ID_2);

      await createAndEscalateIntent({ tenantId: TEST_TENANT_ID_2, goal: 'Tenant 2 esc' });

      // List as tenant 1
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/escalations',
        headers: authHeader({ tenantId: TEST_TENANT_ID, roles: ['admin'] }),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.data.every((e: { tenantId: string }) => e.tenantId === TEST_TENANT_ID)).toBe(true);
    });
  });

  // ===========================================================================
  // CANCEL ESCALATION
  // ===========================================================================

  describe('POST /api/v1/escalations/:id/cancel - Cancel Escalation', () => {
    it('should cancel a pending escalation', async () => {
      const { intent, escalation } = await createAndEscalateIntent();

      const cancelResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/escalations/${escalation.id}/cancel`,
        headers: adminAuthHeader(),
        payload: {
          reason: 'No longer needed',
        },
      });

      expect(cancelResponse.statusCode).toBe(200);

      const cancelled = JSON.parse(cancelResponse.body);
      expect(cancelled.status).toBe('cancelled');
    });

    it('should not cancel already resolved escalation', async () => {
      const { escalation } = await createAndEscalateIntent();

      // First resolve it
      await server.inject({
        method: 'PUT',
        url: `/api/v1/intent/escalation/${escalation.id}/resolve`,
        headers: escalationApproverAuthHeader(),
        payload: { resolution: 'approved' },
      });

      // Try to cancel
      const cancelResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/escalations/${escalation.id}/cancel`,
        headers: adminAuthHeader(),
        payload: { reason: 'Try to cancel' },
      });

      expect([200, 400]).toContain(cancelResponse.statusCode);
      // If 200, status should still be approved
      if (cancelResponse.statusCode === 200) {
        const result = JSON.parse(cancelResponse.body);
        expect(result.status).toBe('approved');
      }
    });
  });

  // ===========================================================================
  // SLA STATISTICS
  // ===========================================================================

  describe('GET /api/v1/escalations/stats - SLA Statistics', () => {
    it('should return SLA breach statistics', async () => {
      // Create some escalations
      await createAndEscalateIntent();

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/escalations/stats',
        headers: adminAuthHeader(),
      });

      expect(response.statusCode).toBe(200);

      const stats = JSON.parse(response.body);
      expect(stats.total).toBeDefined();
      expect(stats.breached).toBeDefined();
      expect(stats.breachRate).toBeDefined();
      expect(stats.avgResolutionTime).toBeDefined();
    });
  });
});
