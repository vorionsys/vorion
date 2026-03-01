/**
 * Cognigate API - Stress Test
 *
 * Pushes the API beyond normal operating capacity to find the breaking point.
 * Ramps up to 200 VUs over 10 minutes with relaxed thresholds.
 *
 * Workload distribution:
 *   40% - Trust reads      (GET /trust/:agentId)
 *   30% - Intent submissions (POST /intents)
 *   20% - Proof reads      (GET /proofs/entity/:entityId)
 *   10% - Agent CRUD       (POST/GET/PATCH/DELETE /agents)
 *
 * Usage:
 *   k6 run testing/load/k6-stress.js
 *   k6 run -e BASE_URL=https://staging.example.com/api/v1 testing/load/k6-stress.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

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
const failedRequests = new Counter('cognigate_failed_requests');
const activeVUs = new Gauge('cognigate_active_vus');

// ---------------------------------------------------------------------------
// k6 options
// ---------------------------------------------------------------------------

export const options = {
  stages: [
    { duration: '1m',  target: 10 },    // Warm up
    { duration: '1m',  target: 50 },    // Ramp to moderate load
    { duration: '2m',  target: 100 },   // Ramp to heavy load
    { duration: '2m',  target: 150 },   // Ramp to very heavy load
    { duration: '2m',  target: 200 },   // Peak: 200 VUs
    { duration: '1m',  target: 100 },   // Start ramp down
    { duration: '1m',  target: 0 },     // Cool down
  ],
  tags: { testType: 'stress' },
  thresholds: {
    http_req_failed: ['rate<0.05'],                    // < 5% errors (relaxed)
    http_req_duration: ['p(95)<2000'],                 // p95 < 2s (relaxed)
    cognigate_errors: ['rate<0.05'],
    cognigate_trust_read_duration: ['p(95)<1500'],
    cognigate_intent_submit_duration: ['p(95)<2000'],
    cognigate_proof_read_duration: ['p(95)<1500'],
    cognigate_agent_crud_duration: ['p(95)<2000'],
  },
};

// ---------------------------------------------------------------------------
// Setup: create a larger pool of agents for stress testing
// ---------------------------------------------------------------------------

export function setup() {
  const agents = [];

  // Create a larger pool for stress test to reduce contention
  for (let i = 0; i < 25; i++) {
    const payload = JSON.stringify({
      name: `k6-stress-pool-${i}-${Date.now()}`,
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
        name: body.name || `k6-stress-pool-${i}`,
      });
    }
  }

  console.log(`Stress test setup: created ${agents.length} pool agents`);
  return { agents };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedRandom(weights) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function getAgentId(data) {
  if (data.agents && data.agents.length > 0) {
    return pick(data.agents).id;
  }

  const payload = JSON.stringify({
    name: `k6-stress-fallback-${__VU}-${__ITER}-${Date.now()}`,
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
  // Mix different trust endpoints for variety
  const endpoints = [
    { url: `${BASE_URL}/trust/${agentId}`, name: 'trust_get' },
    { url: `${BASE_URL}/trust/${agentId}/history?limit=20`, name: 'trust_history' },
    { url: `${BASE_URL}/trust/tiers`, name: 'trust_tiers' },
  ];

  const endpoint = pick(endpoints);

  const res = http.get(endpoint.url, {
    headers: HEADERS,
    tags: { endpoint: endpoint.name, operation: 'trust_read' },
  });
  trustReadDuration.add(res.timings.duration);

  const ok = check(res, {
    'trust read status 200': (r) => r.status === 200,
  });
  if (ok) successfulRequests.add(1);
  else {
    errorRate.add(1);
    failedRequests.add(1);
  }
}

/** 30% - Intent submissions with varied risk profiles */
function intentSubmit(agentId) {
  const scenarios = [
    {
      action: { type: 'read_database', resource: '/data/market-prices' },
      actionType: 'read',
      dataSensitivity: 'PUBLIC',
      reversibility: 'REVERSIBLE',
    },
    {
      action: { type: 'write_file', resource: '/reports/quarterly.pdf' },
      actionType: 'write',
      dataSensitivity: 'INTERNAL',
      reversibility: 'REVERSIBLE',
    },
    {
      action: { type: 'call_api', resource: 'https://api.partner.com/v2/data' },
      actionType: 'execute',
      dataSensitivity: 'CONFIDENTIAL',
      reversibility: 'REVERSIBLE',
    },
    {
      action: { type: 'delete_record', resource: '/data/customer-record-999' },
      actionType: 'delete',
      dataSensitivity: 'RESTRICTED',
      reversibility: 'IRREVERSIBLE',
    },
    {
      action: { type: 'send_email', resource: 'customer-notification' },
      actionType: 'execute',
      dataSensitivity: 'INTERNAL',
      reversibility: 'IRREVERSIBLE',
    },
  ];

  const scenario = pick(scenarios);

  const payload = JSON.stringify({
    agentId: agentId,
    agentName: 'k6-stress-agent',
    capabilities: ['read_data', 'write_reports', 'analyze_data'],
    observationTier: 'GRAY_BOX',
    action: scenario.action,
    actionType: scenario.actionType,
    dataSensitivity: scenario.dataSensitivity,
    reversibility: scenario.reversibility,
  });

  // Alternate between submit and dry-run check
  const isDryRun = Math.random() < 0.2;
  const url = isDryRun ? `${BASE_URL}/intents/check` : `${BASE_URL}/intents`;
  const tag = isDryRun ? 'intents_check' : 'intents_submit';

  const res = http.post(url, payload, {
    headers: HEADERS,
    tags: { endpoint: tag, operation: 'intent_submit' },
  });
  intentSubmitDuration.add(res.timings.duration);

  const ok = check(res, {
    'intent submit status 200': (r) => r.status === 200,
  });
  if (ok) successfulRequests.add(1);
  else {
    errorRate.add(1);
    failedRequests.add(1);
  }
}

/** 20% - Proof reads */
function proofRead(agentId) {
  const endpoints = [
    { url: `${BASE_URL}/proofs/entity/${agentId}?limit=20`, name: 'proofs_by_entity' },
    { url: `${BASE_URL}/proofs/metrics`, name: 'proofs_metrics' },
  ];

  const endpoint = pick(endpoints);

  const res = http.get(endpoint.url, {
    headers: HEADERS,
    tags: { endpoint: endpoint.name, operation: 'proof_read' },
  });
  proofReadDuration.add(res.timings.duration);

  const ok = check(res, {
    'proof read status 200': (r) => r.status === 200,
  });
  if (ok) successfulRequests.add(1);
  else {
    errorRate.add(1);
    failedRequests.add(1);
  }
}

/** 10% - Agent CRUD cycle */
function agentCrud() {
  const name = `k6-stress-crud-${__VU}-${__ITER}-${Date.now()}`;
  const createPayload = JSON.stringify({
    name: name,
    capabilities: ['read_data'],
    observationTier: 'GRAY_BOX',
  });

  // Create
  const createRes = http.post(`${BASE_URL}/agents`, createPayload, {
    headers: HEADERS,
    tags: { endpoint: 'agents_create', operation: 'agent_crud' },
  });
  agentCrudDuration.add(createRes.timings.duration);

  if (createRes.status !== 201) {
    errorRate.add(1);
    failedRequests.add(1);
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

  // Update
  const updatePayload = JSON.stringify({
    name: `${name}-stressed`,
    capabilities: ['read_data', 'analyze_data'],
  });
  const updateRes = http.patch(`${BASE_URL}/agents/${newId}`, updatePayload, {
    headers: HEADERS,
    tags: { endpoint: 'agents_update', operation: 'agent_crud' },
  });
  agentCrudDuration.add(updateRes.timings.duration);

  // Delete
  const deleteRes = http.del(`${BASE_URL}/agents/${newId}`, null, {
    headers: HEADERS,
    tags: { endpoint: 'agents_delete', operation: 'agent_crud' },
  });
  agentCrudDuration.add(deleteRes.timings.duration);

  const ok = check(deleteRes, {
    'agent CRUD cycle completed': (r) => r.status === 204,
  });
  if (ok) successfulRequests.add(1);
  else {
    errorRate.add(1);
    failedRequests.add(1);
  }
}

// ---------------------------------------------------------------------------
// Default function (main test loop)
// ---------------------------------------------------------------------------

export default function (data) {
  activeVUs.add(__VU);
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

  // Very short sleep under stress to maximize pressure
  sleep(0.02 + Math.random() * 0.05);
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

export function teardown(data) {
  if (!data.agents) return;

  console.log(`Stress test teardown: cleaning up ${data.agents.length} pool agents`);

  for (const agent of data.agents) {
    http.del(`${BASE_URL}/agents/${agent.id}`, null, {
      headers: HEADERS,
      tags: { endpoint: 'teardown_delete' },
    });
  }
}
