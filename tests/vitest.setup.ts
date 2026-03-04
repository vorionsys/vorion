/**
 * Global Vitest Setup
 *
 * This file runs before all tests and handles:
 * - Clearing Prometheus metrics registry (prevents re-registration errors)
 * - Setting up test environment variables
 * - Global mocks
 */

import { beforeAll, afterAll, vi } from 'vitest';
import { Registry, collectDefaultMetrics } from 'prom-client';

// Set test environment before any imports
process.env['NODE_ENV'] = 'test';
process.env['VORION_ENV'] = 'development';
process.env['VORION_LOG_LEVEL'] = 'error';

// Create a fresh registry for tests
const testRegistry = new Registry();
collectDefaultMetrics({ register: testRegistry, prefix: 'vorion_' });

// Mock the metrics-registry module to use a fresh registry for each test run
vi.mock('../src/common/metrics-registry.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/common/metrics-registry.js')>();
  // Clear and return the test registry
  testRegistry.clear();
  collectDefaultMetrics({ register: testRegistry, prefix: 'vorion_' });
  return {
    ...original,
    vorionRegistry: testRegistry,
    getMetrics: async () => testRegistry.metrics(),
    getMetricsContentType: () => testRegistry.contentType,
  };
});

beforeAll(async () => {
  // Reset metric values before tests (preserves metric registrations)
  // Note: We use resetMetrics() instead of clear() to avoid removing custom metrics
  // that were registered when their modules were imported
  testRegistry.resetMetrics();
});

afterAll(async () => {
  // Clean up after tests
  testRegistry.clear();
});
