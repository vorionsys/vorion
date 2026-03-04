/**
 * k6 Spike Test
 *
 * Simulates sudden traffic spike: 0 -> 1000 users in 30 seconds.
 * Validates system resilience under extreme load:
 *   - Error rate stays below 5%
 *   - System recovers after spike subsides
 *   - No cascading failures
 *
 * Usage:
 *   k6 run k6/spike.js
 *   k6 run k6/spike.js --env BASE_URL=https://cognigate.dev
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const spikeLatency = new Trend('spike_latency', true);

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export const options = {
  stages: [
    { duration: '10s', target: 10 },    // Warm up
    { duration: '30s', target: 1000 },   // SPIKE: 0 -> 1000
    { duration: '1m', target: 1000 },    // Hold spike
    { duration: '30s', target: 50 },     // Rapid cooldown
    { duration: '2m', target: 50 },      // Recovery period
    { duration: '30s', target: 0 },      // Ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],            // <5% error rate during spike
    http_req_duration: ['p(95)<2000'],          // P95 < 2s (relaxed for spike)
    errors: ['rate<0.05'],
  },
};

const SAFE_INTENT = {
  goal: 'Check agent compliance status',
  context: { agent_id: 'spike-test-agent', trust_level: 2 },
};

export default function () {
  group('Critical Path Under Spike', () => {
    // Health check — must always work
    const health = http.get(`${BASE_URL}/health/live`);
    spikeLatency.add(health.timings.duration);
    check(health, {
      'liveness survives spike': (r) => r.status === 200,
    }) || errorRate.add(1);

    // Intent analysis — core business logic
    const intent = http.post(
      `${BASE_URL}/v1/intent/analyze`,
      JSON.stringify(SAFE_INTENT),
      { headers: { 'Content-Type': 'application/json' } },
    );
    spikeLatency.add(intent.timings.duration);
    check(intent, {
      'intent survives spike': (r) => r.status === 200 || r.status === 429,
    }) || errorRate.add(1);

    // Agent list — read path
    const agents = http.get(`${BASE_URL}/v1/agents`);
    spikeLatency.add(agents.timings.duration);
    check(agents, {
      'agents survives spike': (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  sleep(0.1); // Minimal think time to maximize pressure
}

export function handleSummary(data) {
  return {
    'k6-results/spike.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.3/index.js';
