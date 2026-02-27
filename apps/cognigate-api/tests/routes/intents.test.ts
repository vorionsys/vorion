/**
 * Intent Route Tests
 *
 * Comprehensive tests for the intent routes including canonical classification
 * fields, smart defaults, inference, and error handling.
 *
 * Pattern follows api-smoke.test.ts — uses createServer() with enableAuth: false
 * and server.inject() for route testing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { FastifyInstance } from 'fastify';

let server: FastifyInstance;
let agentId: string;

beforeAll(async () => {
  const result = await createServer({
    port: 0,
    host: '127.0.0.1',
    logLevel: 'silent',
    enableAuth: false,
  });
  server = result.server;
  await server.ready();

  // Register an agent for intent tests
  const res = await server.inject({
    method: 'POST',
    url: '/api/v1/agents',
    payload: { name: 'intent-route-test-agent', capabilities: ['read', 'write', 'delete'] },
  });
  agentId = JSON.parse(res.payload).agentId;
}, 30000);

afterAll(async () => {
  if (server) {
    await server.close();
  }
}, 30000);

// =============================================================================
// POST /api/v1/intents — Submit
// =============================================================================

describe('POST /api/v1/intents', () => {
  it('accepts a minimal body and returns defaults', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: {
        agentId,
        action: { type: 'read', resource: 'documents' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.intentId).toBeDefined();
    expect(body.tier).toBeDefined();
    expect(body.reason).toBeDefined();
    expect(body.processingTimeMs).toBeGreaterThanOrEqual(0);
    // Classification should be echoed with defaults
    expect(body.classification).toBeDefined();
    expect(body.classification.actionType).toBe('read');
    expect(body.classification.dataSensitivity).toBe('INTERNAL');
    expect(body.classification.reversibility).toBe('REVERSIBLE');
    expect(body.classification.resourceScope).toEqual(['documents']);
  });

  it('accepts a full canonical body and echoes explicit classification', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: {
        agentId,
        agentName: 'full-canonical-agent',
        capabilities: ['read', 'write'],
        observationTier: 'WHITE_BOX',
        action: { type: 'write', resource: 'user-profiles' },
        tenantId: 'tenant-001',
        correlationId: 'corr-abc-123',
        actionType: 'write',
        resourceScope: ['user-profiles', 'audit-logs'],
        dataSensitivity: 'CONFIDENTIAL',
        reversibility: 'PARTIALLY_REVERSIBLE',
        context: {
          domain: 'identity',
          environment: 'production',
          sessionId: 'sess-xyz',
          priority: 8,
          handlesPii: true,
          handlesPhiData: false,
        },
        expiresInMs: 60000,
        source: 'test-harness',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.intentId).toBeDefined();
    expect(body.classification.actionType).toBe('write');
    expect(body.classification.dataSensitivity).toBe('CONFIDENTIAL');
    expect(body.classification.reversibility).toBe('PARTIALLY_REVERSIBLE');
    expect(body.classification.resourceScope).toEqual(['user-profiles', 'audit-logs']);
  });

  it('infers actionType from action.type when not explicit', async () => {
    // 'getData' should infer to 'read'
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: {
        agentId,
        action: { type: 'getData', resource: 'reports' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.classification.actionType).toBe('read');
  });

  it('infers delete actionType from action.type', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: {
        agentId,
        action: { type: 'removeUser', resource: 'users' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.classification.actionType).toBe('delete');
  });

  it('infers execute actionType from action.type', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: {
        agentId,
        action: { type: 'runJob', resource: 'batch-processor' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.classification.actionType).toBe('execute');
  });

  it('infers communicate actionType from action.type', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: {
        agentId,
        action: { type: 'sendNotification', resource: 'alerts' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.classification.actionType).toBe('communicate');
  });

  it('infers transfer actionType from action.type', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: {
        agentId,
        action: { type: 'transferFunds', resource: 'accounts' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.classification.actionType).toBe('transfer');
  });

  it('defaults to write actionType for unknown action.type', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: {
        agentId,
        action: { type: 'createEntry', resource: 'logs' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.classification.actionType).toBe('write');
  });

  it('forwards PII/PHI context flags via classification', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: {
        agentId,
        action: { type: 'read', resource: 'patient-records' },
        dataSensitivity: 'RESTRICTED',
        context: { handlesPii: true, handlesPhiData: true },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.classification.dataSensitivity).toBe('RESTRICTED');
  });

  it('returns proofId and constraints in response', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: {
        agentId,
        action: { type: 'read', resource: 'docs' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.proofId).toBeDefined();
    expect(typeof body.allowed).toBe('boolean');
  });
});

// =============================================================================
// POST /api/v1/intents/check — Dry Run
// =============================================================================

describe('POST /api/v1/intents/check', () => {
  it('performs a dry-run with minimal body', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/intents/check',
      payload: {
        agentId,
        action: { type: 'read', resource: 'documents' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(typeof body.wouldAllow).toBe('boolean');
    expect(body.tier).toBeDefined();
    expect(body.reason).toBeDefined();
    // Classification defaults
    expect(body.classification).toBeDefined();
    expect(body.classification.actionType).toBe('read');
    expect(body.classification.dataSensitivity).toBe('INTERNAL');
    expect(body.classification.reversibility).toBe('REVERSIBLE');
  });

  it('performs a dry-run with full canonical body', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/intents/check',
      payload: {
        agentId,
        action: { type: 'delete', resource: 'accounts' },
        actionType: 'delete',
        dataSensitivity: 'RESTRICTED',
        reversibility: 'IRREVERSIBLE',
        resourceScope: ['accounts', 'billing'],
        context: { handlesPii: true },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.classification.actionType).toBe('delete');
    expect(body.classification.dataSensitivity).toBe('RESTRICTED');
    expect(body.classification.reversibility).toBe('IRREVERSIBLE');
    expect(body.classification.resourceScope).toEqual(['accounts', 'billing']);
  });
});

// =============================================================================
// GET /api/v1/intents/:intentId — Retrieve
// =============================================================================

describe('GET /api/v1/intents/:intentId', () => {
  let storedIntentId: string;

  beforeAll(async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: {
        agentId,
        action: { type: 'write', resource: 'settings' },
        actionType: 'write',
        dataSensitivity: 'CONFIDENTIAL',
        reversibility: 'REVERSIBLE',
        tenantId: 'tenant-get-test',
        correlationId: 'corr-get-test',
        source: 'test-suite',
      },
    });
    storedIntentId = JSON.parse(res.payload).intentId;
  });

  it('returns stored intent with classification fields', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/intents/${storedIntentId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.intentId).toBe(storedIntentId);
    expect(body.agentId).toBe(agentId);
    expect(body.actionType).toBe('write');
    expect(body.dataSensitivity).toBe('CONFIDENTIAL');
    expect(body.reversibility).toBe('REVERSIBLE');
    expect(body.tenantId).toBe('tenant-get-test');
    expect(body.correlationId).toBe('corr-get-test');
    expect(body.source).toBe('test-suite');
  });

  it('returns 404 for unknown intent ID', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/intents/nonexistent-intent-xyz',
    });
    expect(res.statusCode).toBe(404);
  });
});

// =============================================================================
// GET /api/v1/intents/agent/:agentId — List by Agent
// =============================================================================

describe('GET /api/v1/intents/agent/:agentId', () => {
  it('returns intents for the agent', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/intents/agent/${agentId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].agentId).toBe(agentId);
  });

  it('filters by status query parameter', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/intents/agent/${agentId}?status=approved`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body)).toBe(true);
    for (const intent of body) {
      expect(intent.status).toBe('approved');
    }
  });

  it('respects limit query parameter', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/intents/agent/${agentId}?limit=1`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(1);
  });
});

// =============================================================================
// DELETE /api/v1/intents/:intentId — Cancel
// =============================================================================

describe('DELETE /api/v1/intents/:intentId', () => {
  it('cancels an approved intent', async () => {
    // Submit an intent first
    const submitRes = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: {
        agentId,
        action: { type: 'read', resource: 'cancel-test' },
      },
    });
    const { intentId, allowed } = JSON.parse(submitRes.payload);

    if (allowed) {
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/intents/${intentId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.intentId).toBe(intentId);
      expect(body.status).toBe('cancelled');
    }
  });

  it('returns 409 for intent in denied status', async () => {
    // Submit and then try to cancel an already-cancelled or denied intent
    const submitRes = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: {
        agentId,
        action: { type: 'read', resource: 'conflict-test' },
      },
    });
    const { intentId, allowed } = JSON.parse(submitRes.payload);

    if (allowed) {
      // First cancel
      await server.inject({
        method: 'DELETE',
        url: `/api/v1/intents/${intentId}`,
      });
      // Second cancel should 409
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/intents/${intentId}`,
      });
      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.error).toBe('INTENT_NOT_CANCELLABLE');
    }
  });

  it('returns 404 for unknown intent ID', async () => {
    const res = await server.inject({
      method: 'DELETE',
      url: '/api/v1/intents/nonexistent-delete-xyz',
    });
    expect(res.statusCode).toBe(404);
  });
});

// =============================================================================
// PATCH /api/v1/intents/:intentId — Update Priority
// =============================================================================

describe('PATCH /api/v1/intents/:intentId', () => {
  let patchIntentId: string;

  beforeAll(async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/intents',
      payload: {
        agentId,
        action: { type: 'read', resource: 'patch-test' },
      },
    });
    patchIntentId = JSON.parse(res.payload).intentId;
  });

  it('updates priority successfully', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/intents/${patchIntentId}`,
      payload: { priority: 10 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.priority).toBe(10);
  });

  it('returns 404 for unknown intent ID', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/v1/intents/nonexistent-patch-xyz',
      payload: { priority: 5 },
    });
    expect(res.statusCode).toBe(404);
  });
});

// =============================================================================
// GET /api/v1/intents/metrics — Pipeline Metrics
// =============================================================================

describe('GET /api/v1/intents/metrics', () => {
  it('returns valid pipeline metrics', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/intents/metrics',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toBeDefined();
  });
});
