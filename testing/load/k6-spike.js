/**
 * Cognigate API - Spike Test
 *
 * Tests the API's ability to handle sudden traffic spikes and recover.
 * Rapidly ramps from 1 to 200 VUs, holds briefly, then drops back down.
 * Monitors behavior during and after the spike to verify recovery.
 *
 * Workload distribution:
 *   40% - Trust reads      (GET /trust/:agentId)
 *   30% - Intent submissions (POST /intents)
 *   20% - Proof reads      (GET /proofs/entity/:entityId)
 *   10% - Agent CRUD       (POST/GET/PATCH/DELETE /agents)
 *
 * Usage:
 *   k6 run testing/load/k6-spike.js
 *   k6 run -e BASE_URL=https://staging.example.com/api/v1 testing/load/k6-spike.js
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
const spikeErrorRate = new Rate('cognigate_spike_errors');
const recoveryErrorRate = new Rate('cognigate_recovery_errors');
const trustReadDuration = new Trend('cognigate_trust_read_duration', true);
const intentSubmitDuration = new Trend('cognigate_intent_submit_duration', true);
const proofReadDuration = new Trend('cognigate_proof_read_duration', true);
const agentCrudDuration = new Trend('cognigate_agent_crud_duration', true);
const requestsTotal = new Counter('cognigate_requests_total');
const activeVUs = new Gauge('cognigate_active_vus');

// ---------------------------------------------------------------------------
// k6 options
// ---------------------------------------------------------------------------

export const options = {
  stages: [
    // Phase 1: Baseline - normal traffic
    { duration: '30s', target: 5 },      // Warm up with 5 VUs

    // Phase 2: Spike - sudden jump to 200 VUs
    { duration: '10s', target: 200 },    // Sharp ramp to 200 VUs (the spike)

    // Phase 3: Sustained spike
    { duration: '1m',  target: 200 },    // Hold at 200 VUs

    // Phase 4: Drop - sudden return to baseline
    { duration: '10s', target: 5 },      // Sharp drop back to 5 VUs

    // Phase 5: Recovery monitoring
    { duration: '1m',  target: 5 },      // Monitor recovery at baseline

    // Phase 6: Second spike (verify system is stable after recovery)
    { duration: '10s', target: 150 },    // Second spike to 150 VUs
    { duration: '30s', target: 150 },    // Hold
    { duration: '10s', target: 1 },      // Drop to 1

    // Phase 7: Final recovery
    { duration: '1m',  target: 1 },      // Final recovery monitoring
  ],
  tags: { testType: 'spike' },
  thresholds: {
    // Overall thresholds (relaxed due to spike nature)
    http_req_failed: ['rate<0.10'],                     // < 10% overall errors
    http_req_duration: ['p(95)<3000'],                  // p95 < 3s overall
    cognigate_errors: ['rate<0.10'],

    // Recovery phase thresholds (stricter)
    cognigate_recovery_errors: ['rate<0.05'],           // < 5% errors during recovery

    // Per-endpoint thresholds (relaxed)
    cognigate_trust_read_duration: ['p(95)<2000'],
    cognigate_intent_submit_duration: ['p(95)<3000'],
    cognigate_proof_read_duration: ['p(95)<2000'],
    cognigate_agent_crud_duration: ['p(95)<3000'],
  },
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function setup() {
  const agents = [];

  // Create a pool of agents (fewer than stress test since spikes are shorter)
  for (let i = 0; i < 15; i++) {
    const payload = JSON.stringify({
      name: `k6-spike-pool-${i}-${Date.now()}`,
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
        name: body.name || `k6-spike-pool-${i}`,
      });
    }
  }

  console.log(`Spike test setup: created ${agents.length} pool agents`);
  return { agents, startTime: Date.now() };
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
    name: `k6-spike-fallback-${__VU}-${__ITER}-${Date.now()}`,
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

/**
 * Determine the current test phase based on elapsed time.
 * Used to tag metrics for per-phase analysis.
 */
function getPhase(data) {
  const elapsed = (Date.now() - data.startTime) / 1000;

  if (elapsed < 30) return 'baseline';
  if (elapsed < 40) return 'spike_ramp';
  if (elapsed < 100) return 'spike_sustained';
  if (elapsed < 110) return 'spike_drop';
  if (elapsed < 170) return 'recovery';
  if (elapsed < 180) return 'spike2_ramp';
  if (elapsed < 210) return 'spike2_sustained';
  if (elapsed < 220) return 'spike2_drop';
  return 'final_recovery';
}

// ---------------------------------------------------------------------------
// Scenario functions
// ---------------------------------------------------------------------------

function trustRead(agentId, phase) {
  const endpoints = [
    { url: `${BASE_URL}/trust/${agentId}`, name: 'trust_get' },
    { url: `${BASE_URL}/trust/${agentId}/history?limit=10`, name: 'trust_history' },
    { url: `${BASE_URL}/trust/tiers`, name: 'trust_tiers' },
  ];

  const endpoint = pick(endpoints);

  const res = http.get(endpoint.url, {
    headers: HEADERS,
    tags: { endpoint: endpoint.name, operation: 'trust_read', phase: phase },
  });
  trustReadDuration.add(res.timings.duration);
  requestsTotal.add(1);

  const ok = check(res, {
    'trust read status 200': (r) => r.status === 200,
  });

  if (!ok) {
    errorRate.add(1);
    spikeErrorRate.add(1);
    if (phase === 'recovery' || phase === 'final_recovery') {
      recoveryErrorRate.add(1);
    }
  } else {
    errorRate.add(0);
    spikeErrorRate.add(0);
    if (phase === 'recovery' || phase === 'final_recovery') {
      recoveryErrorRate.add(0);
    }
  }
}

function intentSubmit(agentId, phase) {
  const actions = [
    { type: 'read_database', resource: '/data/prices', actionType: 'read', dataSensitivity: 'PUBLIC', reversibility: 'REVERSIBLE' },
    { type: 'write_file', resource: '/reports/output.csv', actionType: 'write', dataSensitivity: 'INTERNAL', reversibility: 'REVERSIBLE' },
    { type: 'call_api', resource: 'https://api.example.com/v1/data', actionType: 'execute', dataSensitivity: 'INTERNAL', reversibility: 'REVERSIBLE' },
    { type: 'delete_record', resource: '/data/record-42', actionType: 'delete', dataSensitivity: 'CONFIDENTIAL', reversibility: 'IRREVERSIBLE' },
  ];

  const action = pick(actions);

  const payload = JSON.stringify({
    agentId: agentId,
    agentName: 'k6-spike-agent',
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
    tags: { endpoint: 'intents_submit', operation: 'intent_submit', phase: phase },
  });
  intentSubmitDuration.add(res.timings.duration);
  requestsTotal.add(1);

  const ok = check(res, {
    'intent submit status 200': (r) => r.status === 200,
  });

  if (!ok) {
    errorRate.add(1);
    spikeErrorRate.add(1);
    if (phase === 'recovery' || phase === 'final_recovery') {
      recoveryErrorRate.add(1);
    }
  } else {
    errorRate.add(0);
    spikeErrorRate.add(0);
    if (phase === 'recovery' || phase === 'final_recovery') {
      recoveryErrorRate.add(0);
    }
  }
}

function proofRead(agentId, phase) {
  const endpoints = [
    { url: `${BASE_URL}/proofs/entity/${agentId}?limit=10`, name: 'proofs_by_entity' },
    { url: `${BASE_URL}/proofs/metrics`, name: 'proofs_metrics' },
  ];

  const endpoint = pick(endpoints);

  const res = http.get(endpoint.url, {
    headers: HEADERS,
    tags: { endpoint: endpoint.name, operation: 'proof_read', phase: phase },
  });
  proofReadDuration.add(res.timings.duration);
  requestsTotal.add(1);

  const ok = check(res, {
    'proof read status 200': (r) => r.status === 200,
  });

  if (!ok) {
    errorRate.add(1);
    spikeErrorRate.add(1);
    if (phase === 'recovery' || phase === 'final_recovery') {
      recoveryErrorRate.add(1);
    }
  } else {
    errorRate.add(0);
    spikeErrorRate.add(0);
    if (phase === 'recovery' || phase === 'final_recovery') {
      recoveryErrorRate.add(0);
    }
  }
}

function agentCrud(phase) {
  const name = `k6-spike-crud-${__VU}-${__ITER}-${Date.now()}`;
  const createPayload = JSON.stringify({
    name: name,
    capabilities: ['read_data'],
    observationTier: 'GRAY_BOX',
  });

  const createRes = http.post(`${BASE_URL}/agents`, createPayload, {
    headers: HEADERS,
    tags: { endpoint: 'agents_create', operation: 'agent_crud', phase: phase },
  });
  agentCrudDuration.add(createRes.timings.duration);
  requestsTotal.add(1);

  if (createRes.status !== 201) {
    errorRate.add(1);
    spikeErrorRate.add(1);
    if (phase === 'recovery' || phase === 'final_recovery') {
      recoveryErrorRate.add(1);
    }
    return;
  }

  const body = createRes.json();
  const newId = body.id || body.agentId;

  // Read
  const getRes = http.get(`${BASE_URL}/agents/${newId}`, {
    headers: HEADERS,
    tags: { endpoint: 'agents_get', operation: 'agent_crud', phase: phase },
  });
  agentCrudDuration.add(getRes.timings.duration);
  requestsTotal.add(1);

  // Delete (skip update to reduce cycle time during spikes)
  const deleteRes = http.del(`${BASE_URL}/agents/${newId}`, null, {
    headers: HEADERS,
    tags: { endpoint: 'agents_delete', operation: 'agent_crud', phase: phase },
  });
  agentCrudDuration.add(deleteRes.timings.duration);
  requestsTotal.add(1);

  const ok = check(deleteRes, {
    'agent CRUD cycle completed': (r) => r.status === 204,
  });

  if (!ok) {
    errorRate.add(1);
    spikeErrorRate.add(1);
    if (phase === 'recovery' || phase === 'final_recovery') {
      recoveryErrorRate.add(1);
    }
  } else {
    errorRate.add(0);
    spikeErrorRate.add(0);
    if (phase === 'recovery' || phase === 'final_recovery') {
      recoveryErrorRate.add(0);
    }
  }
}

// ---------------------------------------------------------------------------
// Default function (main test loop)
// ---------------------------------------------------------------------------

export default function (data) {
  activeVUs.add(__VU);
  const agentId = getAgentId(data);
  const phase = getPhase(data);

  // Weighted random scenario selection
  const scenario = weightedRandom([40, 30, 20, 10]);

  switch (scenario) {
    case 0:
      if (agentId) trustRead(agentId, phase);
      break;
    case 1:
      if (agentId) intentSubmit(agentId, phase);
      break;
    case 2:
      if (agentId) proofRead(agentId, phase);
      break;
    case 3:
      agentCrud(phase);
      break;
  }

  // Minimal sleep during spike to maximize pressure; longer during recovery
  // to simulate more realistic post-spike traffic
  if (phase.includes('spike') || phase.includes('ramp')) {
    sleep(0.01 + Math.random() * 0.03);
  } else {
    sleep(0.05 + Math.random() * 0.1);
  }
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

export function teardown(data) {
  if (!data.agents) return;

  console.log(`Spike test teardown: cleaning up ${data.agents.length} pool agents`);

  for (const agent of data.agents) {
    http.del(`${BASE_URL}/agents/${agent.id}`, null, {
      headers: HEADERS,
      tags: { endpoint: 'teardown_delete' },
    });
  }
}
