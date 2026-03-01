/**
 * Cognigate API - Load Test
 *
 * Simulates sustained production traffic with a mixed workload.
 * Ramps from 10 to 50 VUs over 5 minutes and back down.
 *
 * Workload distribution:
 *   40% - Trust reads      (GET /trust/:agentId)
 *   30% - Intent submissions (POST /intents)
 *   20% - Proof reads      (GET /proofs/entity/:entityId)
 *   10% - Agent CRUD       (POST/GET/PATCH/DELETE /agents)
 *
 * Usage:
 *   k6 run testing/load/k6-load.js
 *   k6 run -e BASE_URL=https://staging.example.com/api/v1 testing/load/k6-load.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

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
const trustReadDuration = new Trend('cognigate_trust_read_duration', true);
const intentSubmitDuration = new Trend('cognigate_intent_submit_duration', true);
const proofReadDuration = new Trend('cognigate_proof_read_duration', true);
const agentCrudDuration = new Trend('cognigate_agent_crud_duration', true);
const successfulRequests = new Counter('cognigate_successful_requests');

// ---------------------------------------------------------------------------
// k6 options
// ---------------------------------------------------------------------------

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp up to 10 VUs
    { duration: '1m',  target: 30 },   // Ramp up to 30 VUs
    { duration: '2m',  target: 50 },   // Sustain 50 VUs (peak)
    { duration: '1m',  target: 20 },   // Ramp down to 20
    { duration: '30s', target: 10 },   // Ramp down to 10
  ],
  tags: { testType: 'load' },
  thresholds: {
    http_req_failed: ['rate<0.01'],                    // < 1% errors overall
    http_req_duration: ['p(95)<500'],                  // p95 < 500ms
    cognigate_errors: ['rate<0.01'],
    cognigate_trust_read_duration: ['p(95)<300'],      // Trust reads should be fast
    cognigate_intent_submit_duration: ['p(95)<500'],
    cognigate_proof_read_duration: ['p(95)<400'],
    cognigate_agent_crud_duration: ['p(95)<500'],
  },
};

// ---------------------------------------------------------------------------
// Setup: create a pool of agents for the test
// ---------------------------------------------------------------------------

export function setup() {
  const agents = [];

  // Pre-register a pool of agents for VUs to use
  for (let i = 0; i < 10; i++) {
    const payload = JSON.stringify({
      name: `k6-load-pool-${i}-${Date.now()}`,
      capabilities: ['read_data', 'write_reports', 'analyze_data'],
      observationTier: 'GRAY_BOX',
    });

    const res = http.post(`${BASE_URL}/agents`, payload, {
      headers: HEADERS,
      tags: { endpoint: 'setup_agents' },
    });

    if (res.status === 201) {
      const body = res.json();
      agents.push({
        id: body.id || body.agentId,
        name: body.name || `k6-load-pool-${i}`,
      });
    }
  }

  if (agents.length === 0) {
    console.warn(
      'WARNING: No agents were created during setup. ' +
      'Tests will create agents on-the-fly, which may affect metrics.',
    );
  }

  return { agents };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pick a random element from an array. */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Weighted random selection. Returns the index. */
function weightedRandom(weights) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

/**
 * Ensure we have a valid agentId. Uses the pool from setup()
 * or creates one on-the-fly if the pool is empty.
 */
function getAgentId(data) {
  if (data.agents && data.agents.length > 0) {
    return pick(data.agents).id;
  }

  // Fallback: create one
  const payload = JSON.stringify({
    name: `k6-load-fallback-${__VU}-${__ITER}-${Date.now()}`,
    capabilities: ['read_data'],
    observationTier: 'GRAY_BOX',
  });
  const res = http.post(`${BASE_URL}/agents`, payload, {
    headers: HEADERS,
    tags: { endpoint: 'agents_create_fallback' },
  });
  if (res.status === 201) {
    const body = res.json();
    return body.id || body.agentId;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scenario functions
// ---------------------------------------------------------------------------

/** 40% - Trust reads */
function trustRead(agentId) {
  const res = http.get(`${BASE_URL}/trust/${agentId}`, {
    headers: HEADERS,
    tags: { endpoint: 'trust_get', operation: 'trust_read' },
  });
  trustReadDuration.add(res.timings.duration);

  const ok = check(res, {
    'trust read status 200': (r) => r.status === 200,
    'trust read latency < 500ms': (r) => r.timings.duration < 500,
  });
  if (ok) successfulRequests.add(1);
  else errorRate.add(1);
}

/** 30% - Intent submissions */
function intentSubmit(agentId) {
  const actions = [
    { type: 'read_database', resource: '/data/market-prices', actionType: 'read', dataSensitivity: 'INTERNAL', reversibility: 'REVERSIBLE' },
    { type: 'write_file', resource: '/reports/summary.pdf', actionType: 'write', dataSensitivity: 'INTERNAL', reversibility: 'REVERSIBLE' },
    { type: 'call_api', resource: 'https://api.example.com/data', actionType: 'execute', dataSensitivity: 'PUBLIC', reversibility: 'REVERSIBLE' },
    { type: 'delete_record', resource: '/data/old-entry-42', actionType: 'delete', dataSensitivity: 'CONFIDENTIAL', reversibility: 'IRREVERSIBLE' },
  ];

  const action = pick(actions);

  const payload = JSON.stringify({
    agentId: agentId,
    agentName: 'k6-load-agent',
    capabilities: ['read_data', 'write_reports'],
    observationTier: 'GRAY_BOX',
    action: {
      type: action.type,
      resource: action.resource,
    },
    actionType: action.actionType,
    dataSensitivity: action.dataSensitivity,
    reversibility: action.reversibility,
  });

  const res = http.post(`${BASE_URL}/intents`, payload, {
    headers: HEADERS,
    tags: { endpoint: 'intents_submit', operation: 'intent_submit' },
  });
  intentSubmitDuration.add(res.timings.duration);

  const ok = check(res, {
    'intent submit status 200': (r) => r.status === 200,
    'intent submit latency < 500ms': (r) => r.timings.duration < 500,
  });
  if (ok) successfulRequests.add(1);
  else errorRate.add(1);
}

/** 20% - Proof reads */
function proofRead(agentId) {
  const res = http.get(`${BASE_URL}/proofs/entity/${agentId}?limit=20`, {
    headers: HEADERS,
    tags: { endpoint: 'proofs_by_entity', operation: 'proof_read' },
  });
  proofReadDuration.add(res.timings.duration);

  const ok = check(res, {
    'proof read status 200': (r) => r.status === 200,
    'proof read latency < 500ms': (r) => r.timings.duration < 500,
  });
  if (ok) successfulRequests.add(1);
  else errorRate.add(1);
}

/** 10% - Agent CRUD (create, read, update, then delete) */
function agentCrud() {
  // Create
  const name = `k6-load-crud-${__VU}-${__ITER}-${Date.now()}`;
  const createPayload = JSON.stringify({
    name: name,
    capabilities: ['read_data'],
    observationTier: 'GRAY_BOX',
  });

  const createRes = http.post(`${BASE_URL}/agents`, createPayload, {
    headers: HEADERS,
    tags: { endpoint: 'agents_create', operation: 'agent_crud' },
  });
  agentCrudDuration.add(createRes.timings.duration);

  let crudOk = check(createRes, {
    'agent create status 201': (r) => r.status === 201,
  });

  if (createRes.status !== 201) {
    errorRate.add(1);
    return;
  }

  const body = createRes.json();
  const newId = body.id || body.agentId;

  // Read
  const getRes = http.get(`${BASE_URL}/agents/${newId}`, {
    headers: HEADERS,
    tags: { endpoint: 'agents_get', operation: 'agent_crud' },
  });
  agentCrudDuration.add(getRes.timings.duration);
  crudOk = check(getRes, {
    'agent get status 200': (r) => r.status === 200,
  });

  // Update
  const updatePayload = JSON.stringify({
    name: `${name}-updated`,
    capabilities: ['read_data', 'analyze_data'],
  });
  const updateRes = http.patch(`${BASE_URL}/agents/${newId}`, updatePayload, {
    headers: HEADERS,
    tags: { endpoint: 'agents_update', operation: 'agent_crud' },
  });
  agentCrudDuration.add(updateRes.timings.duration);
  crudOk = check(updateRes, {
    'agent update status 200': (r) => r.status === 200,
  });

  // Delete
  const deleteRes = http.del(`${BASE_URL}/agents/${newId}`, null, {
    headers: HEADERS,
    tags: { endpoint: 'agents_delete', operation: 'agent_crud' },
  });
  agentCrudDuration.add(deleteRes.timings.duration);
  crudOk = check(deleteRes, {
    'agent delete status 204': (r) => r.status === 204,
  });

  if (crudOk) successfulRequests.add(1);
  else errorRate.add(1);
}

// ---------------------------------------------------------------------------
// Default function (main test loop)
// ---------------------------------------------------------------------------

export default function (data) {
  const agentId = getAgentId(data);

  // Weighted random scenario selection:
  //   0 = trust read (40%), 1 = intent submit (30%),
  //   2 = proof read (20%), 3 = agent CRUD (10%)
  const scenario = weightedRandom([40, 30, 20, 10]);

  switch (scenario) {
    case 0:
      if (agentId) trustRead(agentId);
      break;
    case 1:
      if (agentId) intentSubmit(agentId);
      break;
    case 2:
      if (agentId) proofRead(agentId);
      break;
    case 3:
      agentCrud();
      break;
  }

  // Brief pause between iterations (50-150ms) to simulate real client behavior
  sleep(0.05 + Math.random() * 0.1);
}

// ---------------------------------------------------------------------------
// Teardown: clean up pool agents
// ---------------------------------------------------------------------------

export function teardown(data) {
  if (!data.agents) return;

  for (const agent of data.agents) {
    http.del(`${BASE_URL}/agents/${agent.id}`, null, {
      headers: HEADERS,
      tags: { endpoint: 'teardown_delete' },
    });
  }
}
