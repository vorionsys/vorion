/**
 * Cognigate API - Smoke Test
 *
 * Verifies all API endpoints are functional under minimal load.
 * Run this before any other load test to confirm the API is operational.
 *
 * Config: 1 VU, 30 seconds
 *
 * Usage:
 *   k6 run testing/load/k6-smoke.js
 *   k6 run -e BASE_URL=https://staging.example.com/api/v1 testing/load/k6-smoke.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api/v1';
const API_KEY = __ENV.API_KEY || 'vorion-dev-key-12345';

const HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${API_KEY}`,
};

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const errorRate = new Rate('cognigate_errors');
const healthDuration = new Trend('cognigate_health_duration', true);
const agentDuration = new Trend('cognigate_agent_duration', true);
const trustDuration = new Trend('cognigate_trust_duration', true);
const intentDuration = new Trend('cognigate_intent_duration', true);
const proofDuration = new Trend('cognigate_proof_duration', true);

// ---------------------------------------------------------------------------
// k6 options
// ---------------------------------------------------------------------------

export const options = {
  vus: 1,
  duration: '30s',
  tags: { testType: 'smoke' },
  thresholds: {
    http_req_failed: ['rate<0.01'],               // < 1% errors
    http_req_duration: ['p(95)<500'],              // p95 < 500ms
    cognigate_errors: ['rate<0.01'],               // custom error rate
    cognigate_health_duration: ['p(95)<200'],      // health should be fast
    cognigate_agent_duration: ['p(95)<500'],
    cognigate_trust_duration: ['p(95)<500'],
    cognigate_intent_duration: ['p(95)<500'],
    cognigate_proof_duration: ['p(95)<500'],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique agent name per VU + iteration to avoid collisions. */
function agentName() {
  return `k6-smoke-agent-${__VU}-${__ITER}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Default function (main test loop)
// ---------------------------------------------------------------------------

export default function () {
  let agentId = null;

  // ---- 1. Health checks ---------------------------------------------------
  group('Health checks', () => {
    // GET /health (no auth required)
    const healthRes = http.get(`${BASE_URL}/health`, {
      tags: { endpoint: 'health' },
    });
    healthDuration.add(healthRes.timings.duration);
    check(healthRes, {
      'GET /health status is 200': (r) => r.status === 200,
      'GET /health body has status': (r) => {
        const b = r.json();
        return b && b.status === 'healthy';
      },
      'GET /health has version': (r) => {
        const b = r.json();
        return b && typeof b.version === 'string';
      },
    }) || errorRate.add(1);

    // GET /ready (no auth required)
    const readyRes = http.get(`${BASE_URL}/ready`, {
      tags: { endpoint: 'ready' },
    });
    healthDuration.add(readyRes.timings.duration);
    check(readyRes, {
      'GET /ready status is 200 or 503': (r) =>
        r.status === 200 || r.status === 503,
    }) || errorRate.add(1);

    // GET /live (no auth required)
    const liveRes = http.get(`${BASE_URL}/live`, {
      tags: { endpoint: 'live' },
    });
    healthDuration.add(liveRes.timings.duration);
    check(liveRes, {
      'GET /live status is 200': (r) => r.status === 200,
      'GET /live body has alive=true': (r) => {
        const b = r.json();
        return b && b.alive === true;
      },
    }) || errorRate.add(1);
  });

  sleep(0.5);

  // ---- 2. Agent CRUD ------------------------------------------------------
  group('Agent CRUD', () => {
    const name = agentName();

    // POST /agents - register
    const createPayload = JSON.stringify({
      name: name,
      capabilities: ['read_data', 'write_reports'],
      observationTier: 'GRAY_BOX',
    });

    const createRes = http.post(`${BASE_URL}/agents`, createPayload, {
      headers: HEADERS,
      tags: { endpoint: 'agents_create' },
    });
    agentDuration.add(createRes.timings.duration);

    const createOk = check(createRes, {
      'POST /agents status is 201': (r) => r.status === 201,
      'POST /agents returns agent id': (r) => {
        const b = r.json();
        return b && (typeof b.id === 'string' || typeof b.agentId === 'string');
      },
    });
    if (!createOk) errorRate.add(1);

    // Extract agent ID from response
    if (createRes.status === 201) {
      const body = createRes.json();
      agentId = body.id || body.agentId;
    }

    // GET /agents - list
    const listRes = http.get(`${BASE_URL}/agents?limit=10`, {
      headers: HEADERS,
      tags: { endpoint: 'agents_list' },
    });
    agentDuration.add(listRes.timings.duration);
    check(listRes, {
      'GET /agents status is 200': (r) => r.status === 200,
      'GET /agents returns array': (r) => Array.isArray(r.json()),
    }) || errorRate.add(1);

    // GET /agents/:id
    if (agentId) {
      const getRes = http.get(`${BASE_URL}/agents/${agentId}`, {
        headers: HEADERS,
        tags: { endpoint: 'agents_get' },
      });
      agentDuration.add(getRes.timings.duration);
      check(getRes, {
        'GET /agents/:id status is 200': (r) => r.status === 200,
      }) || errorRate.add(1);

      // PATCH /agents/:id
      const updatePayload = JSON.stringify({
        name: `${name}-updated`,
        capabilities: ['read_data', 'write_reports', 'analyze_data'],
      });
      const updateRes = http.patch(
        `${BASE_URL}/agents/${agentId}`,
        updatePayload,
        {
          headers: HEADERS,
          tags: { endpoint: 'agents_update' },
        },
      );
      agentDuration.add(updateRes.timings.duration);
      check(updateRes, {
        'PATCH /agents/:id status is 200': (r) => r.status === 200,
      }) || errorRate.add(1);
    }
  });

  sleep(0.5);

  // ---- 3. Trust operations ------------------------------------------------
  group('Trust operations', () => {
    if (!agentId) return;

    // GET /trust/tiers
    const tiersRes = http.get(`${BASE_URL}/trust/tiers`, {
      headers: HEADERS,
      tags: { endpoint: 'trust_tiers' },
    });
    trustDuration.add(tiersRes.timings.duration);
    check(tiersRes, {
      'GET /trust/tiers status is 200': (r) => r.status === 200,
      'GET /trust/tiers has tiers': (r) => {
        const b = r.json();
        return b && (Array.isArray(b.tiers) || Array.isArray(b));
      },
    }) || errorRate.add(1);

    // GET /trust/:agentId
    const trustRes = http.get(`${BASE_URL}/trust/${agentId}`, {
      headers: HEADERS,
      tags: { endpoint: 'trust_get' },
    });
    trustDuration.add(trustRes.timings.duration);
    check(trustRes, {
      'GET /trust/:agentId status is 200': (r) => r.status === 200,
    }) || errorRate.add(1);

    // POST /trust/:agentId/signal
    const signalPayload = JSON.stringify({
      type: 'success',
      source: 'k6-smoke-test',
      weight: 0.5,
      context: {
        testRun: 'smoke',
        iteration: __ITER,
      },
    });
    const signalRes = http.post(
      `${BASE_URL}/trust/${agentId}/signal`,
      signalPayload,
      {
        headers: HEADERS,
        tags: { endpoint: 'trust_signal' },
      },
    );
    trustDuration.add(signalRes.timings.duration);
    check(signalRes, {
      'POST /trust/:agentId/signal status is 200': (r) => r.status === 200,
    }) || errorRate.add(1);

    // GET /trust/:agentId/history
    const historyRes = http.get(
      `${BASE_URL}/trust/${agentId}/history?limit=10`,
      {
        headers: HEADERS,
        tags: { endpoint: 'trust_history' },
      },
    );
    trustDuration.add(historyRes.timings.duration);
    check(historyRes, {
      'GET /trust/:agentId/history status is 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  sleep(0.5);

  // ---- 4. Intent submission -----------------------------------------------
  group('Intent submission', () => {
    if (!agentId) return;

    // POST /intents
    const intentPayload = JSON.stringify({
      agentId: agentId,
      agentName: 'k6-smoke-agent',
      capabilities: ['read_data'],
      observationTier: 'GRAY_BOX',
      action: {
        type: 'read_database',
        resource: '/data/market-prices',
      },
      actionType: 'read',
      dataSensitivity: 'INTERNAL',
      reversibility: 'REVERSIBLE',
    });

    const intentRes = http.post(`${BASE_URL}/intents`, intentPayload, {
      headers: HEADERS,
      tags: { endpoint: 'intents_submit' },
    });
    intentDuration.add(intentRes.timings.duration);
    check(intentRes, {
      'POST /intents status is 200': (r) => r.status === 200,
      'POST /intents returns decision': (r) => {
        const b = r.json();
        return b && (b.decision !== undefined || b.status !== undefined || b.allowed !== undefined);
      },
    }) || errorRate.add(1);

    // POST /intents/check (dry-run)
    const checkPayload = JSON.stringify({
      agentId: agentId,
      agentName: 'k6-smoke-agent',
      capabilities: ['read_data'],
      observationTier: 'GRAY_BOX',
      action: {
        type: 'write_file',
        resource: '/data/output.csv',
      },
      actionType: 'write',
      dataSensitivity: 'CONFIDENTIAL',
      reversibility: 'IRREVERSIBLE',
    });

    const checkRes = http.post(`${BASE_URL}/intents/check`, checkPayload, {
      headers: HEADERS,
      tags: { endpoint: 'intents_check' },
    });
    intentDuration.add(checkRes.timings.duration);
    check(checkRes, {
      'POST /intents/check status is 200': (r) => r.status === 200,
    }) || errorRate.add(1);

    // GET /intents/metrics
    const metricsRes = http.get(`${BASE_URL}/intents/metrics`, {
      headers: HEADERS,
      tags: { endpoint: 'intents_metrics' },
    });
    intentDuration.add(metricsRes.timings.duration);
    check(metricsRes, {
      'GET /intents/metrics status is 200': (r) => r.status === 200,
    }) || errorRate.add(1);

    // GET /intents/agent/:agentId
    const agentIntentsRes = http.get(
      `${BASE_URL}/intents/agent/${agentId}?limit=10`,
      {
        headers: HEADERS,
        tags: { endpoint: 'intents_by_agent' },
      },
    );
    intentDuration.add(agentIntentsRes.timings.duration);
    check(agentIntentsRes, {
      'GET /intents/agent/:agentId status is 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  sleep(0.5);

  // ---- 5. Proof operations ------------------------------------------------
  group('Proof operations', () => {
    if (!agentId) return;

    // POST /proofs/verify
    const verifyPayload = JSON.stringify({
      entityId: agentId,
    });
    const verifyRes = http.post(`${BASE_URL}/proofs/verify`, verifyPayload, {
      headers: HEADERS,
      tags: { endpoint: 'proofs_verify' },
    });
    proofDuration.add(verifyRes.timings.duration);
    check(verifyRes, {
      'POST /proofs/verify status is 200': (r) => r.status === 200,
    }) || errorRate.add(1);

    // GET /proofs/entity/:entityId
    const entityProofsRes = http.get(
      `${BASE_URL}/proofs/entity/${agentId}?limit=10`,
      {
        headers: HEADERS,
        tags: { endpoint: 'proofs_by_entity' },
      },
    );
    proofDuration.add(entityProofsRes.timings.duration);
    check(entityProofsRes, {
      'GET /proofs/entity/:entityId status is 200': (r) =>
        r.status === 200,
    }) || errorRate.add(1);

    // GET /proofs/metrics
    const proofMetricsRes = http.get(`${BASE_URL}/proofs/metrics`, {
      headers: HEADERS,
      tags: { endpoint: 'proofs_metrics' },
    });
    proofDuration.add(proofMetricsRes.timings.duration);
    check(proofMetricsRes, {
      'GET /proofs/metrics status is 200': (r) => r.status === 200,
    }) || errorRate.add(1);

    // POST /proofs/flush
    const flushRes = http.post(`${BASE_URL}/proofs/flush`, null, {
      headers: HEADERS,
      tags: { endpoint: 'proofs_flush' },
    });
    proofDuration.add(flushRes.timings.duration);
    check(flushRes, {
      'POST /proofs/flush status is 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  sleep(0.5);

  // ---- 6. Cleanup - delete the agent --------------------------------------
  group('Cleanup', () => {
    if (!agentId) return;

    const deleteRes = http.del(`${BASE_URL}/agents/${agentId}`, null, {
      headers: HEADERS,
      tags: { endpoint: 'agents_delete' },
    });
    agentDuration.add(deleteRes.timings.duration);
    check(deleteRes, {
      'DELETE /agents/:id status is 204': (r) => r.status === 204,
    }) || errorRate.add(1);
  });

  sleep(1);
}
