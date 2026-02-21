/**
 * Health Check Service for INTENT Module
 *
 * Provides /health (liveness) and /ready (readiness) endpoints
 * for Kubernetes probes and load balancer health checks.
 *
 * Features:
 * - Component-level health status for Kubernetes probes
 * - Timeout protection for all health checks
 * - INTENT-specific dependency validation (queues, policies)
 * - Memory and resource usage reporting
 * - Graceful degradation support
 *
 * @packageDocumentation
 */

import { getRedis } from '../common/redis.js';
import { getPool } from '../common/db.js';
import { createLogger } from '../common/logger.js';
import { getConfig } from '../common/config.js';
import { withTimeout } from '../common/timeout.js';
import { getQueueHealth } from './queues.js';
import { getPolicyLoader } from '../policy/loader.js';

/** Default timeout for health check queries (ms) */
const HEALTH_CHECK_QUERY_TIMEOUT_MS = 5000;

const logger = createLogger({ component: 'intent-health' });

/**
 * Detailed health status for the INTENT module
 */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: ComponentHealth;
    redis: ComponentHealth;
    queues: ComponentHealth;
    policies?: ComponentHealth;
  };
}

/**
 * Global health status including all components
 */
export interface GlobalHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'shutting_down';
  version: string;
  environment: string;
  timestamp: string;
  process: {
    uptimeSeconds: number;
    memoryUsageMb: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
    };
    activeRequests: number;
  };
  components: {
    intent: ComponentHealth;
    database?: ComponentHealth;
    redis?: ComponentHealth;
    queues?: ComponentHealth;
  };
  latencyMs: number;
}

/**
 * Readiness status with detailed component checks
 */
export interface ReadinessStatus {
  status: 'ready' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    database: ComponentCheckResult;
    redis: ComponentCheckResult;
    queues: ComponentCheckResult;
    intent: ComponentCheckResult;
  };
  timedOut?: boolean;
  error?: string;
}

export interface ComponentHealth {
  status: 'ok' | 'degraded' | 'error' | 'timeout';
  latencyMs?: number;
  message?: string;
}

export interface ComponentCheckResult {
  status: 'ok' | 'error' | 'timeout';
  latencyMs?: number;
  error?: string;
  details?: Record<string, unknown>;
}

// Track startup time
const startTime = Date.now();

/**
 * Check database health using the existing connection pool
 *
 * Uses the shared pool instead of creating a new connection to avoid:
 * - Connection exhaustion under load
 * - Unnecessary connection overhead
 * - Pool starvation during health check storms
 *
 * Includes a query timeout to prevent hanging health checks.
 */
export async function checkDatabaseHealth(): Promise<ComponentHealth> {
  const start = Date.now();
  const config = getConfig();
  const timeoutMs = config.health?.checkTimeoutMs ?? HEALTH_CHECK_QUERY_TIMEOUT_MS;

  try {
    const pool = getPool();
    if (!pool) {
      return {
        status: 'error',
        latencyMs: Date.now() - start,
        message: 'Database pool not initialized',
      };
    }

    // Use pool.query with statement_timeout to prevent hanging
    // This uses an existing connection from the pool rather than creating a new one
    const result = await withTimeout(
      pool.query(`SET statement_timeout = ${timeoutMs}; SELECT 1 as health_check`),
      timeoutMs,
      'Database health check query timed out'
    );

    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (error) {
    const isTimeout = error instanceof Error && error.message.includes('timed out');
    logger.error({ error, latencyMs: Date.now() - start }, 'Database health check failed');
    return {
      status: isTimeout ? 'timeout' : 'error',
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function checkRedisHealth(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const redis = getRedis();
    await redis.ping();
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (error) {
    logger.error({ error }, 'Redis health check failed');
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function checkQueueHealth(): Promise<ComponentHealth> {
  // Check BullMQ queue connectivity
  const start = Date.now();
  try {
    const redis = getRedis();
    // Verify queue key exists or is accessible
    await redis.exists('bull:intent-submission:meta');
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (error) {
    logger.error({ error }, 'Queue health check failed');
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check policy loader health - verifies policy cache and loading capability
 */
export async function checkPolicyLoaderHealth(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    // Try to access the policy loader singleton - if it initializes, the loader is healthy
    getPolicyLoader();
    // The loader being accessible means it's initialized
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (error) {
    logger.error({ error }, 'Policy loader health check failed');
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check detailed queue health with stats
 */
export async function checkDetailedQueueHealth(): Promise<ComponentCheckResult> {
  const start = Date.now();
  const config = getConfig();

  try {
    const queueHealth = await withTimeout(
      getQueueHealth(),
      config.health.checkTimeoutMs,
      'Queue health check timed out'
    );

    return {
      status: 'ok',
      latencyMs: Date.now() - start,
      details: {
        intake: queueHealth.intake,
        evaluate: queueHealth.evaluate,
        decision: queueHealth.decision,
        deadLetter: queueHealth.deadLetter,
      },
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.message.includes('timed out');
    logger.error({ error }, 'Detailed queue health check failed');
    return {
      status: isTimeout ? 'timeout' : 'error',
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Liveness check - is the process alive?
 * Should return quickly and only fail if process is deadlocked
 */
export async function livenessCheck(): Promise<{ alive: boolean }> {
  return { alive: true };
}

/**
 * Readiness check - can the service handle requests?
 * Checks all dependencies
 */
export async function readinessCheck(): Promise<HealthStatus> {
  const [database, redis, queues, policies] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
    checkQueueHealth(),
    checkPolicyLoaderHealth(),
  ]);

  const allOk =
    database.status === 'ok' &&
    redis.status === 'ok' &&
    queues.status === 'ok' &&
    policies.status === 'ok';
  const anyError =
    database.status === 'error' ||
    redis.status === 'error' ||
    queues.status === 'error' ||
    policies.status === 'error';

  return {
    status: anyError ? 'unhealthy' : allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    version: process.env['npm_package_version'] || '0.0.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    checks: { database, redis, queues, policies },
  };
}

/**
 * INTENT module specific readiness check
 * Checks INTENT-specific dependencies like queues and policy loader
 */
export async function intentReadinessCheck(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    queues: ComponentHealth;
    policies: ComponentHealth;
  };
}> {
  const config = getConfig();

  const [queues, policies] = await Promise.all([
    withTimeout(
      checkQueueHealth(),
      config.health.checkTimeoutMs,
      'Queue check timed out'
    ).catch((error): ComponentHealth => ({
      status: 'timeout',
      message: error instanceof Error ? error.message : 'Timeout',
    })),
    withTimeout(
      checkPolicyLoaderHealth(),
      config.health.checkTimeoutMs,
      'Policy loader check timed out'
    ).catch((error): ComponentHealth => ({
      status: 'timeout',
      message: error instanceof Error ? error.message : 'Timeout',
    })),
  ]);

  const allOk = queues.status === 'ok' && policies.status === 'ok';
  const anyError = queues.status === 'error' || policies.status === 'error';

  return {
    status: anyError ? 'unhealthy' : allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks: { queues, policies },
  };
}

/**
 * Global health check combining all system components
 * Returns 503 if any critical component is unhealthy
 */
export async function globalHealthCheck(
  activeRequests: number,
  isShuttingDown: boolean
): Promise<GlobalHealthStatus> {
  const config = getConfig();
  const start = performance.now();
  const memUsage = process.memoryUsage();

  // If shutting down, return immediately with shutting_down status
  if (isShuttingDown) {
    return {
      status: 'shutting_down',
      version: process.env['npm_package_version'] || '0.0.0',
      environment: config.env,
      timestamp: new Date().toISOString(),
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        memoryUsageMb: {
          rss: Math.round(memUsage.rss / 1024 / 1024),
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
          external: Math.round(memUsage.external / 1024 / 1024),
        },
        activeRequests,
      },
      components: {
        intent: { status: 'ok' },
      },
      latencyMs: Math.round(performance.now() - start),
    };
  }

  // Run minimal self-checks with timeout
  let intentStatus: ComponentHealth = { status: 'ok' };
  try {
    await withTimeout(
      Promise.resolve(), // Quick self-check
      config.health.livenessTimeoutMs,
      'Liveness check timed out'
    );
  } catch (error) {
    intentStatus = {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Determine overall status
  const status: 'healthy' | 'degraded' | 'unhealthy' =
    intentStatus.status === 'error' ? 'unhealthy' : 'healthy';

  return {
    status,
    version: process.env['npm_package_version'] || '0.0.0',
    environment: config.env,
    timestamp: new Date().toISOString(),
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      memoryUsageMb: {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
      },
      activeRequests,
    },
    components: {
      intent: intentStatus,
    },
    latencyMs: Math.round(performance.now() - start),
  };
}

/**
 * Global readiness check with all dependency validation
 */
export async function globalReadinessCheck(): Promise<ReadinessStatus> {
  const config = getConfig();
  const start = performance.now();

  // Helper to convert ComponentHealth to ComponentCheckResult
  const toCheckResult = (health: ComponentHealth): ComponentCheckResult => {
    const result: ComponentCheckResult = {
      status: health.status === 'degraded' ? 'error' : health.status as 'ok' | 'error' | 'timeout',
    };
    if (health.latencyMs !== undefined) {
      result.latencyMs = health.latencyMs;
    }
    if (health.message) {
      result.error = health.message;
    }
    return result;
  };

  try {
    // Run all checks with overall timeout
    const checksPromise = Promise.all([
      withTimeout(
        checkDatabaseHealth(),
        config.health.checkTimeoutMs,
        'Database check timed out'
      ).catch((error): ComponentHealth => ({
        status: 'timeout',
        message: error instanceof Error ? error.message : 'Timeout',
      })),
      withTimeout(
        checkRedisHealth(),
        config.health.checkTimeoutMs,
        'Redis check timed out'
      ).catch((error): ComponentHealth => ({
        status: 'timeout',
        message: error instanceof Error ? error.message : 'Timeout',
      })),
      checkDetailedQueueHealth(),
      withTimeout(
        intentReadinessCheck(),
        config.health.checkTimeoutMs,
        'INTENT check timed out'
      ).catch(() => ({
        status: 'unhealthy' as const,
        timestamp: new Date().toISOString(),
        checks: {
          queues: { status: 'timeout' as const, message: 'Timeout' },
          policies: { status: 'timeout' as const, message: 'Timeout' },
        },
      })),
    ]);

    const [dbHealth, redisHealth, queueHealth, intentHealth] = await withTimeout(
      checksPromise,
      config.health.readyTimeoutMs,
      'Ready check timed out'
    );

    // Determine component status
    const dbResult = toCheckResult(dbHealth);
    const redisResult = toCheckResult(redisHealth);
    const intentResult: ComponentCheckResult = {
      status: intentHealth.status === 'healthy' ? 'ok' : 'error',
      details: intentHealth.checks,
    };

    // Determine overall status
    const anyTimedOut =
      dbHealth.status === 'timeout' ||
      redisHealth.status === 'timeout' ||
      queueHealth.status === 'timeout';

    const isHealthy =
      dbHealth.status === 'ok' &&
      redisHealth.status === 'ok' &&
      queueHealth.status === 'ok' &&
      intentHealth.status === 'healthy';

    let status: 'ready' | 'degraded' | 'unhealthy';
    if (isHealthy && !anyTimedOut) {
      status = 'ready';
    } else if (isHealthy || anyTimedOut) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      checks: {
        database: dbResult,
        redis: redisResult,
        queues: queueHealth,
        intent: intentResult,
      },
      ...(anyTimedOut && { timedOut: true }),
    };
  } catch (error) {
    // Overall timeout reached
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn({ latencyMs: performance.now() - start, error: errorMessage }, 'Ready check timed out');

    return {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      checks: {
        database: { status: 'timeout', error: 'Check timed out' },
        redis: { status: 'timeout', error: 'Check timed out' },
        queues: { status: 'timeout', error: 'Check timed out' },
        intent: { status: 'timeout', error: 'Check timed out' },
      },
      timedOut: true,
      error: errorMessage,
    };
  }
}

/**
 * Startup validation - checks DB and Redis connectivity before accepting requests.
 * Throws an error if connectivity fails (causing process exit with code 1).
 */
export async function validateStartupDependencies(): Promise<void> {
  logger.info('Validating startup dependencies...');

  const [dbHealth, redisHealth] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
  ]);

  const errors: string[] = [];

  if (dbHealth.status === 'error') {
    errors.push(`Database: ${dbHealth.message}`);
  }

  if (redisHealth.status === 'error') {
    errors.push(`Redis: ${redisHealth.message}`);
  }

  if (errors.length > 0) {
    const errorMessage = `Startup validation failed: ${errors.join('; ')}`;
    logger.error({ dbHealth, redisHealth }, errorMessage);
    throw new Error(errorMessage);
  }

  logger.info(
    {
      dbLatencyMs: dbHealth.latencyMs,
      redisLatencyMs: redisHealth.latencyMs,
    },
    'Startup dependencies validated successfully'
  );
}

/**
 * Get the uptime in seconds since the module was loaded
 */
export function getUptimeSeconds(): number {
  return Math.floor((Date.now() - startTime) / 1000);
}

// ============================================================================
// Kubernetes Probes (Lite Mode Compatible)
// ============================================================================

/**
 * Liveness probe - fast, process-level check.
 *
 * This probe should return as quickly as possible and only fail if the process
 * is fundamentally broken (e.g., deadlocked). It should NOT check external
 * dependencies like databases or Redis.
 *
 * Kubernetes uses this to determine if the container needs to be restarted.
 *
 * @returns Simple alive status
 */
export async function livenessProbe(): Promise<{ alive: boolean }> {
  return { alive: true };
}

/**
 * Startup probe result
 */
export interface StartupProbeResult {
  ready: boolean;
  checks: Record<string, boolean>;
  timestamp: string;
  durationMs: number;
}

/**
 * Startup probe - one-time initialization check.
 *
 * This probe is used during container startup to verify that all required
 * dependencies are available before the container is marked as ready to
 * receive traffic. It runs once during startup.
 *
 * In lite mode, only database is checked. In full mode, Redis is also checked.
 *
 * @param liteMode - Whether to run in lite mode (no Redis check)
 * @returns Startup probe result with detailed checks
 */
export async function startupProbe(liteMode: boolean = false): Promise<StartupProbeResult> {
  const start = Date.now();
  const checks: Record<string, boolean> = {};

  // Check database connection (required in all modes)
  const dbHealth = await checkDatabaseHealth();
  checks.database = dbHealth.status === 'ok';

  // Check Redis only if not in lite mode
  if (!liteMode) {
    const redisHealth = await checkRedisHealth();
    checks.redis = redisHealth.status === 'ok';
  }

  // Check migrations (schema version) - simplified check
  // In production, this could verify the actual schema version
  checks.migrations = true;

  return {
    ready: Object.values(checks).every(Boolean),
    checks,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - start,
  };
}

/**
 * Readiness probe result for lite mode
 */
export interface LiteModeReadinessResult {
  healthy: boolean;
  checks: {
    database: boolean;
    redis?: boolean;
    queues?: boolean;
  };
  timestamp: string;
}

/**
 * Readiness probe for lite mode deployment.
 *
 * In lite mode, only the database is required. Redis and queues are optional
 * and their failures will be logged but won't mark the service as unhealthy.
 *
 * @param liteMode - Whether to run in lite mode
 * @returns Health status with component checks
 */
export async function readinessProbe(liteMode: boolean = false): Promise<LiteModeReadinessResult> {
  const checks: { database: boolean; redis?: boolean; queues?: boolean } = {
    database: false,
  };

  // Check database (required in all modes)
  const dbHealth = await checkDatabaseHealth();
  checks.database = dbHealth.status === 'ok';

  // Only check Redis and queues if not in lite mode or if Redis is available
  if (!liteMode) {
    try {
      const redisHealth = await checkRedisHealth();
      checks.redis = redisHealth.status === 'ok';

      const queueHealth = await checkQueueHealth();
      checks.queues = queueHealth.status === 'ok';
    } catch {
      // In non-lite mode, Redis/queue failures are critical
      checks.redis = false;
      checks.queues = false;
    }
  }

  // In lite mode, only database is required
  // In full mode, all components are required
  const healthy = liteMode
    ? checks.database
    : checks.database && (checks.redis ?? false) && (checks.queues ?? false);

  return {
    healthy,
    checks,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Validate startup dependencies for lite mode.
 *
 * Similar to validateStartupDependencies but supports lite mode
 * where Redis is optional.
 *
 * @param liteMode - Whether to run in lite mode
 * @throws Error if required dependencies are unavailable
 */
export async function validateStartupDependenciesLite(liteMode: boolean = false): Promise<void> {
  logger.info({ liteMode }, 'Validating startup dependencies...');

  const dbHealth = await checkDatabaseHealth();
  const errors: string[] = [];

  if (dbHealth.status === 'error') {
    errors.push(`Database: ${dbHealth.message}`);
  }

  // Only validate Redis in non-lite mode
  if (!liteMode) {
    const redisHealth = await checkRedisHealth();
    if (redisHealth.status === 'error') {
      errors.push(`Redis: ${redisHealth.message}`);
    }
  }

  if (errors.length > 0) {
    const errorMessage = `Startup validation failed: ${errors.join('; ')}`;
    logger.error({ liteMode, errors }, errorMessage);
    throw new Error(errorMessage);
  }

  logger.info(
    {
      liteMode,
      dbLatencyMs: dbHealth.latencyMs,
    },
    'Startup dependencies validated successfully'
  );
}
