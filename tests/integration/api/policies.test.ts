/**
 * Policy API Integration Tests
 *
 * Tests the full HTTP request/response cycle for policy endpoints.
 * Covers CRUD operations, authorization, and cross-tenant isolation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestServer,
  closeTestServer,
  getTestServer,
  cleanupTestData,
  setupTestTenantMembership,
  authHeader,
  adminAuthHeader,
  policyWriterAuthHeader,
  readerAuthHeader,
  TEST_TENANT_ID,
  TEST_TENANT_ID_2,
  TEST_USER_ID,
  TEST_USER_ID_2,
} from '../setup.js';
import {
  PolicyFactory,
  resetAllFactories,
} from '../factories.js';
import type { FastifyInstance } from 'fastify';

describe('Policy API Integration Tests', () => {
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
    await setupTestTenantMembership(TEST_USER_ID_2, TEST_TENANT_ID_2, 'admin');
  });

  // ===========================================================================
  // CREATE POLICY TESTS
  // ===========================================================================

  describe('POST /api/v1/policies - Create Policy', () => {
    it('should create a policy with valid definition', async () => {
      const policyData = PolicyFactory.createAllow({ name: 'Test Allow Policy' });

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: policyData,
      });

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.data.id).toBeDefined();
      expect(body.data.name).toBe('Test Allow Policy');
      expect(body.data.namespace).toBe('default');
      expect(body.data.status).toBe('draft');
      expect(body.data.version).toBe(1);
      expect(body.data.tenantId).toBe(TEST_TENANT_ID);
      expect(body.data.definition).toBeDefined();
      expect(body.data.definition.version).toBe('1.0');
      expect(body.data.checksum).toBeDefined();
    });

    it('should reject policy with invalid definition', async () => {
      const invalidPolicy = PolicyFactory.createInvalid();

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: invalidPolicy,
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject policy with missing required fields', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: {
          // Missing name and definition
          namespace: 'default',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject policy with invalid version', async () => {
      const policyData = {
        name: 'Invalid Version Policy',
        definition: {
          version: '2.0', // Invalid version
          rules: [],
          defaultAction: 'allow',
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: policyData,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should create policy with custom namespace', async () => {
      const policyData = PolicyFactory.createAllow({
        name: 'Custom Namespace Policy',
        namespace: 'security',
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: policyData,
      });

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.body);
      expect(body.data.namespace).toBe('security');
    });
  });

  // ===========================================================================
  // UPDATE POLICY TESTS
  // ===========================================================================

  describe('PUT /api/v1/policies/:id - Update Policy', () => {
    it('should update policy with full replacement', async () => {
      // Create initial policy
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: PolicyFactory.createAllow({ name: 'Update Test Policy' }),
      });

      const policy = JSON.parse(createResponse.body).data;

      // Update with new definition
      const updatedDefinition = {
        version: '1.0' as const,
        rules: [
          {
            id: 'rule-updated',
            name: 'Updated Rule',
            priority: 50,
            enabled: true,
            when: { type: 'field', field: 'intent.priority', operator: 'greater_than', value: 5 },
            then: { action: 'deny' as const, reason: 'Priority too high' },
          },
        ],
        defaultAction: 'allow' as const,
      };

      const updateResponse = await server.inject({
        method: 'PUT',
        url: `/api/v1/policies/${policy.id}`,
        headers: adminAuthHeader(),
        payload: {
          description: 'Updated description',
          definition: updatedDefinition,
          changeSummary: 'Changed rule to deny high priority intents',
        },
      });

      expect(updateResponse.statusCode).toBe(200);

      const updatedBody = JSON.parse(updateResponse.body);
      expect(updatedBody.data.description).toBe('Updated description');
      expect(updatedBody.data.version).toBe(2);
      expect(updatedBody.data.definition.rules[0].name).toBe('Updated Rule');
    });

    it('should update policy with partial update (description only)', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: PolicyFactory.createAllow({ name: 'Partial Update Policy' }),
      });

      const policy = JSON.parse(createResponse.body).data;

      const updateResponse = await server.inject({
        method: 'PUT',
        url: `/api/v1/policies/${policy.id}`,
        headers: adminAuthHeader(),
        payload: {
          description: 'Only updating description',
        },
      });

      expect(updateResponse.statusCode).toBe(200);

      const updatedBody = JSON.parse(updateResponse.body);
      expect(updatedBody.data.description).toBe('Only updating description');
      expect(updatedBody.data.version).toBe(2);
      // Definition should remain unchanged
      expect(updatedBody.data.definition).toBeDefined();
    });

    it('should return 404 for non-existent policy', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/policies/00000000-0000-0000-0000-000000000000',
        headers: adminAuthHeader(),
        payload: { description: 'Test' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject update with invalid definition', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: PolicyFactory.createAllow({ name: 'Invalid Update Policy' }),
      });

      const policy = JSON.parse(createResponse.body).data;

      const updateResponse = await server.inject({
        method: 'PUT',
        url: `/api/v1/policies/${policy.id}`,
        headers: adminAuthHeader(),
        payload: {
          definition: {
            version: '1.0',
            rules: [
              {
                id: '',
                name: '',
                priority: -1,
                enabled: true,
                when: {},
                then: { action: 'invalid' },
              },
            ],
            defaultAction: 'invalid',
          },
        },
      });

      expect(updateResponse.statusCode).toBe(400);
    });
  });

  // ===========================================================================
  // DELETE POLICY TESTS (SOFT DELETE)
  // ===========================================================================

  describe('DELETE /api/v1/policies/:id - Soft Delete Policy', () => {
    it('should soft delete (archive) a policy', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: PolicyFactory.createAllow({ name: 'Delete Test Policy' }),
      });

      const policy = JSON.parse(createResponse.body).data;

      const deleteResponse = await server.inject({
        method: 'DELETE',
        url: `/api/v1/policies/${policy.id}`,
        headers: adminAuthHeader(),
      });

      expect(deleteResponse.statusCode).toBe(204);

      // Verify policy is archived, not hard deleted
      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/policies/${policy.id}`,
        headers: adminAuthHeader(),
      });

      expect(getResponse.statusCode).toBe(200);
      const archivedPolicy = JSON.parse(getResponse.body).data;
      expect(archivedPolicy.status).toBe('archived');
    });

    it('should return 404 for non-existent policy', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/policies/00000000-0000-0000-0000-000000000000',
        headers: adminAuthHeader(),
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ===========================================================================
  // LIST POLICIES TESTS
  // ===========================================================================

  describe('GET /api/v1/policies - List Policies', () => {
    it('should list policies with pagination', async () => {
      // Create multiple policies
      for (let i = 0; i < 5; i++) {
        await server.inject({
          method: 'POST',
          url: '/api/v1/policies',
          headers: adminAuthHeader(),
          payload: PolicyFactory.createAllow({ name: `Pagination Policy ${i}` }),
        });
      }

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/policies?limit=2',
        headers: adminAuthHeader(),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeLessThanOrEqual(2);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.limit).toBe(2);
    });

    it('should filter policies by namespace', async () => {
      // Create policies in different namespaces
      await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: PolicyFactory.createAllow({ name: 'Default NS Policy', namespace: 'default' }),
      });

      await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: PolicyFactory.createAllow({ name: 'Security NS Policy', namespace: 'security' }),
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/policies?namespace=security',
        headers: adminAuthHeader(),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.data.every((p: { namespace: string }) => p.namespace === 'security')).toBe(true);
    });

    it('should filter policies by status', async () => {
      // Create and publish a policy
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: PolicyFactory.createAllow({ name: 'Published Policy' }),
      });

      const policy = JSON.parse(createResponse.body).data;

      // Publish the policy
      await server.inject({
        method: 'POST',
        url: `/api/v1/policies/${policy.id}/publish`,
        headers: adminAuthHeader(),
      });

      // Create another draft policy
      await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: PolicyFactory.createAllow({ name: 'Draft Policy' }),
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/policies?status=published',
        headers: adminAuthHeader(),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.data.every((p: { status: string }) => p.status === 'published')).toBe(true);
    });

    it('should return empty list when no policies exist', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.data).toEqual([]);
    });
  });

  // ===========================================================================
  // AUTHORIZATION TESTS
  // ===========================================================================

  describe('Authorization Enforcement', () => {
    it('should allow admin to create policy', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: PolicyFactory.createAllow({ name: 'Admin Created Policy' }),
      });

      expect(response.statusCode).toBe(201);
    });

    it('should allow policy_writer to create policy', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: policyWriterAuthHeader(),
        payload: PolicyFactory.createAllow({ name: 'Writer Created Policy' }),
      });

      expect(response.statusCode).toBe(201);
    });

    it('should deny policy_reader from creating policy', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: readerAuthHeader(),
        payload: PolicyFactory.createAllow({ name: 'Reader Attempt Policy' }),
      });

      expect(response.statusCode).toBe(403);

      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('should allow policy_reader to read policies', async () => {
      // First create a policy as admin
      await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: PolicyFactory.createAllow({ name: 'Readable Policy' }),
      });

      // Reader should be able to list
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/policies',
        headers: readerAuthHeader(),
      });

      expect(response.statusCode).toBe(200);
    });

    it('should deny policy_reader from updating policy', async () => {
      // Create policy as admin
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: PolicyFactory.createAllow({ name: 'Update Forbidden Policy' }),
      });

      const policy = JSON.parse(createResponse.body).data;

      // Try to update as reader
      const updateResponse = await server.inject({
        method: 'PUT',
        url: `/api/v1/policies/${policy.id}`,
        headers: readerAuthHeader(),
        payload: { description: 'Attempted update' },
      });

      expect(updateResponse.statusCode).toBe(403);
    });

    it('should deny policy_reader from deleting policy', async () => {
      // Create policy as admin
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: PolicyFactory.createAllow({ name: 'Delete Forbidden Policy' }),
      });

      const policy = JSON.parse(createResponse.body).data;

      // Try to delete as reader
      const deleteResponse = await server.inject({
        method: 'DELETE',
        url: `/api/v1/policies/${policy.id}`,
        headers: readerAuthHeader(),
      });

      expect(deleteResponse.statusCode).toBe(403);
    });

    it('should reject requests without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/policies',
        // No auth header
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ===========================================================================
  // CROSS-TENANT ISOLATION TESTS
  // ===========================================================================

  describe('Cross-Tenant Isolation', () => {
    it('should not allow access to another tenant\'s policy', async () => {
      // Create policy as tenant 1
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: authHeader({ tenantId: TEST_TENANT_ID, roles: ['admin'] }),
        payload: PolicyFactory.createAllow({ name: 'Tenant 1 Policy' }),
      });

      const policy = JSON.parse(createResponse.body).data;

      // Try to access as tenant 2
      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/policies/${policy.id}`,
        headers: authHeader({ tenantId: TEST_TENANT_ID_2, roles: ['admin'] }),
      });

      expect(getResponse.statusCode).toBe(404);
    });

    it('should not allow updating another tenant\'s policy', async () => {
      // Create policy as tenant 1
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: authHeader({ tenantId: TEST_TENANT_ID, roles: ['admin'] }),
        payload: PolicyFactory.createAllow({ name: 'Tenant 1 Policy for Update' }),
      });

      const policy = JSON.parse(createResponse.body).data;

      // Try to update as tenant 2
      const updateResponse = await server.inject({
        method: 'PUT',
        url: `/api/v1/policies/${policy.id}`,
        headers: authHeader({ tenantId: TEST_TENANT_ID_2, roles: ['admin'] }),
        payload: { description: 'Malicious update' },
      });

      expect(updateResponse.statusCode).toBe(404);
    });

    it('should not allow deleting another tenant\'s policy', async () => {
      // Create policy as tenant 1
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: authHeader({ tenantId: TEST_TENANT_ID, roles: ['admin'] }),
        payload: PolicyFactory.createAllow({ name: 'Tenant 1 Policy for Delete' }),
      });

      const policy = JSON.parse(createResponse.body).data;

      // Try to delete as tenant 2
      const deleteResponse = await server.inject({
        method: 'DELETE',
        url: `/api/v1/policies/${policy.id}`,
        headers: authHeader({ tenantId: TEST_TENANT_ID_2, roles: ['admin'] }),
      });

      expect(deleteResponse.statusCode).toBe(404);
    });

    it('should only list policies from own tenant', async () => {
      // Create policies in both tenants
      await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: authHeader({ tenantId: TEST_TENANT_ID, roles: ['admin'] }),
        payload: PolicyFactory.createAllow({ name: 'Tenant 1 List Policy' }),
      });

      await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: authHeader({ tenantId: TEST_TENANT_ID_2, roles: ['admin'] }),
        payload: PolicyFactory.createAllow({ name: 'Tenant 2 List Policy' }),
      });

      // List as tenant 1
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/policies',
        headers: authHeader({ tenantId: TEST_TENANT_ID, roles: ['admin'] }),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.data.every((p: { tenantId: string }) => p.tenantId === TEST_TENANT_ID)).toBe(true);
      expect(body.data.some((p: { name: string }) => p.name === 'Tenant 2 List Policy')).toBe(false);
    });
  });

  // ===========================================================================
  // POLICY PUBLISH TESTS
  // ===========================================================================

  describe('POST /api/v1/policies/:id/publish - Publish Policy', () => {
    it('should publish a draft policy', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: PolicyFactory.createAllow({ name: 'Policy to Publish' }),
      });

      const policy = JSON.parse(createResponse.body).data;
      expect(policy.status).toBe('draft');

      const publishResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/policies/${policy.id}/publish`,
        headers: adminAuthHeader(),
      });

      expect(publishResponse.statusCode).toBe(200);

      const publishedPolicy = JSON.parse(publishResponse.body).data;
      expect(publishedPolicy.status).toBe('published');
      expect(publishedPolicy.publishedAt).toBeDefined();
    });
  });

  // ===========================================================================
  // POLICY VERSION HISTORY TESTS
  // ===========================================================================

  describe('GET /api/v1/policies/:id/versions - Version History', () => {
    it('should retrieve version history after updates', async () => {
      // Create policy
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/policies',
        headers: adminAuthHeader(),
        payload: PolicyFactory.createAllow({ name: 'Version History Policy' }),
      });

      const policy = JSON.parse(createResponse.body).data;

      // Update policy twice
      await server.inject({
        method: 'PUT',
        url: `/api/v1/policies/${policy.id}`,
        headers: adminAuthHeader(),
        payload: { description: 'First update', changeSummary: 'Added description' },
      });

      await server.inject({
        method: 'PUT',
        url: `/api/v1/policies/${policy.id}`,
        headers: adminAuthHeader(),
        payload: { description: 'Second update', changeSummary: 'Changed description' },
      });

      // Get version history
      const historyResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/policies/${policy.id}/versions`,
        headers: adminAuthHeader(),
      });

      expect(historyResponse.statusCode).toBe(200);

      const history = JSON.parse(historyResponse.body).data;
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThanOrEqual(2);
    });
  });
});
