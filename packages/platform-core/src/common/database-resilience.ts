/**
 * Database Circuit Breaker and Resilience
 *
 * Provides circuit breaker protection for database operations to prevent
 * cascading failures when the database is unavailable or degraded.
 *
 * Features:
 * - Circuit breaker with CLOSED -> OPEN -> HALF_OPEN states
 * - Configurable failure threshold and reset timeout
 * - Statement timeout enforcement via PostgreSQL
 * - Metrics export for monitoring
 * - Graceful degradation support
 *
 * @packageDocumentation
 */

import {
  CircuitState,
  getCircuitBreaker,
  CircuitBreakerOpenError,
  withCircuitBreaker,
  withCircuitBreakerResult,
} from './circuit-breaker.js';
import { getConfig } from './config.js';
import { getPool, withStatementTimeout, DEFAULT_STATEMENT_TIMEOUT_MS } from './db.js';
import { createLogger } from './logger.js';
import type { CircuitBreaker } from './circuit-breaker.js';

const logger = createLogger({ component: 'database-resilience' });

// Re-export useful types from circuit-breaker
export { CircuitState, CircuitBreakerOpenError };

/**
 * Database operation timeout in milliseconds
 * Default: 30 seconds (configurable via config)
 */
export const DB_OPERATION_TIMEOUT_MS = 30000;

/**
 * Database circuit breaker service name
 */
export const DATABASE_SERVICE_NAME = 'database';

/**
 * Get the database circuit breaker instance
 */
export function getDatabaseCircuitBreaker(): CircuitBreaker {
  return getCircuitBreaker(DATABASE_SERVICE_NAME, (from, to, _breaker) => {
    logger.info(
      { service: DATABASE_SERVICE_NAME, fromState: from, toState: to },
      `Database circuit breaker state transition: ${from} -> ${to}`
    );
  });
}

/**
 * Check if the database circuit is currently open
 */
export async function isDatabaseCircuitOpen(): Promise<boolean> {
  const breaker = getDatabaseCircuitBreaker();
  return await breaker.isOpen();
}

/**
 * Get database circuit breaker status for monitoring
 */
export async function getDatabaseCircuitStatus(): Promise<{
  name: string;
  state: CircuitState;
  failureCount: number;
  failureThreshold: number;
  resetTimeoutMs: number;
  timeUntilReset: number | null;
}> {
  const breaker = getDatabaseCircuitBreaker();
  return await breaker.getStatus();
}

/**
 * Execute a database query with circuit breaker protection and timeout.
 *
 * This wrapper provides:
 * 1. Circuit breaker protection - fast fail when DB is unhealthy
 * 2. Statement timeout - prevents long-running queries
 * 3. Metrics recording - tracks success/failure rates
 *
 * @param fn - The database operation to execute
 * @param options - Optional configuration
 * @returns The result of the database operation
 * @throws CircuitBreakerOpenError when circuit is open
 * @throws StatementTimeoutError when query exceeds timeout
 *
 * @example
 * ```typescript
 * const users = await withDatabaseCircuitBreaker(
 *   async () => db.select().from(users).limit(100),
 *   { operationName: 'listUsers' }
 * );
 * ```
 */
export async function withDatabaseCircuitBreaker<T>(
  fn: () => Promise<T>,
  options: {
    operationName?: string;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const config = getConfig();
  const operationName = options.operationName ?? 'unknown';
  const timeoutMs = options.timeoutMs ?? config.database.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;

  // Wrap with statement timeout first, then circuit breaker
  return withCircuitBreaker(DATABASE_SERVICE_NAME, async () => {
    return withStatementTimeout(fn, timeoutMs, operationName);
  });
}

/**
 * Execute a database operation with circuit breaker protection,
 * returning a result object instead of throwing on circuit open.
 *
 * This variant is useful when you want to handle circuit open gracefully
 * without try/catch, or when you want to use a fallback value.
 *
 * @param fn - The database operation to execute
 * @param options - Optional configuration
 * @returns Result object with success flag and result/error
 *
 * @example
 * ```typescript
 * const result = await withDatabaseCircuitBreakerResult(
 *   async () => db.select().from(cache).where(eq(cache.key, key)),
 *   { operationName: 'getCacheEntry' }
 * );
 *
 * if (result.circuitOpen) {
 *   // Use fallback - maybe return cached data or default
 *   return getFromLocalCache(key) ?? defaultValue;
 * }
 *
 * return result.success ? result.result : defaultValue;
 * ```
 */
export async function withDatabaseCircuitBreakerResult<T>(
  fn: () => Promise<T>,
  options: {
    operationName?: string;
    timeoutMs?: number;
  } = {}
): Promise<{
  success: boolean;
  result?: T;
  error?: Error;
  circuitOpen: boolean;
}> {
  const config = getConfig();
  const operationName = options.operationName ?? 'unknown';
  const timeoutMs = options.timeoutMs ?? config.database.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;

  return withCircuitBreakerResult(DATABASE_SERVICE_NAME, async () => {
    return withStatementTimeout(fn, timeoutMs, operationName);
  });
}

/**
 * Execute a raw SQL query with circuit breaker protection.
 *
 * For cases where you need to execute raw SQL without Drizzle ORM.
 *
 * @param sql - SQL query string
 * @param params - Query parameters
 * @param options - Optional configuration
 * @returns Query result
 */
export async function executeWithCircuitBreaker<T = unknown>(
  sql: string,
  params: unknown[] = [],
  options: {
    operationName?: string;
    timeoutMs?: number;
  } = {}
): Promise<T[]> {
  const pool = getPool();
  if (!pool) {
    throw new Error('Database pool not initialized');
  }

  const config = getConfig();
  const timeoutMs = options.timeoutMs ?? config.database.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;

  return withCircuitBreaker(DATABASE_SERVICE_NAME, async () => {
    // Set statement timeout for this query
    const client = await pool.connect();
    try {
      await client.query(`SET statement_timeout = ${timeoutMs}`);
      const result = await client.query(sql, params);
      return result.rows as T[];
    } finally {
      client.release();
    }
  });
}

/**
 * Force the database circuit breaker to open state.
 * Useful for manual intervention during maintenance or incidents.
 */
export async function forceDatabaseCircuitOpen(): Promise<void> {
  const breaker = getDatabaseCircuitBreaker();
  await breaker.forceOpen();
  logger.warn({}, 'Database circuit breaker manually opened');
}

/**
 * Force the database circuit breaker to closed state.
 * Useful for manual recovery after maintenance.
 */
export async function forceDatabaseCircuitClose(): Promise<void> {
  const breaker = getDatabaseCircuitBreaker();
  await breaker.forceClose();
  logger.info({}, 'Database circuit breaker manually closed');
}

/**
 * Reset the database circuit breaker.
 * Clears all state and returns to CLOSED state.
 */
export async function resetDatabaseCircuit(): Promise<void> {
  const breaker = getDatabaseCircuitBreaker();
  await breaker.reset();
  logger.info({}, 'Database circuit breaker reset');
}

/**
 * Database health check with circuit breaker status.
 *
 * Returns comprehensive health information including:
 * - Database connectivity status
 * - Circuit breaker state
 * - Latency metrics
 */
export async function checkDatabaseHealthWithCircuit(): Promise<{
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  circuit: {
    state: CircuitState;
    failureCount: number;
    failureThreshold: number;
    timeUntilReset: number | null;
  };
}> {
  const breaker = getDatabaseCircuitBreaker();
  const status = await breaker.getStatus();

  // If circuit is open, don't even try to check database
  if (status.state === 'OPEN') {
    return {
      healthy: false,
      error: 'Circuit breaker is OPEN - database marked as unavailable',
      circuit: {
        state: status.state,
        failureCount: status.failureCount,
        failureThreshold: status.failureThreshold,
        timeUntilReset: status.timeUntilReset,
      },
    };
  }

  const pool = getPool();
  if (!pool) {
    return {
      healthy: false,
      error: 'Database pool not initialized',
      circuit: {
        state: status.state,
        failureCount: status.failureCount,
        failureThreshold: status.failureThreshold,
        timeUntilReset: status.timeUntilReset,
      },
    };
  }

  const start = performance.now();
  try {
    // Use circuit breaker for the health check itself
    const result = await withDatabaseCircuitBreakerResult(
      async () => {
        const client = await pool.connect();
        try {
          await client.query('SELECT 1 as health_check');
          return true;
        } finally {
          client.release();
        }
      },
      { operationName: 'healthCheck', timeoutMs: 5000 }
    );

    const latencyMs = Math.round(performance.now() - start);
    const updatedStatus = await breaker.getStatus();

    if (result.circuitOpen) {
      return {
        healthy: false,
        latencyMs,
        error: 'Circuit breaker is OPEN',
        circuit: {
          state: updatedStatus.state,
          failureCount: updatedStatus.failureCount,
          failureThreshold: updatedStatus.failureThreshold,
          timeUntilReset: updatedStatus.timeUntilReset,
        },
      };
    }

    return {
      healthy: result.success,
      latencyMs,
      error: result.error?.message,
      circuit: {
        state: updatedStatus.state,
        failureCount: updatedStatus.failureCount,
        failureThreshold: updatedStatus.failureThreshold,
        timeUntilReset: updatedStatus.timeUntilReset,
      },
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start);
    const updatedStatus = await breaker.getStatus();

    return {
      healthy: false,
      latencyMs,
      error: error instanceof Error ? error.message : 'Unknown error',
      circuit: {
        state: updatedStatus.state,
        failureCount: updatedStatus.failureCount,
        failureThreshold: updatedStatus.failureThreshold,
        timeUntilReset: updatedStatus.timeUntilReset,
      },
    };
  }
}
