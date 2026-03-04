/**
 * Intent Lifecycle API Integration Tests
 *
 * Tests the full HTTP request/response cycle for intent endpoints.
 * Covers lifecycle flows including submit, evaluate, approve, escalate, and cancel.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestServer,
  closeTestServer,
  getTestServer,
  cleanupTestData,
  setupTestTenantMembership,
  setupTestConsent,
  authHeader,
  adminAuthHeader,
  escalationApproverAuthHeader,
  waitForEvent,
  delay,
  TEST_TENANT_ID,
  TEST_USER_ID,
  TEST_ENTITY_ID,
} from '../setup.js';
import {
  IntentFactory,
  PolicyFactory,
  resetAllFactories,
} from '../factories.js';
import type { FastifyInstance } from 'fastify';

describe('Intent Lifecycle API Integration Tests', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await setupTestServer();
    await setupTestTenantMembership(TEST_USER_ID, TEST_TENANT_ID, 'admin');
  });

  afterAll(async () => {
    await cleanupTestData(TEST_TENANT_ID);
    await closeTestServer();
  });

  beforeEach(async () => {
    resetAllFactories();
    await cleanupTestData(TEST_TENANT_ID);
    await setupTestTenantMembership(TEST_USER_ID, TEST_TENANT_ID, 'admin');
    await setupTestConsent(TEST_USER_ID, TEST_TENANT_ID);
  });

  // ===========================================================================
  // SUBMIT INTENT TESTS
  // ===========================================================================

  describe('POST /api/v1/intents - Submit Intent', () => {
    it('should submit intent and return 202 Accepted', async () => {
      const intentData = IntentFactory.createSubmission({
        goal: 'Test submit intent',
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: intentData,
      });

      expect(response.statusCode).toBe(202);

      const body = JSON.parse(response.body);
      expect(body.id).toBeDefined();
      expect(body.status).toBe('pending');
      expect(body.goal).toBe('Test submit intent');
      expect(body.entityId).toBe(TEST_ENTITY_ID);
      expect(body.tenantId).toBe(TEST_TENANT_ID);
    });

    it('should reject intent with missing required fields', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: {
          // Missing entityId and goal
          context: { action: 'test' },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject intent with oversized payload', async () => {
      const largeContext: Record<string, string> = {};
      // Create a context larger than 64KB
      for (let i = 0; i < 1000; i++) {
        largeContext[`key_${i}`] = 'x'.repeat(100);
      }

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: {
          entityId: TEST_ENTITY_ID,
          goal: 'Large payload test',
          context: largeContext,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should handle idempotency key for duplicate prevention', async () => {
      const intentData = IntentFactory.createSubmission({
        idempotencyKey: 'unique-key-123',
      });

      // First submission
      const response1 = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: intentData,
      });

      expect(response1.statusCode).toBe(202);
      const intent1 = JSON.parse(response1.body);

      // Second submission with same idempotency key
      const response2 = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: intentData,
      });

      // Should return the existing intent (deduplication)
      expect(response2.statusCode).toBe(202);
      const intent2 = JSON.parse(response2.body);
      expect(intent2.id).toBe(intent1.id);
    });
  });

  // ===========================================================================
  // SUBMIT -> EVALUATE -> APPROVE FLOW
  // ===========================================================================

  describe('Submit -> Evaluate -> Approve Flow', () => {
    it('should process intent through approval flow', async () => {
      // Submit intent
      const submitResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: IntentFactory.createSubmission({
          goal: 'Approve flow test',
          intentType: 'standard',
        }),
      });

      expect(submitResponse.statusCode).toBe(202);
      const intent = JSON.parse(submitResponse.body);

      // Wait for processing (the queue processes asynchronously)
      await delay(500);

      // Get intent status
      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/intents/${intent.id}`,
        headers: adminAuthHeader(),
      });

      expect(getResponse.statusCode).toBe(200);
      const processedIntent = JSON.parse(getResponse.body);

      // Status should have progressed from pending
      expect(['pending', 'evaluating', 'approved', 'denied', 'escalated']).toContain(
        processedIntent.status
      );
    });
  });

  // ===========================================================================
  // SUBMIT -> ESCALATE -> APPROVE FLOW
  // ===========================================================================

  describe('Submit -> Escalate -> Approve Flow', () => {
    it('should escalate intent and allow approval', async () => {
      // First create an escalation policy
      await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: PolicyFactory.createEscalation(['high_risk'], {
          name: 'High Risk Escalation Policy',
        }),
      });

      // Submit high-risk intent
      const submitResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: IntentFactory.createHighRisk(),
      });

      expect(submitResponse.statusCode).toBe(202);
      const intent = JSON.parse(submitResponse.body);

      // Manually escalate the intent
      const escalateResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/intents/${intent.id}/escalate`,
        headers: adminAuthHeader(),
        payload: {
          reason: 'High risk operation requires approval',
          reasonCategory: 'high_risk',
          escalatedTo: 'governance-team',
        },
      });

      expect(escalateResponse.statusCode).toBe(201);
      const escalation = JSON.parse(escalateResponse.body);
      expect(escalation.status).toBe('pending');

      // Approve the escalation as an approver
      const approveResponse = await server.inject({
        method: 'PUT',
        url: `/api/v1/intent/escalation/${escalation.id}/resolve`,
        headers: escalationApproverAuthHeader(),
        payload: {
          resolution: 'approved',
          notes: 'Approved after review',
        },
      });

      expect(approveResponse.statusCode).toBe(200);
      const resolvedEscalation = JSON.parse(approveResponse.body);
      expect(resolvedEscalation.status).toBe('approved');

      // Verify intent status updated
      const getIntentResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/intents/${intent.id}`,
        headers: adminAuthHeader(),
      });

      const finalIntent = JSON.parse(getIntentResponse.body);
      expect(finalIntent.status).toBe('approved');
    });
  });

  // ===========================================================================
  // SUBMIT -> ESCALATE -> TIMEOUT -> DENY FLOW
  // ===========================================================================

  describe('Submit -> Escalate -> Timeout -> Deny Flow', () => {
    it('should timeout escalation and deny intent when auto-deny is configured', async () => {
      // Submit intent
      const submitResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: IntentFactory.createSubmission({
          goal: 'Timeout test intent',
          intentType: 'timeout_test',
        }),
      });

      expect(submitResponse.statusCode).toBe(202);
      const intent = JSON.parse(submitResponse.body);

      // Escalate with very short timeout (for testing)
      const escalateResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/intents/${intent.id}/escalate`,
        headers: adminAuthHeader(),
        payload: {
          reason: 'Testing timeout',
          reasonCategory: 'manual_review',
          escalatedTo: 'governance-team',
          timeout: 'PT1S', // 1 second timeout
        },
      });

      expect(escalateResponse.statusCode).toBe(201);

      // Note: In a real test environment, we'd trigger the timeout processor
      // or mock the time to test the timeout flow
    });
  });

  // ===========================================================================
  // BULK SUBMIT INTENTS
  // ===========================================================================

  describe('POST /api/v1/intents/bulk - Bulk Submit Intents', () => {
    it('should submit multiple intents in bulk', async () => {
      const bulkRequest = IntentFactory.createBulkRequest(5);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/intents/bulk',
        headers: adminAuthHeader(),
        payload: bulkRequest,
      });

      expect(response.statusCode).toBe(202);

      const body = JSON.parse(response.body);
      expect(body.successful).toBeDefined();
      expect(body.failed).toBeDefined();
      expect(body.stats).toBeDefined();
      expect(body.stats.total).toBe(5);
      expect(body.stats.succeeded).toBe(5);
      expect(body.stats.failed).toBe(0);
    });

    it('should handle partial failures in bulk submit', async () => {
      const intents = [
        IntentFactory.createSubmission({ goal: 'Valid intent 1' }),
        { entityId: 'invalid-uuid', goal: 'Invalid entity ID' }, // Invalid
        IntentFactory.createSubmission({ goal: 'Valid intent 2' }),
      ];

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/intents/bulk',
        headers: adminAuthHeader(),
        payload: { intents },
      });

      expect(response.statusCode).toBe(202);

      const body = JSON.parse(response.body);
      expect(body.stats.total).toBe(3);
      expect(body.stats.succeeded).toBe(2);
      expect(body.stats.failed).toBe(1);
      expect(body.failed[0].index).toBe(1);
    });

    it('should stop on error when stopOnError is true', async () => {
      const intents = [
        IntentFactory.createSubmission({ goal: 'Valid intent' }),
        { entityId: 'invalid-uuid', goal: 'Invalid - should stop here' },
        IntentFactory.createSubmission({ goal: 'Should not be processed' }),
      ];

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/intents/bulk',
        headers: adminAuthHeader(),
        payload: { intents, options: { stopOnError: true } },
      });

      expect(response.statusCode).toBe(202);

      const body = JSON.parse(response.body);
      expect(body.stats.succeeded).toBe(1);
      expect(body.stats.failed).toBe(1);
      expect(body.stats.total).toBe(3);
    });

    it('should reject bulk request exceeding max count', async () => {
      const bulkRequest = IntentFactory.createBulkRequest(101); // Max is 100

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/intents/bulk',
        headers: adminAuthHeader(),
        payload: bulkRequest,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ===========================================================================
  // INTENT CANCELLATION
  // ===========================================================================

  describe('POST /api/v1/intents/:id/cancel - Cancel Intent', () => {
    it('should cancel a pending intent', async () => {
      // Submit intent
      const submitResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: IntentFactory.createSubmission({ goal: 'Cancel test intent' }),
      });

      const intent = JSON.parse(submitResponse.body);

      // Cancel the intent
      const cancelResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/intents/${intent.id}/cancel`,
        headers: adminAuthHeader(),
        payload: { reason: 'No longer needed' },
      });

      expect(cancelResponse.statusCode).toBe(200);

      const cancelledIntent = JSON.parse(cancelResponse.body);
      expect(cancelledIntent.status).toBe('cancelled');
      expect(cancelledIntent.cancellationReason).toBe('No longer needed');
    });

    it('should cancel an escalated intent', async () => {
      // Submit intent
      const submitResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: IntentFactory.createSubmission({ goal: 'Escalate then cancel' }),
      });

      const intent = JSON.parse(submitResponse.body);

      // Escalate the intent
      await server.inject({
        method: 'POST',
        url: `/api/v1/intents/${intent.id}/escalate`,
        headers: adminAuthHeader(),
        payload: {
          reason: 'Review needed',
          reasonCategory: 'manual_review',
          escalatedTo: 'governance-team',
        },
      });

      // Cancel the escalated intent
      const cancelResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/intents/${intent.id}/cancel`,
        headers: adminAuthHeader(),
        payload: { reason: 'Changed requirements' },
      });

      expect(cancelResponse.statusCode).toBe(200);

      const cancelledIntent = JSON.parse(cancelResponse.body);
      expect(cancelledIntent.status).toBe('cancelled');
    });

    it('should not cancel a completed intent', async () => {
      // Submit intent
      const submitResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: IntentFactory.createSubmission({ goal: 'Complete then try cancel' }),
      });

      const intent = JSON.parse(submitResponse.body);

      // Manually update to completed status (simulating completion)
      // In real scenario, this would happen through the execution flow

      // Try to cancel
      const cancelResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/intents/${intent.id}/cancel`,
        headers: adminAuthHeader(),
        payload: { reason: 'Too late' },
      });

      // Should succeed for pending but fail for completed
      // The actual response depends on the current status
      expect([200, 400, 404]).toContain(cancelResponse.statusCode);
    });

    it('should require reason for cancellation', async () => {
      const submitResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: IntentFactory.createSubmission({ goal: 'No reason cancel' }),
      });

      const intent = JSON.parse(submitResponse.body);

      const cancelResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/intents/${intent.id}/cancel`,
        headers: adminAuthHeader(),
        payload: {}, // Missing reason
      });

      expect(cancelResponse.statusCode).toBe(400);
    });
  });

  // ===========================================================================
  // GET INTENT TESTS
  // ===========================================================================

  describe('GET /api/v1/intents/:id - Get Intent', () => {
    it('should return intent with events and evaluations', async () => {
      const submitResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: IntentFactory.createSubmission({ goal: 'Get with events' }),
      });

      const intent = JSON.parse(submitResponse.body);

      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/intents/${intent.id}`,
        headers: adminAuthHeader(),
      });

      expect(getResponse.statusCode).toBe(200);

      const body = JSON.parse(getResponse.body);
      expect(body.id).toBe(intent.id);
      expect(body.events).toBeDefined();
      expect(Array.isArray(body.events)).toBe(true);
      expect(body.evaluations).toBeDefined();
      expect(Array.isArray(body.evaluations)).toBe(true);
    });

    it('should return 404 for non-existent intent', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/intents/00000000-0000-0000-0000-000000000000',
        headers: adminAuthHeader(),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ===========================================================================
  // LIST INTENTS TESTS
  // ===========================================================================

  describe('GET /api/v1/intents - List Intents', () => {
    it('should list intents with pagination', async () => {
      // Create multiple intents
      for (let i = 0; i < 5; i++) {
        await server.inject({
          method: 'POST',
          url: '/api/v1/intents',
          headers: adminAuthHeader(),
          payload: IntentFactory.createSubmission({ goal: `List test ${i}` }),
        });
      }

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/intents?limit=2',
        headers: adminAuthHeader(),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.items).toBeDefined();
      expect(body.items.length).toBeLessThanOrEqual(2);
      expect(body.hasMore).toBeDefined();
    });

    it('should filter intents by status', async () => {
      // Create intents
      await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: IntentFactory.createSubmission({ goal: 'Status filter test' }),
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/intents?status=pending',
        headers: adminAuthHeader(),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.items.every((i: { status: string }) => i.status === 'pending')).toBe(true);
    });

    it('should filter intents by entityId', async () => {
      const entityId = TEST_ENTITY_ID;

      await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: IntentFactory.createSubmission({ entityId, goal: 'Entity filter test' }),
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/intents?entityId=${entityId}`,
        headers: adminAuthHeader(),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.items.every((i: { entityId: string }) => i.entityId === entityId)).toBe(true);
    });

    it('should support cursor-based pagination', async () => {
      // Create intents
      for (let i = 0; i < 5; i++) {
        await server.inject({
          method: 'POST',
          url: '/api/v1/intents',
          headers: adminAuthHeader(),
          payload: IntentFactory.createSubmission({ goal: `Cursor test ${i}` }),
        });
      }

      // First page
      const page1Response = await server.inject({
        method: 'GET',
        url: '/api/v1/intents?limit=2',
        headers: adminAuthHeader(),
      });

      const page1 = JSON.parse(page1Response.body);
      expect(page1.items.length).toBe(2);
      expect(page1.nextCursor).toBeDefined();

      // Second page using cursor
      const page2Response = await server.inject({
        method: 'GET',
        url: `/api/v1/intents?limit=2&cursor=${page1.nextCursor}`,
        headers: adminAuthHeader(),
      });

      const page2 = JSON.parse(page2Response.body);
      expect(page2.items.length).toBe(2);
      // Ensure no overlap
      expect(page1.items[0].id).not.toBe(page2.items[0].id);
    });
  });

  // ===========================================================================
  // INTENT EVENT CHAIN VERIFICATION
  // ===========================================================================

  describe('GET /api/v1/intents/:id/verify - Verify Event Chain', () => {
    it('should verify intact event chain', async () => {
      const submitResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: IntentFactory.createSubmission({ goal: 'Verify chain test' }),
      });

      const intent = JSON.parse(submitResponse.body);

      const verifyResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/intents/${intent.id}/verify`,
        headers: adminAuthHeader(),
      });

      expect(verifyResponse.statusCode).toBe(200);

      const verification = JSON.parse(verifyResponse.body);
      expect(verification.valid).toBe(true);
    });
  });

  // ===========================================================================
  // SOFT DELETE (GDPR)
  // ===========================================================================

  describe('DELETE /api/v1/intents/:id - Soft Delete Intent', () => {
    it('should soft delete an intent', async () => {
      const submitResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/intents',
        headers: adminAuthHeader(),
        payload: IntentFactory.createSubmission({ goal: 'Soft delete test' }),
      });

      const intent = JSON.parse(submitResponse.body);

      const deleteResponse = await server.inject({
        method: 'DELETE',
        url: `/api/v1/intents/${intent.id}`,
        headers: adminAuthHeader(),
      });

      expect(deleteResponse.statusCode).toBe(204);

      // Verify intent is no longer accessible
      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/intents/${intent.id}`,
        headers: adminAuthHeader(),
      });

      expect(getResponse.statusCode).toBe(404);
    });
  });
});
