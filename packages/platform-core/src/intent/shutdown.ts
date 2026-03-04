/**
 * Graceful Shutdown Module
 *
 * Provides graceful shutdown handling for the INTENT module to ensure
 * in-flight requests are completed during deployment.
 *
 * Features:
 * - Track active HTTP requests
 * - Reject new requests during shutdown with 503 status
 * - Wait for in-flight requests to complete (with timeout)
 * - Coordinate BullMQ worker shutdown
 * - Close database and Redis connections
 * - Comprehensive shutdown metrics logging
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '../common/logger.js';
import { closeDatabase } from '../common/db.js';
import { closeRedis } from '../common/redis.js';
import {
  shutdownWorkers,
  pauseWorkers,
  waitForActiveJobs,
  shutdownCanaryQueue,
  closePooledConnections,
} from './queues.js';
import { shutdownGdprWorker } from './gdpr.js';
import { stopScheduler } from './scheduler.js';
import { shutdownAuditSystem } from './audit.js';
import { stopRateLimiter } from '../api/rate-limit.js';
import { resetRateLimitStore } from '../api/middleware/rateLimit.js';

const logger = createLogger({ component: 'shutdown' });

// Shutdown state
let isShuttingDown = false;
let activeRequests = 0;
let shutdownPromise: Promise<void> | null = null;
let shutdownStartTime: number | null = null;

// Configuration
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30000; // 30 seconds max wait
const REQUEST_POLL_INTERVAL_MS = 1000; // Check every second

/**
 * Shutdown metrics collected during graceful shutdown
 */
export interface ShutdownMetrics {
  /** Total shutdown duration in milliseconds */
  totalDurationMs: number;
  /** Time spent waiting for HTTP requests */
  httpWaitDurationMs: number;
  /** Time spent waiting for queue jobs */
  jobWaitDurationMs: number;
  /** Number of HTTP requests that were in-flight when shutdown started */
  initialActiveRequests: number;
  /** Number of HTTP requests that completed gracefully */
  completedRequests: number;
  /** Number of HTTP requests that were forcibly terminated */
  forcedTerminatedRequests: number;
  /** Number of queue jobs that were active when shutdown started */
  initialActiveJobs: number;
  /** Number of queue jobs that completed gracefully */
  completedJobs: number;
  /** Number of queue jobs that were abandoned */
  abandonedJobs: number;
  /** Whether the shutdown was forced due to timeout */
  forcedShutdown: boolean;
  /** Shutdown phases and their durations */
  phases: {
    name: string;
    durationMs: number;
    success: boolean;
    error?: string;
  }[];
}

let shutdownMetrics: ShutdownMetrics | null = null;

/**
 * Check if the server is currently shutting down
 */
export function isServerShuttingDown(): boolean {
  return isShuttingDown;
}

/**
 * Get the current number of active requests
 */
export function getActiveRequestCount(): number {
  return activeRequests;
}

/**
 * Get the last shutdown metrics (for monitoring/debugging)
 */
export function getLastShutdownMetrics(): ShutdownMetrics | null {
  return shutdownMetrics;
}

/**
 * Track a new request and return a cleanup function to call when complete.
 * The cleanup function should be called in onResponse hook.
 */
export function trackRequest(): () => void {
  if (isShuttingDown) {
    // Even during shutdown, track for monitoring purposes
    logger.warn('Request tracked during shutdown phase');
  }
  activeRequests++;
  logger.debug({ activeRequests }, 'Request started');

  let cleaned = false;
  return () => {
    if (cleaned) return; // Prevent double cleanup
    cleaned = true;
    activeRequests--;
    logger.debug({ activeRequests }, 'Request completed');
  };
}

/**
 * Wait for all active requests to complete with timeout
 */
async function waitForRequestsToComplete(timeoutMs: number): Promise<{
  completed: boolean;
  completedCount: number;
  remainingCount: number;
  durationMs: number;
}> {
  const startWait = Date.now();
  const initialCount = activeRequests;

  while (activeRequests > 0 && Date.now() - startWait < timeoutMs) {
    logger.info(
      { activeRequests, elapsedMs: Date.now() - startWait, timeoutMs },
      'Waiting for in-flight requests to complete'
    );
    await new Promise((resolve) => setTimeout(resolve, REQUEST_POLL_INTERVAL_MS));
  }

  const durationMs = Date.now() - startWait;
  const completed = activeRequests === 0;
  const completedCount = initialCount - activeRequests;

  return {
    completed,
    completedCount,
    remainingCount: activeRequests,
    durationMs,
  };
}

export interface GracefulShutdownOptions {
  /** Maximum time to wait for requests to complete in milliseconds */
  timeoutMs?: number;
  /** Skip closing database connections (for testing) */
  skipDatabase?: boolean;
  /** Skip closing Redis connections (for testing) */
  skipRedis?: boolean;
  /** Skip worker shutdown (for testing) */
  skipWorkers?: boolean;
  /** Skip scheduler shutdown (for testing) */
  skipScheduler?: boolean;
}

/**
 * Enhanced graceful shutdown options with separate timeouts
 */
export interface EnhancedShutdownOptions {
  /** Maximum time to wait for HTTP requests to complete (default: 10000ms) */
  httpTimeoutMs: number;
  /** Maximum time to wait for queue jobs to complete (default: 15000ms) */
  jobTimeoutMs: number;
  /** Force shutdown after this total time regardless of state (default: 30000ms) */
  forceAfterMs: number;
}

/**
 * Perform enhanced graceful shutdown of the server and all resources.
 *
 * Shutdown sequence:
 * 1. Stop accepting new HTTP requests
 * 2. Wait for in-flight HTTP requests to complete (with timeout)
 * 3. Pause queue workers (stop accepting new jobs)
 * 4. Wait for active jobs to complete (with timeout)
 * 5. Shutdown workers and close queue connections
 * 6. Flush audit system
 * 7. Close database connections
 * 8. Close Redis connections
 * 9. Log shutdown metrics
 *
 * @param options - Shutdown options with separate timeouts for HTTP and job completion
 */
export async function gracefulShutdown(
  options: EnhancedShutdownOptions
): Promise<ShutdownMetrics>;
export async function gracefulShutdown(
  server: FastifyInstance,
  options?: GracefulShutdownOptions
): Promise<void>;
export async function gracefulShutdown(
  serverOrOptions: FastifyInstance | EnhancedShutdownOptions,
  legacyOptions?: GracefulShutdownOptions
): Promise<void | ShutdownMetrics> {
  // Handle both old and new API signatures
  const isEnhancedOptions = (obj: unknown): obj is EnhancedShutdownOptions => {
    return typeof obj === 'object' && obj !== null && 'httpTimeoutMs' in obj;
  };

  if (isEnhancedOptions(serverOrOptions)) {
    return performEnhancedShutdown(serverOrOptions);
  }

  // Legacy API - server passed as first argument
  const server = serverOrOptions as FastifyInstance;
  const options = legacyOptions ?? {};
  return performLegacyShutdown(server, options);
}

/**
 * Enhanced shutdown implementation with detailed metrics
 */
async function performEnhancedShutdown(
  options: EnhancedShutdownOptions
): Promise<ShutdownMetrics> {
  // Prevent multiple shutdown calls
  if (shutdownPromise) {
    logger.info('Shutdown already in progress, waiting...');
    await shutdownPromise;
    return shutdownMetrics!;
  }

  isShuttingDown = true;
  shutdownStartTime = Date.now();

  const metrics: ShutdownMetrics = {
    totalDurationMs: 0,
    httpWaitDurationMs: 0,
    jobWaitDurationMs: 0,
    initialActiveRequests: activeRequests,
    completedRequests: 0,
    forcedTerminatedRequests: 0,
    initialActiveJobs: 0,
    completedJobs: 0,
    abandonedJobs: 0,
    forcedShutdown: false,
    phases: [],
  };

  const runPhase = async (
    name: string,
    fn: () => Promise<void>
  ): Promise<void> => {
    const phaseStart = Date.now();
    try {
      await fn();
      metrics.phases.push({
        name,
        durationMs: Date.now() - phaseStart,
        success: true,
      });
    } catch (error) {
      metrics.phases.push({
        name,
        durationMs: Date.now() - phaseStart,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      logger.error({ error, phase: name }, `Error during shutdown phase: ${name}`);
    }
  };

  // Create a force shutdown timer
  const forceShutdownTimer = setTimeout(() => {
    logger.warn({ forceAfterMs: options.forceAfterMs }, 'Force shutdown timeout reached');
    metrics.forcedShutdown = true;
  }, options.forceAfterMs);

  try {
    logger.info(
      {
        httpTimeoutMs: options.httpTimeoutMs,
        jobTimeoutMs: options.jobTimeoutMs,
        forceAfterMs: options.forceAfterMs,
        activeRequests,
      },
      'Enhanced graceful shutdown initiated'
    );

    // Phase 1: Wait for HTTP requests to complete
    await runPhase('http-drain', async () => {
      const result = await waitForRequestsToComplete(options.httpTimeoutMs);
      metrics.httpWaitDurationMs = result.durationMs;
      metrics.completedRequests = result.completedCount;
      metrics.forcedTerminatedRequests = result.remainingCount;

      if (!result.completed) {
        logger.warn(
          { remaining: result.remainingCount },
          'HTTP drain timeout - some requests will be forcibly terminated'
        );
      } else {
        logger.info('All HTTP requests completed gracefully');
      }
    });

    // Phase 2: Pause queue workers (stop accepting new jobs)
    await runPhase('pause-workers', async () => {
      await pauseWorkers();
    });

    // Phase 3: Wait for active jobs to complete
    await runPhase('job-drain', async () => {
      const jobStart = Date.now();
      const result = await waitForActiveJobs(options.jobTimeoutMs);
      metrics.jobWaitDurationMs = Date.now() - jobStart;

      if (!result.completed) {
        metrics.abandonedJobs = result.remainingJobs;
        logger.warn(
          { remaining: result.remainingJobs },
          'Job drain timeout - some jobs will be abandoned'
        );
      } else {
        logger.info('All active jobs completed gracefully');
      }
    });

    // Phase 4: Stop scheduler
    await runPhase('stop-scheduler', async () => {
      await stopScheduler();
    });

    // Phase 5: Shutdown workers
    await runPhase('shutdown-workers', async () => {
      // Give workers 5 seconds max for final cleanup
      await shutdownWorkers(5000);
      await shutdownGdprWorker();
      await shutdownCanaryQueue();
    });

    // Phase 6: Flush audit system
    await runPhase('flush-audit', async () => {
      await shutdownAuditSystem();
    });

    // Phase 7: Stop rate limiters
    await runPhase('stop-rate-limiters', async () => {
      stopRateLimiter();
      resetRateLimitStore();
    });

    // Phase 8: Close database connections
    await runPhase('close-database', async () => {
      await closeDatabase();
    });

    // Phase 9: Close Redis connections
    await runPhase('close-redis', async () => {
      await closePooledConnections();
      await closeRedis();
    });
  } finally {
    clearTimeout(forceShutdownTimer);
    metrics.totalDurationMs = Date.now() - shutdownStartTime;
    shutdownMetrics = metrics;

    // Log comprehensive shutdown metrics
    logger.info(
      {
        totalDurationMs: metrics.totalDurationMs,
        httpWaitDurationMs: metrics.httpWaitDurationMs,
        jobWaitDurationMs: metrics.jobWaitDurationMs,
        initialActiveRequests: metrics.initialActiveRequests,
        completedRequests: metrics.completedRequests,
        forcedTerminatedRequests: metrics.forcedTerminatedRequests,
        abandonedJobs: metrics.abandonedJobs,
        forcedShutdown: metrics.forcedShutdown,
        phases: metrics.phases.map((p) => ({
          name: p.name,
          durationMs: p.durationMs,
          success: p.success,
        })),
      },
      'Graceful shutdown complete'
    );
  }

  return metrics;
}

/**
 * Legacy shutdown implementation for backward compatibility
 */
async function performLegacyShutdown(
  server: FastifyInstance,
  options: GracefulShutdownOptions
): Promise<void> {
  // Prevent multiple shutdown calls
  if (shutdownPromise) {
    logger.info('Shutdown already in progress, waiting...');
    return shutdownPromise;
  }

  isShuttingDown = true;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

  shutdownPromise = (async () => {
    logger.info({ timeoutMs }, 'Graceful shutdown initiated');

    // 1. Stop accepting new connections
    try {
      await server.close();
      logger.info('HTTP server closed - no longer accepting connections');
    } catch (error) {
      logger.error({ error }, 'Error closing HTTP server');
    }

    // 2. Stop scheduled jobs and resign leadership
    if (!options.skipScheduler) {
      try {
        await stopScheduler();
        logger.info('Scheduler stopped and leadership resigned');
      } catch (error) {
        logger.error({ error }, 'Error stopping scheduler');
      }
    }

    // 3. Stop processing new queue jobs
    if (!options.skipWorkers) {
      try {
        await shutdownWorkers(timeoutMs / 2); // Give workers half the timeout
        logger.info('BullMQ workers shutdown complete');
      } catch (error) {
        logger.error({ error }, 'Error shutting down workers');
      }

      try {
        await shutdownGdprWorker();
        logger.info('GDPR workers shutdown complete');
      } catch (error) {
        logger.error({ error }, 'Error shutting down GDPR workers');
      }

      try {
        await shutdownCanaryQueue();
        logger.info('Canary queue shutdown complete');
      } catch (error) {
        logger.error({ error }, 'Error shutting down canary queue');
      }
    }

    // 4. Wait for in-flight HTTP requests to complete
    const requestResult = await waitForRequestsToComplete(timeoutMs / 2);

    if (!requestResult.completed) {
      logger.warn(
        { activeRequests: requestResult.remainingCount },
        'Forcing shutdown with active requests still in progress'
      );
    } else {
      logger.info('All in-flight requests completed');
    }

    // 5. Shutdown audit system (flush pending entries)
    try {
      await shutdownAuditSystem();
      logger.info('Audit system shutdown complete');
    } catch (error) {
      logger.error({ error }, 'Error shutting down audit system');
    }

    // 6. Stop rate limiters and cleanup intervals
    try {
      stopRateLimiter();
      resetRateLimitStore();
      logger.info('Rate limiters stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping rate limiters');
    }

    // 7. Close database connections
    if (!options.skipDatabase) {
      try {
        await closeDatabase();
        logger.info('Database connections closed');
      } catch (error) {
        logger.error({ error }, 'Error closing database connections');
      }
    }

    // 8. Close Redis connections
    if (!options.skipRedis) {
      try {
        await closePooledConnections();
        await closeRedis();
        logger.info('Redis connections closed');
      } catch (error) {
        logger.error({ error }, 'Error closing Redis connections');
      }
    }

    logger.info('Graceful shutdown complete');
  })();

  return shutdownPromise;
}

/**
 * Register signal handlers for graceful shutdown.
 *
 * Handles:
 * - SIGTERM: Kubernetes/Docker graceful termination
 * - SIGINT: Ctrl+C in terminal
 * - SIGQUIT: Extended timeout shutdown for debugging
 */
export function registerShutdownHandlers(
  server: FastifyInstance,
  options?: GracefulShutdownOptions
): void {
  const defaultTimeout = options?.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

  const shutdown = async (signal: string, extendedTimeout: boolean = false) => {
    const timeoutMs = extendedTimeout ? defaultTimeout * 2 : defaultTimeout;
    logger.info({ signal, timeoutMs, extendedTimeout }, 'Received shutdown signal');
    await gracefulShutdown(server, { ...options, timeoutMs });
    process.exit(0);
  };

  // SIGTERM: Kubernetes sends this for graceful termination
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // SIGINT: Ctrl+C in terminal
  process.on('SIGINT', () => shutdown('SIGINT'));

  // SIGQUIT: Extended timeout for debugging (e.g., kill -QUIT pid)
  process.on('SIGQUIT', () => shutdown('SIGQUIT', true));

  logger.debug('Shutdown signal handlers registered (SIGTERM, SIGINT, SIGQUIT)');
}

/**
 * Register enhanced signal handlers with separate HTTP and job timeouts.
 *
 * This is the recommended way to register shutdown handlers for production.
 *
 * @param options - Default shutdown options
 * @param extendedOptions - Options for SIGQUIT with extended timeouts
 */
export function registerEnhancedShutdownHandlers(
  options: EnhancedShutdownOptions,
  extendedOptions?: EnhancedShutdownOptions
): void {
  const extended = extendedOptions ?? {
    httpTimeoutMs: options.httpTimeoutMs * 2,
    jobTimeoutMs: options.jobTimeoutMs * 2,
    forceAfterMs: options.forceAfterMs * 1.5,
  };

  const shutdown = async (signal: string, opts: EnhancedShutdownOptions) => {
    logger.info(
      {
        signal,
        httpTimeoutMs: opts.httpTimeoutMs,
        jobTimeoutMs: opts.jobTimeoutMs,
        forceAfterMs: opts.forceAfterMs,
      },
      'Received shutdown signal'
    );
    await gracefulShutdown(opts);
    process.exit(0);
  };

  // SIGTERM: Kubernetes sends this for graceful termination
  process.on('SIGTERM', () => shutdown('SIGTERM', options));

  // SIGINT: Ctrl+C in terminal
  process.on('SIGINT', () => shutdown('SIGINT', options));

  // SIGQUIT: Extended timeout for debugging (e.g., kill -QUIT pid)
  process.on('SIGQUIT', () => shutdown('SIGQUIT', extended));

  logger.info(
    {
      defaultOptions: options,
      extendedOptions: extended,
    },
    'Enhanced shutdown signal handlers registered (SIGTERM, SIGINT, SIGQUIT)'
  );
}

/**
 * Default retry delay in seconds for 503 responses during shutdown
 */
const DEFAULT_RETRY_AFTER_SECONDS = 5;

/**
 * Fastify hook to reject requests during shutdown.
 * Add this to server.addHook('onRequest', ...)
 *
 * When the server is shutting down:
 * - Returns 503 Service Unavailable
 * - Includes Retry-After header (RFC 7231)
 * - Provides structured error response
 */
export async function shutdownRequestHook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (isShuttingDown) {
    logger.info(
      { url: request.url, method: request.method },
      'Rejecting request - server is shutting down'
    );

    // Set Retry-After header per RFC 7231 Section 7.1.3
    reply
      .status(503)
      .header('Retry-After', String(DEFAULT_RETRY_AFTER_SECONDS))
      .header('Connection', 'close')
      .send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The server is shutting down. Please retry your request shortly.',
        },
        retryAfter: DEFAULT_RETRY_AFTER_SECONDS,
        timestamp: new Date().toISOString(),
      });
    return;
  }

  // Track the request
  const cleanup = trackRequest();

  // Store cleanup function on request for onResponse hook
  // Use type assertion to add our custom property
  (request as FastifyRequest & { shutdownCleanup?: () => void }).shutdownCleanup = cleanup;
}

/**
 * Fastify hook to clean up request tracking.
 * Add this to server.addHook('onResponse', ...)
 */
export async function shutdownResponseHook(request: FastifyRequest): Promise<void> {
  const cleanup = (request as FastifyRequest & { shutdownCleanup?: () => void }).shutdownCleanup;
  if (cleanup) {
    cleanup();
  }
}

/**
 * Reset shutdown state (for testing purposes only)
 */
export function resetShutdownState(): void {
  isShuttingDown = false;
  activeRequests = 0;
  shutdownPromise = null;
  shutdownStartTime = null;
  shutdownMetrics = null;
}
