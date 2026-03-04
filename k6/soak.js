/**
 * k6 Soak Test
 *
 * Simulates sustained load over 2 hours: 50 concurrent users.
 * Detects:
 *   - Memory leaks
 *   - Connection pool exhaustion
 *   - Gradual performance degradation
 *   - Resource accumulation issues
 *
 * Usage:
 *   k6 run k6/soak.js
 *   k6 run k6/soak.js --env BASE_URL=https://cognigate.dev
 *   k6 run k6/soak.js --env DURATION=30m  # shorter for CI
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const errorRate = new Rate('errors');
const soakLatency = new Trend('soak_latency', true);
const totalRequests = new Counter('total_requests');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const DURATION = __ENV.DURATION || '2h';

export const options = {
  stages: [
    { duration: '5m', target: 50 },              // Ramp up
    { duration: DURATION, target: 50 },           // Sustained load
    { duration: '5m', target: 0 },                // Ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],                // <1% error rate
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // Strict latency
    errors: ['rate<0.01'],
    soak_latency: ['p(95)<500'],
  },
};

const INTENTS = [
  { goal: 'Read user profile data', context: { agent_id: 'soak-1', trust_level: 3 } },
  { goal: 'Update configuration settings', context: { agent_id: 'soak-2', trust_level: 4 } },
  { goal: 'Query compliance records', context: { agent_id: 'soak-3', trust_level: 2 } },
  { goal: 'Generate trust report', context: { agent_id: 'soak-4', trust_level: 5 } },
];

export default function () {
  const intent = INTENTS[Math.floor(Math.random() * INTENTS.length)];

  group('Soak - Health', () => {
    const res = http.get(`${BASE_URL}/health`);
    soakLatency.add(res.timings.duration);
    totalRequests.add(1);
    check(res, {
      'health ok': (r) => r.status === 200,
      'health body valid': (r) => {
        const body = JSON.parse(r.body);
        return body.status !== undefined && body.uptime_seconds > 0;
      },
    }) || errorRate.add(1);
  });

  group('Soak - Intent', () => {
    const res = http.post(
      `${BASE_URL}/v1/intent/analyze`,
      JSON.stringify(intent),
      { headers: { 'Content-Type': 'application/json' } },
    );
    soakLatency.add(res.timings.duration);
    totalRequests.add(1);
    check(res, { 'intent ok': (r) => r.status === 200 }) || errorRate.add(1);
  });

  group('Soak - Read Operations', () => {
    const endpoints = [
      '/v1/agents',
      '/v1/reference/tiers',
      '/v1/proof/stats',
    ];
    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    const res = http.get(`${BASE_URL}${endpoint}`);
    soakLatency.add(res.timings.duration);
    totalRequests.add(1);
    check(res, { 'read ok': (r) => r.status === 200 }) || errorRate.add(1);
  });

  sleep(Math.random() * 2 + 1); // 1-3s random think time
}

export function handleSummary(data) {
  return {
    'k6-results/soak.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.3/index.js';
