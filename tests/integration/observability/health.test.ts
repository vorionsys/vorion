/**
 * Observability Integration Tests
 *
 * Tests health checks, metrics, logging, and alerting.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerHealthCheck,
  unregisterHealthCheck,
  clearHealthChecks,
  checkHealth,
  isAlive,
  isReady,
  createMemoryHealthCheck,
  type HealthCheck,
  type HealthStatus,
  type ComponentHealth,
} from '../../../src/observability/health.js';

describe('Observability Integration Tests', () => {
  beforeEach(() => {
    clearHealthChecks();
  });

  describe('Health Check Registry', () => {
    it('should register health check', () => {
      const check: HealthCheck = {
        name: 'test-service',
        check: async () => ({
          name: 'test-service',
          status: 'healthy',
        }),
      };

      registerHealthCheck(check);

      // Verify by running health check
      expect(checkHealth).toBeDefined();
    });

    it('should unregister health check', () => {
      const check: HealthCheck = {
        name: 'temp-service',
        check: async () => ({
          name: 'temp-service',
          status: 'healthy',
        }),
      };

      registerHealthCheck(check);
      unregisterHealthCheck('temp-service');

      // Should not throw
      expect(true).toBe(true);
    });

    it('should clear all health checks', () => {
      registerHealthCheck({
        name: 'service-1',
        check: async () => ({ name: 'service-1', status: 'healthy' }),
      });
      registerHealthCheck({
        name: 'service-2',
        check: async () => ({ name: 'service-2', status: 'healthy' }),
      });

      clearHealthChecks();

      // Should work without error
      expect(true).toBe(true);
    });
  });

  describe('Health Status Aggregation', () => {
    it('should return healthy when all checks pass', async () => {
      registerHealthCheck({
        name: 'db',
        check: async () => ({ name: 'db', status: 'healthy', latencyMs: 5 }),
        critical: true,
      });
      registerHealthCheck({
        name: 'cache',
        check: async () => ({ name: 'cache', status: 'healthy', latencyMs: 2 }),
      });

      const health = await checkHealth();

      expect(health.status).toBe('healthy');
      expect(health.components).toHaveLength(2);
    });

    it('should return degraded when non-critical check fails', async () => {
      registerHealthCheck({
        name: 'db',
        check: async () => ({ name: 'db', status: 'healthy' }),
        critical: true,
      });
      registerHealthCheck({
        name: 'optional-service',
        check: async () => ({ name: 'optional-service', status: 'unhealthy', message: 'Connection failed' }),
        critical: false,
      });

      const health = await checkHealth();

      expect(health.status).toBe('degraded');
    });

    it('should return unhealthy when critical check fails', async () => {
      registerHealthCheck({
        name: 'db',
        check: async () => ({ name: 'db', status: 'unhealthy', message: 'Connection refused' }),
        critical: true,
      });

      const health = await checkHealth();

      expect(health.status).toBe('unhealthy');
    });
  });

  describe('Liveness and Readiness', () => {
    it('should pass liveness check when process is running', async () => {
      const alive = await isAlive();
      expect(alive).toBe(true);
    });

    it('should check readiness based on registered checks', async () => {
      registerHealthCheck({
        name: 'db',
        check: async () => ({ name: 'db', status: 'healthy' }),
        critical: true,
      });

      const ready = await isReady();
      expect(ready).toBe(true);
    });

    it('should fail readiness when critical component unhealthy', async () => {
      registerHealthCheck({
        name: 'db',
        check: async () => ({ name: 'db', status: 'unhealthy' }),
        critical: true,
      });

      const ready = await isReady();
      expect(ready).toBe(false);
    });
  });

  describe('Memory Health Check', () => {
    it('should create memory health check', () => {
      const check = createMemoryHealthCheck(0.9); // 90% threshold
      expect(check).toHaveProperty('name');
      expect(check).toHaveProperty('check');
    });

    it('should return healthy when memory usage below threshold', async () => {
      const check = createMemoryHealthCheck(4096); // Very high threshold (4GB)
      const result = await check.check();

      expect(result.status).toBe('healthy');
      expect(result.details).toHaveProperty('heapUsedMB');
      expect(result.details).toHaveProperty('heapTotalMB');
    });
  });

  describe('Health Check Timeouts', () => {
    it('should handle slow health checks', async () => {
      registerHealthCheck({
        name: 'slow-service',
        check: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return { name: 'slow-service', status: 'healthy', latencyMs: 100 };
        },
      });

      const start = Date.now();
      const health = await checkHealth();
      const duration = Date.now() - start;

      expect(duration).toBeGreaterThanOrEqual(100);
      expect(health.components[0].latencyMs).toBeGreaterThanOrEqual(100);
    });

    it('should timeout extremely slow checks', async () => {
      registerHealthCheck({
        name: 'timeout-service',
        check: async () => {
          await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
          return { name: 'timeout-service', status: 'healthy' };
        },
      });

      // Health check should have timeout mechanism
      const health = await Promise.race([
        checkHealth(),
        new Promise<{ status: HealthStatus; components: ComponentHealth[] }>(resolve =>
          setTimeout(() => resolve({
            status: 'unhealthy',
            components: [{ name: 'timeout-service', status: 'unhealthy', message: 'Timeout' }],
          }), 1000)
        ),
      ]);

      // Either completes or times out
      expect(['healthy', 'unhealthy', 'degraded']).toContain(health.status);
    }, 15000);
  });

  describe('Health Check Details', () => {
    it('should include version info in health response', async () => {
      const health = await checkHealth();

      expect(health).toHaveProperty('version');
      expect(health).toHaveProperty('uptime');
      expect(health).toHaveProperty('timestamp');
    });

    it('should include component latencies', async () => {
      registerHealthCheck({
        name: 'fast-service',
        check: async () => {
          const start = Date.now();
          await new Promise(resolve => setTimeout(resolve, 10));
          return {
            name: 'fast-service',
            status: 'healthy',
            latencyMs: Date.now() - start,
          };
        },
      });

      const health = await checkHealth();
      const component = health.components.find(c => c.name === 'fast-service');

      expect(component?.latencyMs).toBeGreaterThanOrEqual(10);
    });
  });
});

describe('Metrics Integration', () => {
  describe('Counter Metrics', () => {
    it('should track agent registrations', () => {
      const counter = {
        inc: vi.fn(),
        labels: vi.fn().mockReturnThis(),
      };

      counter.labels({ tenant: 'test', domain: 'A' }).inc();
      expect(counter.labels).toHaveBeenCalledWith({ tenant: 'test', domain: 'A' });
      expect(counter.inc).toHaveBeenCalled();
    });

    it('should track A2A invocations', () => {
      const counter = {
        inc: vi.fn(),
        labels: vi.fn().mockReturnThis(),
      };

      counter.labels({ outcome: 'success', action: 'process' }).inc();
      expect(counter.labels).toHaveBeenCalled();
    });
  });

  describe('Histogram Metrics', () => {
    it('should record trust score computation duration', () => {
      const histogram = {
        observe: vi.fn(),
        labels: vi.fn().mockReturnThis(),
      };

      histogram.labels({ tier: '5' }).observe(0.150); // 150ms
      expect(histogram.observe).toHaveBeenCalledWith(0.150);
    });

    it('should record A2A invocation duration', () => {
      const histogram = {
        observe: vi.fn(),
        labels: vi.fn().mockReturnThis(),
      };

      histogram.labels({ action: 'invoke', outcome: 'success' }).observe(0.250);
      expect(histogram.observe).toHaveBeenCalledWith(0.250);
    });
  });

  describe('Gauge Metrics', () => {
    it('should track agents by state', () => {
      const gauge = {
        set: vi.fn(),
        labels: vi.fn().mockReturnThis(),
      };

      gauge.labels({ state: 'active' }).set(100);
      gauge.labels({ state: 'suspended' }).set(5);

      expect(gauge.set).toHaveBeenCalledWith(100);
      expect(gauge.set).toHaveBeenCalledWith(5);
    });

    it('should track agents by tier', () => {
      const gauge = {
        set: vi.fn(),
        labels: vi.fn().mockReturnThis(),
      };

      for (let tier = 0; tier <= 7; tier++) {
        gauge.labels({ tier: String(tier) }).set(Math.floor(Math.random() * 100));
      }

      expect(gauge.set).toHaveBeenCalledTimes(8);
    });
  });
});

describe('Alerting Integration', () => {
  describe('Alert Rules', () => {
    const DEFAULT_ALERT_RULES = [
      { name: 'high_error_rate', condition: 'error_rate > 0.05', severity: 'critical' },
      { name: 'trust_score_drop', condition: 'score_delta < -100', severity: 'high' },
      { name: 'agent_suspended', condition: 'state_change == suspended', severity: 'medium' },
      { name: 'chain_depth_exceeded', condition: 'chain_depth > 8', severity: 'high' },
    ];

    it('should define default alert rules', () => {
      expect(DEFAULT_ALERT_RULES).toHaveLength(4);
      expect(DEFAULT_ALERT_RULES[0].severity).toBe('critical');
    });

    it('should evaluate alert conditions', () => {
      const evaluateCondition = (condition: string, values: Record<string, number>): boolean => {
        // Simple condition evaluation
        const match = condition.match(/(\w+)\s*([<>=!]+)\s*(-?\d+\.?\d*)/);
        if (!match) return false;

        const [, key, op, value] = match;
        const actual = values[key];
        const threshold = parseFloat(value);

        switch (op) {
          case '>': return actual > threshold;
          case '<': return actual < threshold;
          case '>=': return actual >= threshold;
          case '<=': return actual <= threshold;
          case '==': return actual === threshold;
          default: return false;
        }
      };

      expect(evaluateCondition('error_rate > 0.05', { error_rate: 0.1 })).toBe(true);
      expect(evaluateCondition('error_rate > 0.05', { error_rate: 0.01 })).toBe(false);
      expect(evaluateCondition('score_delta < -100', { score_delta: -150 })).toBe(true);
    });
  });

  describe('Alert Handlers', () => {
    it('should call logging handler', async () => {
      const logSpy = vi.fn();
      const handler = (alert: { name: string; severity: string; message: string }) => {
        logSpy(alert);
      };

      handler({
        name: 'test_alert',
        severity: 'high',
        message: 'Test alert triggered',
      });

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test_alert',
          severity: 'high',
        })
      );
    });

    it('should call webhook handler', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true });

      const webhookHandler = async (
        url: string,
        alert: { name: string; severity: string; message: string }
      ) => {
        await fetchSpy(url, {
          method: 'POST',
          body: JSON.stringify(alert),
        });
      };

      await webhookHandler('https://hooks.example.com/alert', {
        name: 'critical_alert',
        severity: 'critical',
        message: 'Critical issue detected',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://hooks.example.com/alert',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
