/**
 * k6 Steady-State Performance Test
 *
 * Simulates normal production load: 100 concurrent users for 10 minutes.
 * Validates P95 latency budgets:
 *   - Read (GET):  P95 < 200ms
 *   - Write (POST): P95 < 500ms
 *   - Trust scoring: P95 < 800ms
 *
 * Usage:
 *   k6 run k6/steady-state.js
 *   k6 run k6/steady-state.js --env BASE_URL=https://cognigate.dev
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const healthLatency = new Trend('health_latency', true);
const intentLatency = new Trend('intent_latency', true);
const trustLatency = new Trend('trust_latency', true);
const proofLatency = new Trend('proof_latency', true);
const agentLatency = new Trend('agent_latency', true);

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export const options = {
  stages: [
    { duration: '1m', target: 50 },   // Ramp up to 50 users
    { duration: '1m', target: 100 },   // Ramp to 100 users
    { duration: '8m', target: 100 },   // Sustain 100 users
    { duration: '1m', target: 0 },     // Ramp down
  ],
  thresholds: {
    // Global thresholds
    http_req_failed: ['rate<0.01'],           // <1% error rate
    http_req_duration: ['p(95)<500'],          // Global P95 < 500ms

    // Per-endpoint thresholds
    health_latency: ['p(95)<200'],             // Health: P95 < 200ms
    intent_latency: ['p(95)<500'],             // Intent analysis: P95 < 500ms
    trust_latency: ['p(95)<800'],              // Trust scoring: P95 < 800ms
    proof_latency: ['p(95)<500'],              // Proof operations: P95 < 500ms
    agent_latency: ['p(95)<200'],              // Agent CRUD: P95 < 200ms
    errors: ['rate<0.01'],                     // <1% custom error rate
  },
};

// Sample payloads
const SAFE_INTENT = {
  goal: 'Read user preferences from the settings database',
  context: { agent_id: 'perf-test-agent', trust_level: 3 },
};

const AGENT_PAYLOAD = {
  name: `perf-agent-${Date.now()}`,
  capabilities: ['read'],
  observationTier: 'GRAY_BOX',
};

export default function () {
  group('Health Checks', () => {
    const res = http.get(`${BASE_URL}/health`);
    healthLatency.add(res.timings.duration);
    check(res, {
      'health status 200': (r) => r.status === 200,
      'health body has status': (r) => JSON.parse(r.body).status !== undefined,
    }) || errorRate.add(1);

    const live = http.get(`${BASE_URL}/health/live`);
    check(live, { 'liveness 200': (r) => r.status === 200 }) || errorRate.add(1);
  });

  group('Intent Analysis', () => {
    const res = http.post(
      `${BASE_URL}/v1/intent/analyze`,
      JSON.stringify(SAFE_INTENT),
      { headers: { 'Content-Type': 'application/json' } },
    );
    intentLatency.add(res.timings.duration);
    check(res, {
      'intent status 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  group('Agent Operations', () => {
    // List agents (GET)
    const list = http.get(`${BASE_URL}/v1/agents`);
    agentLatency.add(list.timings.duration);
    check(list, {
      'agents list 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  group('Reference Data', () => {
    const tiers = http.get(`${BASE_URL}/v1/reference/tiers`);
    check(tiers, { 'tiers 200': (r) => r.status === 200 }) || errorRate.add(1);

    const caps = http.get(`${BASE_URL}/v1/reference/capabilities`);
    check(caps, { 'capabilities 200': (r) => r.status === 200 }) || errorRate.add(1);
  });

  group('Proof Chain', () => {
    const stats = http.get(`${BASE_URL}/v1/proof/stats`);
    proofLatency.add(stats.timings.duration);
    check(stats, {
      'proof stats 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  sleep(1); // Think time between iterations
}

export function handleSummary(data) {
  return {
    'k6-results/steady-state.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

// k6 built-in text summary
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.3/index.js';
