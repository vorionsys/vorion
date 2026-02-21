/**
 * Health Check Service
 *
 * Provides comprehensive health checks for all Vorion subsystems.
 * Supports Kubernetes-style liveness and readiness probes.
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '../common/logger.js';

const logger = createLogger({ component: 'health-check' });

// ============================================================================
// Types
// ============================================================================

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ComponentHealth {
  name: string;
  status: HealthStatus;
  message?: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

export interface OverallHealth {
  status: HealthStatus;
  version: string;
  uptime: number;
  timestamp: string;
  components: ComponentHealth[];
}

export interface HealthCheck {
  name: string;
  check: () => Promise<ComponentHealth>;
  critical?: boolean; // If critical check fails, overall status is unhealthy
}

// ============================================================================
// Health Check Registry
// ============================================================================

const healthChecks: HealthCheck[] = [];
let startTime: number = Date.now();

/**
 * Register a health check
 */
export function registerHealthCheck(check: HealthCheck): void {
  healthChecks.push(check);
  logger.debug({ name: check.name, critical: check.critical }, 'Health check registered');
}

/**
 * Unregister a health check
 */
export function unregisterHealthCheck(name: string): void {
  const index = healthChecks.findIndex((c) => c.name === name);
  if (index !== -1) {
    healthChecks.splice(index, 1);
    logger.debug({ name }, 'Health check unregistered');
  }
}

/**
 * Clear all health checks
 */
export function clearHealthChecks(): void {
  healthChecks.length = 0;
}

// ============================================================================
// Built-in Health Checks
// ============================================================================

/**
 * Database health check factory
 */
export function createDatabaseHealthCheck(
  name: string,
  pingFn: () => Promise<void>
): HealthCheck {
  return {
    name,
    critical: true,
    check: async (): Promise<ComponentHealth> => {
      const start = Date.now();
      try {
        await pingFn();
        return {
          name,
          status: 'healthy',
          latencyMs: Date.now() - start,
        };
      } catch (error) {
        return {
          name,
          status: 'unhealthy',
          message: error instanceof Error ? error.message : 'Unknown error',
          latencyMs: Date.now() - start,
        };
      }
    },
  };
}

/**
 * Redis health check factory
 */
export function createRedisHealthCheck(
  name: string,
  pingFn: () => Promise<string>
): HealthCheck {
  return {
    name,
    critical: true,
    check: async (): Promise<ComponentHealth> => {
      const start = Date.now();
      try {
        const result = await pingFn();
        return {
          name,
          status: result === 'PONG' ? 'healthy' : 'degraded',
          latencyMs: Date.now() - start,
          details: { response: result },
        };
      } catch (error) {
        return {
          name,
          status: 'unhealthy',
          message: error instanceof Error ? error.message : 'Unknown error',
          latencyMs: Date.now() - start,
        };
      }
    },
  };
}

/**
 * External service health check factory
 */
export function createExternalServiceHealthCheck(
  name: string,
  url: string,
  timeoutMs: number = 5000
): HealthCheck {
  return {
    name,
    critical: false,
    check: async (): Promise<ComponentHealth> => {
      const start = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        return {
          name,
          status: response.ok ? 'healthy' : 'degraded',
          latencyMs: Date.now() - start,
          details: { statusCode: response.status },
        };
      } catch (error) {
        clearTimeout(timeoutId);
        const message = error instanceof Error ? error.message : 'Unknown error';
        const isTimeout = message.includes('abort');

        return {
          name,
          status: 'unhealthy',
          message: isTimeout ? 'Timeout' : message,
          latencyMs: Date.now() - start,
        };
      }
    },
  };
}

/**
 * Memory usage health check
 */
export function createMemoryHealthCheck(
  maxHeapUsedMB: number = 1024
): HealthCheck {
  return {
    name: 'memory',
    critical: false,
    check: async (): Promise<ComponentHealth> => {
      const usage = process.memoryUsage();
      const heapUsedMB = usage.heapUsed / 1024 / 1024;
      const heapTotalMB = usage.heapTotal / 1024 / 1024;
      const percentage = (heapUsedMB / heapTotalMB) * 100;

      let status: HealthStatus = 'healthy';
      if (heapUsedMB > maxHeapUsedMB) {
        status = 'unhealthy';
      } else if (percentage > 85) {
        status = 'degraded';
      }

      return {
        name: 'memory',
        status,
        details: {
          heapUsedMB: Math.round(heapUsedMB),
          heapTotalMB: Math.round(heapTotalMB),
          percentage: Math.round(percentage),
          rssBytes: usage.rss,
        },
      };
    },
  };
}

/**
 * Agent Anchor health check factory
 */
export function createAgentAnchorHealthCheck(
  getStats: () => Promise<{
    agentCount: number;
    pendingAttestations: number;
    cacheStatus: 'connected' | 'disconnected';
  }>
): HealthCheck {
  return {
    name: 'agent-anchor',
    critical: true,
    check: async (): Promise<ComponentHealth> => {
      const start = Date.now();
      try {
        const stats = await getStats();
        return {
          name: 'agent-anchor',
          status: stats.cacheStatus === 'connected' ? 'healthy' : 'degraded',
          latencyMs: Date.now() - start,
          details: {
            agents: stats.agentCount,
            pendingAttestations: stats.pendingAttestations,
            cacheStatus: stats.cacheStatus,
          },
        };
      } catch (error) {
        return {
          name: 'agent-anchor',
          status: 'unhealthy',
          message: error instanceof Error ? error.message : 'Unknown error',
          latencyMs: Date.now() - start,
        };
      }
    },
  };
}

/**
 * A2A health check factory
 */
export function createA2AHealthCheck(
  getStats: () => Promise<{
    endpoints: number;
    activeChains: number;
    circuitBreakersOpen: number;
  }>
): HealthCheck {
  return {
    name: 'a2a',
    critical: false,
    check: async (): Promise<ComponentHealth> => {
      const start = Date.now();
      try {
        const stats = await getStats();
        // Degraded if more than 50% of endpoints have open circuit breakers
        const status: HealthStatus =
          stats.circuitBreakersOpen > stats.endpoints / 2
            ? 'degraded'
            : 'healthy';

        return {
          name: 'a2a',
          status,
          latencyMs: Date.now() - start,
          details: {
            endpoints: stats.endpoints,
            activeChains: stats.activeChains,
            circuitBreakersOpen: stats.circuitBreakersOpen,
          },
        };
      } catch (error) {
        return {
          name: 'a2a',
          status: 'unhealthy',
          message: error instanceof Error ? error.message : 'Unknown error',
          latencyMs: Date.now() - start,
        };
      }
    },
  };
}

/**
 * Sandbox health check factory
 */
export function createSandboxHealthCheck(
  getStats: () => Promise<{
    activeContainers: number;
    maxContainers: number;
    runtimeAvailable: boolean;
  }>
): HealthCheck {
  return {
    name: 'sandbox',
    critical: false,
    check: async (): Promise<ComponentHealth> => {
      const start = Date.now();
      try {
        const stats = await getStats();
        let status: HealthStatus = 'healthy';

        if (!stats.runtimeAvailable) {
          status = 'unhealthy';
        } else if (stats.activeContainers >= stats.maxContainers * 0.9) {
          status = 'degraded';
        }

        return {
          name: 'sandbox',
          status,
          latencyMs: Date.now() - start,
          details: {
            activeContainers: stats.activeContainers,
            maxContainers: stats.maxContainers,
            runtimeAvailable: stats.runtimeAvailable,
          },
        };
      } catch (error) {
        return {
          name: 'sandbox',
          status: 'unhealthy',
          message: error instanceof Error ? error.message : 'Unknown error',
          latencyMs: Date.now() - start,
        };
      }
    },
  };
}

// ============================================================================
// Health Check Execution
// ============================================================================

/**
 * Run all health checks
 */
export async function checkHealth(): Promise<OverallHealth> {
  const components: ComponentHealth[] = [];
  let overallStatus: HealthStatus = 'healthy';

  // Run all checks in parallel
  const results = await Promise.allSettled(
    healthChecks.map(async (check) => {
      try {
        return await check.check();
      } catch (error) {
        return {
          name: check.name,
          status: 'unhealthy' as HealthStatus,
          message: error instanceof Error ? error.message : 'Check failed',
        };
      }
    })
  );

  // Process results
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const check = healthChecks[i];

    let componentHealth: ComponentHealth;
    if (result.status === 'fulfilled') {
      componentHealth = result.value;
    } else {
      componentHealth = {
        name: check.name,
        status: 'unhealthy',
        message: result.reason?.message ?? 'Check failed',
      };
    }

    components.push(componentHealth);

    // Update overall status
    if (componentHealth.status === 'unhealthy') {
      if (check.critical) {
        overallStatus = 'unhealthy';
      } else if (overallStatus === 'healthy') {
        overallStatus = 'degraded';
      }
    } else if (componentHealth.status === 'degraded' && overallStatus === 'healthy') {
      overallStatus = 'degraded';
    }
  }

  return {
    status: overallStatus,
    version: process.env.npm_package_version ?? '0.0.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    components,
  };
}

/**
 * Check if system is alive (for liveness probe)
 */
export function isAlive(): boolean {
  // Basic liveness check - if the event loop is running, we're alive
  return true;
}

/**
 * Check if system is ready (for readiness probe)
 */
export async function isReady(): Promise<boolean> {
  const health = await checkHealth();
  return health.status !== 'unhealthy';
}

// ============================================================================
// Fastify Routes
// ============================================================================

/**
 * Register health check routes
 */
export async function registerHealthRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /health
   * Full health check with component details
   */
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const health = await checkHealth();
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;

    return reply.status(statusCode).send({
      success: health.status !== 'unhealthy',
      data: health,
    });
  });

  /**
   * GET /health/live
   * Kubernetes liveness probe
   */
  fastify.get('/health/live', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isAlive()) {
      return reply.status(200).send({ status: 'alive' });
    }
    return reply.status(503).send({ status: 'dead' });
  });

  /**
   * GET /health/ready
   * Kubernetes readiness probe
   */
  fastify.get('/health/ready', async (request: FastifyRequest, reply: FastifyReply) => {
    const ready = await isReady();
    if (ready) {
      return reply.status(200).send({ status: 'ready' });
    }
    return reply.status(503).send({ status: 'not_ready' });
  });

  /**
   * GET /metrics
   * Prometheus metrics endpoint
   */
  fastify.get('/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    // Import here to avoid circular dependency
    const { getMetrics, getMetricsContentType } = await import('./metrics.js');
    const metrics = await getMetrics();

    return reply
      .header('Content-Type', getMetricsContentType())
      .send(metrics);
  });

  logger.info('Health check routes registered');
}

/**
 * Initialize health check system
 */
export function initHealthChecks(): void {
  startTime = Date.now();

  // Register default memory health check
  registerHealthCheck(createMemoryHealthCheck());

  logger.info('Health check system initialized');
}
