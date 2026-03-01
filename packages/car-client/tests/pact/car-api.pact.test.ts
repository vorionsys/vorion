/**
 * Pact Consumer Contract Tests — CAR Client → CAR API
 *
 * These tests define the contract between the CAR Client SDK (consumer)
 * and the Phase 6 Trust Engine API (provider).
 *
 * Contract tests verify:
 * - The client sends correctly formatted requests
 * - The client correctly handles expected API responses
 * - Breaking API changes are detected before deployment
 *
 * Usage:
 *   npx vitest run tests/pact/
 *   # Then publish pacts:
 *   npx pact-broker publish ./pacts --consumer-app-version=$(git rev-parse HEAD)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { PactV4, MatchersV3 } from '@pact-foundation/pact';
import path from 'path';

const { like, eachLike, string, integer, boolean, regex } = MatchersV3;

const provider = new PactV4({
  consumer: 'car-client',
  provider: 'car-api',
  dir: path.resolve(__dirname, '../../pacts'),
  logLevel: 'warn',
});

describe('CAR Client → CAR API Contract', () => {
  describe('GET /api/v1/car/stats — Dashboard Stats', () => {
    it('returns dashboard statistics', async () => {
      await provider
        .addInteraction()
        .given('the API is healthy')
        .uponReceiving('a request for dashboard stats')
        .withRequest('GET', '/api/v1/car/stats', (builder) => {
          builder.headers({ Accept: 'application/json' });
        })
        .willRespondWith(200, (builder) => {
          builder.headers({ 'Content-Type': 'application/json' });
          builder.jsonBody({
            success: boolean(true),
            data: like({
              totalAgents: integer(42),
              totalEvaluations: integer(1500),
              activeAlerts: integer(3),
            }),
          });
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(`${mockServer.url}/api/v1/car/stats`, {
            headers: { Accept: 'application/json' },
          });
          const body = await response.json();
          expect(response.status).toBe(200);
          expect(body.success).toBe(true);
          expect(body.data.totalAgents).toBeDefined();
        });
    });
  });

  describe('POST /api/v1/car/role-gate/evaluate — Role Gate Evaluation', () => {
    it('evaluates a role gate request', async () => {
      await provider
        .addInteraction()
        .given('agent agent-123 exists with trust tier T3')
        .uponReceiving('a role gate evaluation request')
        .withRequest('POST', '/api/v1/car/role-gate/evaluate', (builder) => {
          builder.headers({
            'Content-Type': 'application/json',
            Accept: 'application/json',
          });
          builder.jsonBody({
            agentId: string('agent-123'),
            requestedRole: string('R_L3'),
            currentTier: string('T3'),
          });
        })
        .willRespondWith(200, (builder) => {
          builder.headers({ 'Content-Type': 'application/json' });
          builder.jsonBody({
            success: boolean(true),
            data: like({
              allowed: boolean(true),
              agentId: string('agent-123'),
              role: string('R_L3'),
              reason: string('Trust tier meets requirements'),
            }),
          });
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(
            `${mockServer.url}/api/v1/car/role-gate/evaluate`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: JSON.stringify({
                agentId: 'agent-123',
                requestedRole: 'R_L3',
                currentTier: 'T3',
              }),
            },
          );
          const body = await response.json();
          expect(response.status).toBe(200);
          expect(body.success).toBe(true);
          expect(body.data.allowed).toBe(true);
        });
    });

    it('denies insufficient trust tier', async () => {
      await provider
        .addInteraction()
        .given('agent low-trust exists with trust tier T1')
        .uponReceiving('a role gate evaluation for insufficient tier')
        .withRequest('POST', '/api/v1/car/role-gate/evaluate', (builder) => {
          builder.headers({
            'Content-Type': 'application/json',
            Accept: 'application/json',
          });
          builder.jsonBody({
            agentId: string('low-trust'),
            requestedRole: string('R_L5'),
            currentTier: string('T1'),
          });
        })
        .willRespondWith(200, (builder) => {
          builder.headers({ 'Content-Type': 'application/json' });
          builder.jsonBody({
            success: boolean(true),
            data: like({
              allowed: boolean(false),
              agentId: string('low-trust'),
              role: string('R_L5'),
              reason: string('Insufficient trust tier'),
            }),
          });
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(
            `${mockServer.url}/api/v1/car/role-gate/evaluate`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: JSON.stringify({
                agentId: 'low-trust',
                requestedRole: 'R_L5',
                currentTier: 'T1',
              }),
            },
          );
          const body = await response.json();
          expect(body.data.allowed).toBe(false);
        });
    });
  });

  describe('POST /api/v1/car/ceiling/check — Ceiling Check', () => {
    it('checks observability ceiling for an agent', async () => {
      await provider
        .addInteraction()
        .given('agent agent-456 has GRAY_BOX observability')
        .uponReceiving('a ceiling check request')
        .withRequest('POST', '/api/v1/car/ceiling/check', (builder) => {
          builder.headers({
            'Content-Type': 'application/json',
            Accept: 'application/json',
          });
          builder.jsonBody({
            agentId: string('agent-456'),
            requestedTier: string('T4'),
            observabilityClass: string('GRAY_BOX'),
          });
        })
        .willRespondWith(200, (builder) => {
          builder.headers({ 'Content-Type': 'application/json' });
          builder.jsonBody({
            success: boolean(true),
            data: like({
              allowed: boolean(true),
              maxTier: string('T4'),
              ceiling: integer(799),
            }),
          });
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(
            `${mockServer.url}/api/v1/car/ceiling/check`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: JSON.stringify({
                agentId: 'agent-456',
                requestedTier: 'T4',
                observabilityClass: 'GRAY_BOX',
              }),
            },
          );
          const body = await response.json();
          expect(response.status).toBe(200);
          expect(body.data.allowed).toBe(true);
        });
    });
  });

  describe('GET /api/v1/car/provenance/:id — Provenance Record', () => {
    it('retrieves a provenance record by ID', async () => {
      await provider
        .addInteraction()
        .given('provenance record prov-001 exists')
        .uponReceiving('a request for a specific provenance record')
        .withRequest('GET', '/api/v1/car/provenance/prov-001', (builder) => {
          builder.headers({ Accept: 'application/json' });
        })
        .willRespondWith(200, (builder) => {
          builder.headers({ 'Content-Type': 'application/json' });
          builder.jsonBody({
            success: boolean(true),
            data: like({
              id: string('prov-001'),
              agentId: string('agent-123'),
              action: string('TRUST_EVALUATION'),
              timestamp: regex(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
                '2024-01-15T10:30:00Z',
              ),
            }),
          });
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(
            `${mockServer.url}/api/v1/car/provenance/prov-001`,
            { headers: { Accept: 'application/json' } },
          );
          const body = await response.json();
          expect(response.status).toBe(200);
          expect(body.data.id).toBe('prov-001');
        });
    });

    it('returns 404 for unknown provenance', async () => {
      await provider
        .addInteraction()
        .given('no provenance record exists with ID unknown')
        .uponReceiving('a request for a non-existent provenance record')
        .withRequest('GET', '/api/v1/car/provenance/unknown', (builder) => {
          builder.headers({ Accept: 'application/json' });
        })
        .willRespondWith(404, (builder) => {
          builder.headers({ 'Content-Type': 'application/json' });
          builder.jsonBody({
            success: boolean(false),
            error: like({
              code: string('NOT_FOUND'),
              message: string('Provenance record not found'),
            }),
          });
        })
        .executeTest(async (mockServer) => {
          const response = await fetch(
            `${mockServer.url}/api/v1/car/provenance/unknown`,
            { headers: { Accept: 'application/json' } },
          );
          expect(response.status).toBe(404);
        });
    });
  });
});
