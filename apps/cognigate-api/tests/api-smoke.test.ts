/**
 * Cognigate API Smoke Tests
 *
 * Boots the Fastify server with in-memory storage and exercises
 * every major route to verify wiring is correct.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

let server: FastifyInstance;

beforeAll(async () => {
  const result = await createServer({
    port: 0, // random port
    host: '127.0.0.1',
    logLevel: 'silent',
    enableAuth: false, // skip auth for smoke tests
  });
  server = result.server;
  await server.ready();
});

afterAll(async () => {
  if (server) {
    await server.close();
  }
});

// ===========================================================================
// Health endpoints
// ===========================================================================

describe('Health', () => {
  it('GET /api/v1/health returns healthy status', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('healthy');
    expect(body.version).toBe('0.1.0');
    expect(body.timestamp).toBeDefined();
  });

  it('GET /api/v1/ready returns readiness', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ready).toBe(true);
  });

  it('GET /api/v1/live returns alive', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/live' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.alive).toBe(true);
  });
});

// ===========================================================================
// Agent CRUD
// ===========================================================================

describe('Agents', () => {
  let agentId: string;

  it('POST /api/v1/agents registers a new agent', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/agents',
      payload: {
        name: 'smoke-test-agent',
        capabilities: ['read', 'write'],
        observationTier: 'GRAY_BOX',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.agentId).toBeDefined();
    expect(body.name).toBe('smoke-test-agent');
    expect(body.trustScore).toBeGreaterThanOrEqual(0);
    expect(body.trustTier).toBeDefined();
    expect(body.trustTierName).toBeDefined();
    agentId = body.agentId;
  });

  it('GET /api/v1/agents/:agentId returns the agent', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/agents/${agentId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.agentId).toBe(agentId);
    expect(body.name).toBeDefined();
  });

  it('GET /api/v1/agents lists agents', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/agents' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/v1/agents/:unknown returns 404', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/agents/nonexistent-agent-xyz',
    });
    expect(res.statusCode).toBe(404);
  });
});

// ===========================================================================
// Intent lifecycle
// ===========================================================================

describe('Intents', () => {
  let intentId: string;
  let agentId: string;

  beforeAll(async () => {
    // Register agent for intent tests
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/agents',
      payload: { name: 'intent-test-agent' },
    });
    agentId = JSON.parse(res.payload).agentId;
  });

  it('POST /api/v1/intents submits an intent', async () => {
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
    intentId = body.intentId;
  });

  it('GET /api/v1/intents/:intentId returns the intent', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/intents/${intentId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.intentId).toBe(intentId);
    expect(body.agentId).toBe(agentId);
  });

  it('GET /api/v1/intents/agent/:agentId lists agent intents', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/intents/agent/${agentId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/v1/intents/check performs a dry-run', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/intents/check',
      payload: {
        agentId,
        action: { type: 'delete', resource: 'users' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(typeof body.wouldAllow).toBe('boolean');
    expect(body.tier).toBeDefined();
  });

  it('GET /api/v1/intents/metrics returns pipeline metrics', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/intents/metrics',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toBeDefined();
  });

  it('PATCH /api/v1/intents/:intentId updates priority', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/v1/intents/${intentId}`,
      payload: { priority: 5 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.priority).toBe(5);
  });

  it('GET /api/v1/intents/:unknown returns 404', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/intents/nonexistent-intent-xyz',
    });
    expect(res.statusCode).toBe(404);
  });
});

// ===========================================================================
// Trust endpoints
// ===========================================================================

describe('Trust', () => {
  it('GET /api/v1/trust/tiers returns tier definitions', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/trust/tiers' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    // Route returns { tiers: [...] } object
    expect(body.tiers).toBeDefined();
    expect(Array.isArray(body.tiers)).toBe(true);
    expect(body.tiers.length).toBeGreaterThan(0);
    expect(body.tiers[0]).toHaveProperty('name');
    expect(body.tiers[0]).toHaveProperty('minScore');
  });
});

// ===========================================================================
// Proof endpoints
// ===========================================================================

describe('Proofs', () => {
  it('GET /api/v1/proofs/metrics returns proof metrics', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/proofs/metrics' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toBeDefined();
  });

  it('POST /api/v1/proofs/flush forces a flush', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/v1/proofs/flush' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.flushed).toBe(true);
  });
});

// ===========================================================================
// Swagger / OpenAPI
// ===========================================================================

describe('OpenAPI', () => {
  it('GET /docs returns Swagger UI', async () => {
    const res = await server.inject({ method: 'GET', url: '/docs' });
    // Swagger UI redirects to /docs/ or returns HTML
    expect([200, 302]).toContain(res.statusCode);
  });
});

// ===========================================================================
// Error handling
// ===========================================================================

describe('Error handling', () => {
  it('GET /nonexistent returns 404 with error response', async () => {
    const res = await server.inject({ method: 'GET', url: '/nonexistent' });
    expect(res.statusCode).toBe(404);
  });
});
