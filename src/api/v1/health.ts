/**
 * API v1 Health Check Routes
 *
 * Provides Kubernetes-compatible health check endpoints:
 * - /health/live - Liveness probe (is the process alive?)
 * - /health/ready - Readiness probe (can it handle requests?)
 * - /health/startup - Startup probe (has initialization completed?)
 * - /health/detailed - Full system status with circuit breaker states
 *
 * Circuit breaker integration:
 * - Returns "degraded" status when any circuit is open
 * - Includes which services are affected
 * - Provides time until circuit reset
 *
 * @packageDocumentation
 */

import { getAllCircuitBreakerStatuses } from '../../common/circuit-breaker.js';
import { getConfig } from '../../common/config.js';
import { checkDatabaseHealthWithCircuit } from '../../common/database-resilience.js';
import { createLogger } from '../../common/logger.js';
import { checkRedisHealthWithCircuit } from '../../common/redis-resilience.js';
import {
  intentReadinessCheck as intentModuleReadinessCheck,
  livenessProbe,
  startupProbe,
  readinessProbe,
  getUptimeSeconds,
} from '../../intent/health.js';
import { getMigrationStatusForHealth } from '../../db/migration-checker.js';
import {
  checkQueueHealth,
  areWorkersRunning,
  type QueueHealthCheckResult,
} from '../../intent/queues.js';
import type { CircuitState } from '../../common/circuit-breaker.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

/** Default queue depth threshold before marking as unhealthy */
const DEFAULT_QUEUE_DEPTH_THRESHOLD = 10000;

const healthLogger = createLogger({ component: 'api-v1-health' });

/**
 * Check if lite mode is enabled
 * Supports both VORION_LITE_MODE and VORION_LITE_ENABLED for compatibility
 */
function isLiteMode(): boolean {
  return process.env['VORION_LITE_MODE'] === 'true' ||
         process.env['VORION_LITE_ENABLED'] === 'true';
}

/**
 * Register v1 health check routes
 */
export async function registerHealthRoutesV1(fastify: FastifyInstance): Promise<void> {
  const liteMode = isLiteMode();

  // ==========================================================================
  // Kubernetes Probe Endpoints
  // ==========================================================================

  /**
   * Liveness probe endpoint - GET /health/live
   *
   * Fast check that only verifies the process is alive.
   * Should return quickly and NOT check external dependencies.
   *
   * Kubernetes uses this to determine if the container needs to be restarted.
   * If this endpoint fails, Kubernetes will restart the container.
   *
   * Returns:
   * - 200 OK if the process is alive
   * - 503 Service Unavailable if the process is unhealthy
   */
  fastify.get('/health/live', async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await livenessProbe();
    const statusCode = result.alive ? 200 : 503;

    return reply.status(statusCode).send({
      alive: result.alive,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * Readiness probe endpoint - GET /health/ready
   *
   * Checks if the service can handle requests by verifying all dependencies.
   * In lite mode, only database is required. In full mode, Redis and queues are also required.
   *
   * Queue health check includes:
   * - Queue depth (waiting + active jobs)
   * - Worker availability
   * - Processing latency via canary job
   *
   * Kubernetes uses this to determine if the pod should receive traffic.
   * If this endpoint fails, the pod is removed from service endpoints.
   *
   * Returns:
   * - 200 OK if the service is ready to handle requests
   * - 503 Service Unavailable if any critical dependency is unhealthy
   */
  fastify.get('/health/ready', async (_request: FastifyRequest, reply: FastifyReply) => {
    const config = getConfig();
    const queueDepthThreshold = config.intent.queueDepthThreshold ?? DEFAULT_QUEUE_DEPTH_THRESHOLD;

    // Get basic readiness probe result
    const result = await readinessProbe(liteMode);

    // In full mode, also check queue health
    let queueHealth: QueueHealthCheckResult | null = null;
    let queueHealthy = true;

    if (!liteMode) {
      try {
        queueHealth = await checkQueueHealth({
          runCanary: true,
          canaryTimeoutMs: 3000, // Faster timeout for health check
          maxQueueDepth: queueDepthThreshold,
        });

        // Queue is unhealthy if:
        // 1. Workers are not available
        // 2. Queue depth exceeds threshold
        // 3. Canary job failed
        queueHealthy = queueHealth.healthy;

        if (!queueHealthy) {
          healthLogger.warn(
            {
              workersAvailable: queueHealth.workersAvailable,
              queueDepth: queueHealth.queueDepth,
              maxQueueDepth: queueDepthThreshold,
              canaryResult: queueHealth.canaryJobResult,
            },
            'Queue health check failed'
          );
        }
      } catch (error) {
        healthLogger.error({ error }, 'Error checking queue health');
        queueHealthy = false;
      }
    }

    // Combine all health checks
    const isHealthy = result.healthy && queueHealthy;
    const statusCode = isHealthy ? 200 : 503;

    return reply.status(statusCode).send({
      status: isHealthy ? 'ready' : 'not_ready',
      mode: liteMode ? 'lite' : 'full',
      checks: {
        ...result.checks,
        ...(queueHealth && {
          queue: {
            healthy: queueHealth.healthy,
            workersAvailable: queueHealth.workersAvailable,
            queueDepth: queueHealth.queueDepth,
            maxQueueDepth: queueDepthThreshold,
            activeJobs: queueHealth.activeJobs,
            waitingJobs: queueHealth.waitingJobs,
            failedJobs: queueHealth.failedJobs,
            deadLetterCount: queueHealth.deadLetterCount,
            processingLatencyMs: queueHealth.processingLatency,
            canaryJob: queueHealth.canaryJobResult,
          },
        }),
      },
      timestamp: result.timestamp,
    });
  });

  /**
   * Startup probe endpoint - GET /health/startup
   *
   * One-time check during container startup to verify all dependencies
   * are available before marking the container as ready.
   *
   * Includes migration status check:
   * - Returns unhealthy if migrations are pending and auto-migrate is disabled
   * - Shows schema version and pending migration count
   *
   * Kubernetes uses this to determine when the container has finished
   * starting up. Until this probe succeeds, liveness and readiness probes
   * are not checked.
   *
   * Returns:
   * - 200 OK if initialization is complete
   * - 503 Service Unavailable if still initializing or failed
   */
  fastify.get('/health/startup', async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await startupProbe(liteMode);

    // Check migration status
    const migrationStatus = await getMigrationStatusForHealth();

    // Startup is ready only if both base checks pass and migrations are healthy
    const isReady = result.ready && migrationStatus.healthy;
    const statusCode = isReady ? 200 : 503;

    return reply.status(statusCode).send({
      status: isReady ? 'started' : 'starting',
      mode: liteMode ? 'lite' : 'full',
      checks: {
        ...result.checks,
        migrations: {
          status: migrationStatus.status,
          healthy: migrationStatus.healthy,
          schemaVersion: migrationStatus.details.schemaVersion,
          pendingCount: migrationStatus.details.pendingCount,
          lastApplied: migrationStatus.details.lastApplied,
          autoMigrateEnabled: migrationStatus.details.autoMigrateEnabled,
          error: migrationStatus.error,
        },
      },
      durationMs: result.durationMs,
      timestamp: result.timestamp,
    });
  });

  // ==========================================================================
  // Detailed Health Endpoints
  // ==========================================================================

  /**
   * Detailed health status - GET /health
   *
   * Returns comprehensive health information including:
   * - All component statuses
   * - Circuit breaker states
   * - Memory usage
   * - Uptime
   * - Version information
   *
   * Status values:
   * - healthy: All components and circuits are functioning normally
   * - degraded: Some circuits are open but service can still function
   * - unhealthy: Critical components are unavailable
   */
  fastify.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    const config = getConfig();
    const memUsage = process.memoryUsage();

    // Get health status with circuit breaker info
    const dbHealthWithCircuit = await checkDatabaseHealthWithCircuit();
    const redisHealthWithCircuit = liteMode
      ? { healthy: true, latencyMs: 0, circuit: { state: 'CLOSED' as CircuitState, failureCount: 0, failureThreshold: 5, timeUntilReset: null } }
      : await checkRedisHealthWithCircuit();

    // Determine overall status
    // - healthy: all services healthy, all circuits closed
    // - degraded: some circuits open but service can function
    // - unhealthy: critical services unavailable
    const anyCircuitOpen = dbHealthWithCircuit.circuit.state === 'OPEN' ||
      (!liteMode && redisHealthWithCircuit.circuit.state === 'OPEN');
    const anyHalfOpen = dbHealthWithCircuit.circuit.state === 'HALF_OPEN' ||
      (!liteMode && redisHealthWithCircuit.circuit.state === 'HALF_OPEN');

    const isHealthy = liteMode
      ? dbHealthWithCircuit.healthy
      : dbHealthWithCircuit.healthy && redisHealthWithCircuit.healthy;

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    if (!isHealthy) {
      overallStatus = 'unhealthy';
    } else if (anyCircuitOpen || anyHalfOpen) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'healthy';
    }

    // List affected services (circuits that are open)
    const affectedServices: string[] = [];
    if (dbHealthWithCircuit.circuit.state === 'OPEN') {
      affectedServices.push('database');
    }
    if (!liteMode && redisHealthWithCircuit.circuit.state === 'OPEN') {
      affectedServices.push('redis');
    }

    const statusCode = overallStatus === 'unhealthy' ? 503 : overallStatus === 'degraded' ? 200 : 200;

    return reply.status(statusCode).send({
      status: overallStatus,
      mode: liteMode ? 'lite' : 'full',
      version: process.env['npm_package_version'] ?? '0.1.0',
      environment: config.env,
      uptime: getUptimeSeconds(),
      timestamp: new Date().toISOString(),
      affectedServices: affectedServices.length > 0 ? affectedServices : undefined,
      checks: {
        database: {
          status: dbHealthWithCircuit.healthy ? 'ok' : 'error',
          latencyMs: dbHealthWithCircuit.latencyMs,
          message: dbHealthWithCircuit.error,
          circuit: {
            state: dbHealthWithCircuit.circuit.state,
            failureCount: dbHealthWithCircuit.circuit.failureCount,
            failureThreshold: dbHealthWithCircuit.circuit.failureThreshold,
            timeUntilResetMs: dbHealthWithCircuit.circuit.timeUntilReset,
          },
        },
        redis: liteMode
          ? { status: 'skipped', message: 'Not required in lite mode' }
          : {
              status: redisHealthWithCircuit.healthy ? 'ok' : 'error',
              latencyMs: redisHealthWithCircuit.latencyMs,
              message: redisHealthWithCircuit.error,
              circuit: {
                state: redisHealthWithCircuit.circuit.state,
                failureCount: redisHealthWithCircuit.circuit.failureCount,
                failureThreshold: redisHealthWithCircuit.circuit.failureThreshold,
                timeUntilResetMs: redisHealthWithCircuit.circuit.timeUntilReset,
              },
            },
      },
      process: {
        memoryMb: {
          rss: Math.round(memUsage.rss / 1024 / 1024),
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        },
        uptimeSeconds: Math.round(process.uptime()),
      },
    });
  });

  /**
   * Detailed health status with full circuit breaker information - GET /health/detailed
   *
   * Returns comprehensive health information including:
   * - All component statuses with full details
   * - All circuit breaker states (not just core services)
   * - Memory and CPU usage
   * - Connection pool stats
   * - Version and build information
   *
   * This endpoint is intended for:
   * - Monitoring dashboards
   * - Debugging production issues
   * - Capacity planning
   */
  fastify.get('/health/detailed', async (_request: FastifyRequest, reply: FastifyReply) => {
    const config = getConfig();
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // Get all circuit breaker statuses
    const circuitBreakers = await getAllCircuitBreakerStatuses();
    const circuitBreakerDetails: Record<string, unknown> = {};
    let hasOpenCircuit = false;
    let hasHalfOpenCircuit = false;
    const affectedServices: string[] = [];

    for (const [name, status] of circuitBreakers.entries()) {
      circuitBreakerDetails[name] = {
        state: status.state,
        failureCount: status.failureCount,
        failureThreshold: status.failureThreshold,
        resetTimeoutMs: status.resetTimeoutMs,
        halfOpenMaxAttempts: status.halfOpenMaxAttempts,
        halfOpenAttempts: status.halfOpenAttempts,
        monitorWindowMs: status.monitorWindowMs,
        lastFailureTime: status.lastFailureTime?.toISOString() ?? null,
        openedAt: status.openedAt?.toISOString() ?? null,
        timeUntilResetMs: status.timeUntilReset,
      };

      if (status.state === 'OPEN') {
        hasOpenCircuit = true;
        affectedServices.push(name);
      } else if (status.state === 'HALF_OPEN') {
        hasHalfOpenCircuit = true;
      }
    }

    // Get health with circuit breaker info
    const dbHealthWithCircuit = await checkDatabaseHealthWithCircuit();
    const redisHealthWithCircuit = liteMode
      ? { healthy: true, latencyMs: 0, circuit: { state: 'CLOSED' as CircuitState, failureCount: 0, failureThreshold: 5, timeUntilReset: null } }
      : await checkRedisHealthWithCircuit();

    // Determine overall status
    const isHealthy = liteMode
      ? dbHealthWithCircuit.healthy
      : dbHealthWithCircuit.healthy && redisHealthWithCircuit.healthy;

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    if (!isHealthy) {
      overallStatus = 'unhealthy';
    } else if (hasOpenCircuit || hasHalfOpenCircuit) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'healthy';
    }

    const statusCode = overallStatus === 'unhealthy' ? 503 : 200;

    return reply.status(statusCode).send({
      status: overallStatus,
      mode: liteMode ? 'lite' : 'full',
      version: process.env['npm_package_version'] ?? '0.1.0',
      environment: config.env,
      nodeVersion: process.version,
      uptime: getUptimeSeconds(),
      timestamp: new Date().toISOString(),

      // Affected services list
      affectedServices: affectedServices.length > 0 ? affectedServices : undefined,

      // Core service health
      services: {
        database: {
          healthy: dbHealthWithCircuit.healthy,
          latencyMs: dbHealthWithCircuit.latencyMs,
          error: dbHealthWithCircuit.error,
          circuit: {
            state: dbHealthWithCircuit.circuit.state,
            failureCount: dbHealthWithCircuit.circuit.failureCount,
            failureThreshold: dbHealthWithCircuit.circuit.failureThreshold,
            timeUntilResetMs: dbHealthWithCircuit.circuit.timeUntilReset,
          },
        },
        redis: liteMode
          ? { status: 'skipped', message: 'Not required in lite mode' }
          : {
              healthy: redisHealthWithCircuit.healthy,
              latencyMs: redisHealthWithCircuit.latencyMs,
              error: redisHealthWithCircuit.error,
              circuit: {
                state: redisHealthWithCircuit.circuit.state,
                failureCount: redisHealthWithCircuit.circuit.failureCount,
                failureThreshold: redisHealthWithCircuit.circuit.failureThreshold,
                timeUntilResetMs: redisHealthWithCircuit.circuit.timeUntilReset,
              },
            },
        queues: await (async () => {
          if (liteMode) {
            return { status: 'skipped', message: 'Not required in lite mode' };
          }

          try {
            const queueHealth = await checkQueueHealth({
              runCanary: true,
              canaryTimeoutMs: 5000,
              maxQueueDepth: config.intent.queueDepthThreshold ?? DEFAULT_QUEUE_DEPTH_THRESHOLD,
            });

            return {
              healthy: queueHealth.healthy,
              workersAvailable: queueHealth.workersAvailable,
              workersRunning: areWorkersRunning(),
              queueDepth: queueHealth.queueDepth,
              maxQueueDepth: config.intent.queueDepthThreshold ?? DEFAULT_QUEUE_DEPTH_THRESHOLD,
              processingLatencyMs: queueHealth.processingLatency,
              jobs: {
                active: queueHealth.activeJobs,
                waiting: queueHealth.waitingJobs,
                completed: queueHealth.completedJobs,
                failed: queueHealth.failedJobs,
                deadLetter: queueHealth.deadLetterCount,
              },
              details: queueHealth.details,
              canaryJob: queueHealth.canaryJobResult,
            };
          } catch (error) {
            healthLogger.error({ error }, 'Error getting detailed queue health');
            return {
              healthy: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            };
          }
        })(),
      },

      // All circuit breakers
      circuitBreakers: circuitBreakerDetails,

      // Process information
      process: {
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
        memory: {
          rss: Math.round(memUsage.rss / 1024 / 1024),
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
          external: Math.round(memUsage.external / 1024 / 1024),
          arrayBuffers: Math.round((memUsage.arrayBuffers ?? 0) / 1024 / 1024),
        },
        cpu: {
          user: Math.round(cpuUsage.user / 1000), // Convert to ms
          system: Math.round(cpuUsage.system / 1000),
        },
      },

      // Configuration summary (non-sensitive)
      config: {
        database: {
          poolMin: config.database.poolMin,
          poolMax: config.database.poolMax,
          statementTimeoutMs: config.database.statementTimeoutMs,
        },
        circuitBreaker: {
          database: config.circuitBreaker.database,
          redis: config.circuitBreaker.redis,
        },
        health: {
          checkTimeoutMs: config.health.checkTimeoutMs,
          readyTimeoutMs: config.health.readyTimeoutMs,
          livenessTimeoutMs: config.health.livenessTimeoutMs,
        },
      },
    });
  });

  // ==========================================================================
  // Legacy INTENT Module Endpoints (for backward compatibility)
  // ==========================================================================

  /**
   * Intent module health check - GET /intent/health
   *
   * Simple health check for the INTENT module.
   */
  fastify.get('/intent/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      status: 'healthy',
      service: 'intent',
      version: 'v1',
      mode: liteMode ? 'lite' : 'full',
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * Intent module readiness check - GET /intent/ready
   *
   * Detailed readiness check for the INTENT module including
   * queue and policy loader status.
   */
  fastify.get('/intent/ready', async (_request: FastifyRequest, reply: FastifyReply) => {
    // In lite mode, use the simplified readiness probe
    if (liteMode) {
      const result = await readinessProbe(true);
      const statusCode = result.healthy ? 200 : 503;

      return reply.status(statusCode).send({
        status: result.healthy ? 'healthy' : 'unhealthy',
        module: 'intent',
        version: 'v1',
        mode: 'lite',
        checks: result.checks,
        timestamp: result.timestamp,
      });
    }

    // Full mode uses the complete readiness check
    const healthStatus = await intentModuleReadinessCheck();
    const statusCode = healthStatus.status === 'healthy' ? 200 : 503;

    return reply.status(statusCode).send({
      ...healthStatus,
      module: 'intent',
      version: 'v1',
      mode: 'full',
    });
  });

  healthLogger.debug({ liteMode }, 'Health routes registered');
}
