/**
 * CAR ID Extension API Tests
 *
 * Tests for the CAR ID Extension API routes:
 * - List extensions
 * - Get extension details
 * - Invoke extension
 * - Extension health/status
 * - Authorization checks
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// Mock dependencies before importing modules
vi.mock('../../../src/common/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../../src/common/config.js', () => ({
  getConfig: vi.fn(() => ({
    env: 'test',
    api: { rateLimit: 100, basePath: '/api/v1' },
  })),
}));

vi.mock('../../../src/common/trace.js', () => ({
  getTraceContext: vi.fn(() => ({ traceId: 'test-trace-id', spanId: 'test-span-id' })),
  createTraceContext: vi.fn(() => ({
    traceId: 'new-trace-id',
    spanId: 'new-span-id',
    traceparent: '00-new-trace-id-new-span-id-01',
  })),
  extractTraceFromHeaders: vi.fn(() => null),
}));

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: vi.fn(() => ({
      startActiveSpan: vi.fn((name, options, fn) =>
        fn({
          setAttribute: vi.fn(),
          setStatus: vi.fn(),
          recordException: vi.fn(),
          end: vi.fn(),
        })
      ),
    })),
    getActiveSpan: vi.fn(() => null),
  },
  SpanStatusCode: { OK: 1, ERROR: 2 },
  SpanKind: { INTERNAL: 0 },
  context: { active: vi.fn() },
}));

// Import after mocks
import {
  registerExtensionRoutes,
  resetExtensionService,
  EXTENSION_ROLES,
} from '../../../src/api/routes/extensions.js';

describe('CAR ID Extension API', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    // Reset extension service before each test
    resetExtensionService();

    server = Fastify();

    // Mock JWT verification to always succeed with test user
    server.decorate('user', {
      sub: 'test-user-id',
      tenantId: 'test-tenant-id',
      roles: ['admin'],
    });

    server.addHook('preHandler', async (request) => {
      request.user = {
        sub: 'test-user-id',
        tenantId: 'test-tenant-id',
        roles: ['admin'],
      };
    });

    // Register extension routes
    await registerExtensionRoutes(server);
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
    resetExtensionService();
  });

  // ==========================================================================
  // LIST EXTENSIONS
  // ==========================================================================

  describe('GET /extensions - List Extensions', () => {
    it('should list all available extensions', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/extensions',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.extensions).toBeDefined();
      expect(Array.isArray(body.data.extensions)).toBe(true);

      // Should have at least the built-in extensions
      const extensionIds = body.data.extensions.map(
        (ext: { extensionId: string }) => ext.extensionId
      );
      expect(extensionIds).toContain('car-ext-cognigate-v1');
      expect(extensionIds).toContain('car-ext-monitoring-v1');
      expect(extensionIds).toContain('car-ext-audit-v1');
    });

    it('should return extension details in the list', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/extensions',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      const govExtension = body.data.extensions.find(
        (ext: { extensionId: string }) => ext.extensionId === 'car-ext-cognigate-v1'
      );

      expect(govExtension).toBeDefined();
      expect(govExtension.name).toBe('Cognigate Governance Runtime');
      expect(govExtension.version).toBe('1.0.0');
      expect(govExtension.shortcode).toBe('gov');
      expect(govExtension.publisher).toBe('did:web:agentanchor.io');
      expect(govExtension.hooks).toBeDefined();
      expect(Array.isArray(govExtension.hooks)).toBe(true);
    });

    it('should reject unauthorized users', async () => {
      // Create server with unauthorized user
      const unauthorizedServer = Fastify();
      unauthorizedServer.addHook('preHandler', async (request) => {
        request.user = {
          sub: 'test-user-id',
          tenantId: 'test-tenant-id',
          roles: ['viewer'], // No extension read permission
        };
      });
      // Set up error handler to properly handle ForbiddenError
      unauthorizedServer.setErrorHandler((error, request, reply) => {
        if (error.name === 'ForbiddenError' || (error as { statusCode?: number }).statusCode === 403) {
          return reply.status(403).send({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: error.message,
            },
          });
        }
        return reply.status(500).send({ error: error.message });
      });
      await registerExtensionRoutes(unauthorizedServer);
      await unauthorizedServer.ready();

      const response = await unauthorizedServer.inject({
        method: 'GET',
        url: '/extensions',
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('FORBIDDEN');

      await unauthorizedServer.close();
    });
  });

  // ==========================================================================
  // GET EXTENSION DETAILS
  // ==========================================================================

  describe('GET /extensions/:id - Get Extension Details', () => {
    it('should get extension by ID', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/extensions/car-ext-cognigate-v1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.extensionId).toBe('car-ext-cognigate-v1');
      expect(body.data.name).toBe('Cognigate Governance Runtime');
    });

    it('should get extension by shortcode', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/extensions/gov',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.extensionId).toBe('car-ext-cognigate-v1');
      expect(body.data.shortcode).toBe('gov');
    });

    it('should return 404 for non-existent extension', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/extensions/non-existent-extension',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
      // sendNotFound creates code based on resource type
      expect(body.error.code).toBe('EXTENSION_NOT_FOUND');
    });
  });

  // ==========================================================================
  // INVOKE EXTENSION
  // ==========================================================================

  describe('POST /extensions/:id/invoke - Invoke Extension', () => {
    const testAgent = {
      did: 'did:web:agents.test.com:test-agent',
      carId: 'a3i.test.test-agent:FHC-L3@1.0.0',
      publisher: 'test',
      name: 'Test Agent',
      trustTier: 3,
      trustScore: 650,
      domains: 7,
      level: 3,
      version: '1.0.0',
    };

    it('should invoke capability request', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/extensions/gov/invoke',
        payload: {
          type: 'capability',
          agent: testAgent,
          request: {
            domains: ['food', 'hospitality'],
            level: 3,
            context: {
              source: 'api',
              purpose: 'menu-planning',
            },
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.result).toBeDefined();
      expect(typeof body.data.result.granted).toBe('boolean');
      expect(body.data.result.extensionsEvaluated).toBeDefined();
    });

    it('should invoke action request', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/extensions/gov/invoke',
        payload: {
          type: 'action',
          agent: testAgent,
          request: {
            type: 'read_data',
            target: {
              type: 'resource',
              id: 'menu-database',
            },
            params: {
              query: 'SELECT * FROM menus',
            },
            context: {
              source: 'api',
              purpose: 'data-retrieval',
            },
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.result).toBeDefined();
      expect(typeof body.data.result.proceeded).toBe('boolean');
    });

    it('should invoke behavior verification', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/extensions/gov/invoke',
        payload: {
          type: 'behavior',
          agent: testAgent,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.result).toBeDefined();
      expect(typeof body.data.result.inBounds).toBe('boolean');
      expect(typeof body.data.result.driftScore).toBe('number');
      expect(body.data.result.recommendation).toBeDefined();
    });

    it('should return 404 for non-existent extension', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/extensions/non-existent/invoke',
        payload: {
          type: 'behavior',
          agent: testAgent,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject invalid request body', async () => {
      // Set up error handler for validation errors
      const testServer = Fastify();
      testServer.addHook('preHandler', async (request) => {
        request.user = { roles: ['admin'] };
      });
      testServer.setErrorHandler((error, request, reply) => {
        if (error.name === 'ValidationError' || (error as { statusCode?: number }).statusCode === 400) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: error.message,
            },
          });
        }
        return reply.status(500).send({ error: error.message });
      });
      await registerExtensionRoutes(testServer);
      await testServer.ready();

      const response = await testServer.inject({
        method: 'POST',
        url: '/extensions/gov/invoke',
        payload: {
          type: 'invalid-type',
          agent: testAgent,
        },
      });

      expect(response.statusCode).toBe(400);

      await testServer.close();
    });

    it('should reject unauthorized users', async () => {
      const unauthorizedServer = Fastify();
      unauthorizedServer.addHook('preHandler', async (request) => {
        request.user = {
          sub: 'test-user-id',
          tenantId: 'test-tenant-id',
          roles: ['extension_reader'], // Can read but not invoke
        };
      });
      unauthorizedServer.setErrorHandler((error, request, reply) => {
        if (error.name === 'ForbiddenError' || (error as { statusCode?: number }).statusCode === 403) {
          return reply.status(403).send({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: error.message,
            },
          });
        }
        return reply.status(500).send({ error: error.message });
      });
      await registerExtensionRoutes(unauthorizedServer);
      await unauthorizedServer.ready();

      const response = await unauthorizedServer.inject({
        method: 'POST',
        url: '/extensions/gov/invoke',
        payload: {
          type: 'behavior',
          agent: testAgent,
        },
      });

      expect(response.statusCode).toBe(403);

      await unauthorizedServer.close();
    });
  });

  // ==========================================================================
  // EXTENSION STATUS
  // ==========================================================================

  describe('GET /extensions/:id/status - Extension Health', () => {
    it('should return extension status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/extensions/gov/status',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.extensionId).toBe('car-ext-cognigate-v1');
      expect(body.data.status).toBe('healthy');
      expect(body.data.loaded).toBe(true);
      expect(body.data.hooks).toBeDefined();
      expect(body.data.capabilities).toBeDefined();
      expect(body.data.timestamp).toBeDefined();
    });

    it('should include capability information', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/extensions/gov/status',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const capabilities = body.data.capabilities;

      expect(capabilities.hasCapabilityHooks).toBe(true);
      expect(capabilities.hasActionHooks).toBe(true);
      expect(capabilities.hasMonitoringHooks).toBe(true);
      expect(capabilities.hasTrustHooks).toBe(true);
      expect(capabilities.hasPolicyEngine).toBe(true);
    });

    it('should return 404 for non-existent extension', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/extensions/non-existent/status',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ==========================================================================
  // AUTHORIZATION CHECKS
  // ==========================================================================

  describe('Authorization', () => {
    it('should allow admin role for all operations', async () => {
      const adminServer = Fastify();
      adminServer.addHook('preHandler', async (request) => {
        request.user = { roles: ['admin'] };
      });
      await registerExtensionRoutes(adminServer);
      await adminServer.ready();

      // List
      const listResponse = await adminServer.inject({
        method: 'GET',
        url: '/extensions',
      });
      expect(listResponse.statusCode).toBe(200);

      // Get
      const getResponse = await adminServer.inject({
        method: 'GET',
        url: '/extensions/gov',
      });
      expect(getResponse.statusCode).toBe(200);

      // Status
      const statusResponse = await adminServer.inject({
        method: 'GET',
        url: '/extensions/gov/status',
      });
      expect(statusResponse.statusCode).toBe(200);

      // Invoke
      const invokeResponse = await adminServer.inject({
        method: 'POST',
        url: '/extensions/gov/invoke',
        payload: {
          type: 'behavior',
          agent: {
            did: 'did:web:test',
            carId: 'a3i.test:FHC-L3@1.0.0',
            publisher: 'test',
            name: 'Test',
            trustTier: 3,
            trustScore: 650,
            domains: 7,
            level: 3,
            version: '1.0.0',
          },
        },
      });
      expect(invokeResponse.statusCode).toBe(200);

      await adminServer.close();
    });

    it('should allow extension_reader for read operations only', async () => {
      const readerServer = Fastify();
      readerServer.addHook('preHandler', async (request) => {
        request.user = { roles: ['extension_reader'] };
      });
      await registerExtensionRoutes(readerServer);
      await readerServer.ready();

      // List - should succeed
      const listResponse = await readerServer.inject({
        method: 'GET',
        url: '/extensions',
      });
      expect(listResponse.statusCode).toBe(200);

      // Get - should succeed
      const getResponse = await readerServer.inject({
        method: 'GET',
        url: '/extensions/gov',
      });
      expect(getResponse.statusCode).toBe(200);

      // Status - should succeed
      const statusResponse = await readerServer.inject({
        method: 'GET',
        url: '/extensions/gov/status',
      });
      expect(statusResponse.statusCode).toBe(200);

      // Invoke - should fail
      const invokeResponse = await readerServer.inject({
        method: 'POST',
        url: '/extensions/gov/invoke',
        payload: {
          type: 'behavior',
          agent: {
            did: 'did:web:test',
            carId: 'a3i.test:FHC-L3@1.0.0',
            publisher: 'test',
            name: 'Test',
            trustTier: 3,
            trustScore: 650,
            domains: 7,
            level: 3,
            version: '1.0.0',
          },
        },
      });
      expect(invokeResponse.statusCode).toBe(403);

      await readerServer.close();
    });

    it('should reject users with no relevant roles', async () => {
      const noRolesServer = Fastify();
      noRolesServer.addHook('preHandler', async (request) => {
        request.user = { roles: [] };
      });
      await registerExtensionRoutes(noRolesServer);
      await noRolesServer.ready();

      const response = await noRolesServer.inject({
        method: 'GET',
        url: '/extensions',
      });

      expect(response.statusCode).toBe(403);

      await noRolesServer.close();
    });

    it('should reject users with undefined roles', async () => {
      const undefinedRolesServer = Fastify();
      undefinedRolesServer.addHook('preHandler', async (request) => {
        request.user = {};
      });
      await registerExtensionRoutes(undefinedRolesServer);
      await undefinedRolesServer.ready();

      const response = await undefinedRolesServer.inject({
        method: 'GET',
        url: '/extensions',
      });

      expect(response.statusCode).toBe(403);

      await undefinedRolesServer.close();
    });
  });

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('should handle Zod validation errors', async () => {
      // Set up error handler for validation errors
      const testServer = Fastify();
      testServer.addHook('preHandler', async (request) => {
        request.user = { roles: ['admin'] };
      });
      testServer.setErrorHandler((error, request, reply) => {
        if (error.name === 'ValidationError' || (error as { statusCode?: number }).statusCode === 400) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: error.message,
            },
          });
        }
        return reply.status(500).send({ error: error.message });
      });
      await registerExtensionRoutes(testServer);
      await testServer.ready();

      const response = await testServer.inject({
        method: 'POST',
        url: '/extensions/gov/invoke',
        payload: {
          type: 'capability',
          agent: {
            // Missing required fields
            did: 'did:web:test',
          },
          request: {},
        },
      });

      expect(response.statusCode).toBe(400);

      await testServer.close();
    });

    it('should handle invalid JSON body', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/extensions/gov/invoke',
        headers: {
          'content-type': 'application/json',
        },
        payload: '{invalid json}',
      });

      expect(response.statusCode).toBe(400);
    });

    it('should include request metadata in responses', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/extensions',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.meta).toBeDefined();
      expect(body.meta.timestamp).toBeDefined();
    });
  });

  // ==========================================================================
  // EXTENSION ROLES CONFIGURATION
  // ==========================================================================

  describe('Extension Roles Configuration', () => {
    it('should export correct read roles', () => {
      expect(EXTENSION_ROLES.READ).toContain('admin');
      expect(EXTENSION_ROLES.READ).toContain('tenant:admin');
      expect(EXTENSION_ROLES.READ).toContain('extension:admin');
      expect(EXTENSION_ROLES.READ).toContain('extension_reader');
      expect(EXTENSION_ROLES.READ).toContain('agent:operator');
    });

    it('should export correct invoke roles', () => {
      expect(EXTENSION_ROLES.INVOKE).toContain('admin');
      expect(EXTENSION_ROLES.INVOKE).toContain('tenant:admin');
      expect(EXTENSION_ROLES.INVOKE).toContain('extension:admin');
      expect(EXTENSION_ROLES.INVOKE).toContain('agent:operator');
    });
  });
});
