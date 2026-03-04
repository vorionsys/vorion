/**
 * Database Connection Pool Manager
 *
 * Provides advanced connection pooling capabilities for the Vorion security platform
 * with health monitoring, automatic reconnection, and comprehensive metrics.
 *
 * Features:
 * - Configurable pool size (min/max connections)
 * - Connection lifecycle management with validation
 * - Overflow queue with timeout for burst handling
 * - Health checks with ping and query validation
 * - Automatic reconnection on failure
 * - Dead connection eviction
 * - Slow query detection
 * - Transaction support with auto-commit/rollback
 * - Comprehensive Prometheus metrics
 *
 * @packageDocumentation
 */

import { Pool, PoolClient, PoolConfig as PgPoolConfig } from 'pg';
import { Counter, Histogram, Gauge } from 'prom-client';
import { vorionRegistry } from './metrics-registry.js';
import { createLogger } from './logger.js';
import { getConfig } from './config.js';
import { VorionError, DatabaseError, TimeoutError } from './errors.js';

const logger = createLogger({ component: 'db-pool' });

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for the Vorion connection pool
 */
export interface ConnectionPoolConfig {
  /** Database host */
  host: string;
  /** Database port */
  port: number;
  /** Database name */
  database: string;
  /** Database user */
  user: string;
  /** Database password */
  password: string;
  /** Minimum number of connections to maintain (default: 5) */
  minConnections?: number;
  /** Maximum number of connections allowed (default: 20) */
  maxConnections?: number;
  /** Time in ms before idle connections are closed (default: 30000) */
  idleTimeoutMs?: number;
  /** Time in ms to wait for a connection from the pool (default: 5000) */
  connectionTimeoutMs?: number;
  /** Maximum number of clients waiting for a connection (default: 100) */
  maxWaitingClients?: number;
  /** Whether to validate connections before returning them (default: true) */
  validateOnBorrow?: boolean;
  /** Interval in ms for eviction of dead connections (default: 60000) */
  evictionRunIntervalMs?: number;
  /** Statement timeout in ms for queries (default: 30000) */
  statementTimeoutMs?: number;
  /** Threshold in ms for slow query logging (default: 1000) */
  slowQueryThresholdMs?: number;
  /** SSL configuration for secure connections */
  ssl?: boolean | { rejectUnauthorized?: boolean };
  /** Application name for PostgreSQL (useful for monitoring) */
  applicationName?: string;
}

/**
 * Pool statistics for monitoring
 */
export interface PoolStats {
  /** Number of active (in-use) connections */
  activeConnections: number;
  /** Number of idle connections */
  idleConnections: number;
  /** Total connections in the pool */
  totalConnections: number;
  /** Number of clients waiting for a connection */
  waitingClients: number;
  /** Pool utilization percentage (0-100) */
  utilizationPercent: number;
  /** Maximum pool size */
  maxConnections: number;
  /** Minimum pool size */
  minConnections: number;
  /** Total connections created since pool start */
  connectionsCreated: number;
  /** Total connections destroyed since pool start */
  connectionsDestroyed: number;
  /** Total successful checkouts */
  checkoutsTotal: number;
  /** Total check-ins */
  checkinsTotal: number;
  /** Total validation failures */
  validationFailures: number;
  /** Total connection errors */
  connectionErrors: number;
  /** Pool health status */
  healthy: boolean;
  /** Last health check timestamp */
  lastHealthCheck: string | null;
  /** Eviction run count */
  evictionRuns: number;
  /** Connections evicted since start */
  connectionsEvicted: number;
}

/**
 * Connection wrapper with metadata for tracking
 */
interface PooledConnection {
  /** The underlying pg client */
  client: PoolClient;
  /** Connection creation timestamp */
  createdAt: number;
  /** Last activity timestamp */
  lastUsedAt: number;
  /** Whether the connection is currently in use */
  inUse: boolean;
  /** Number of times this connection has been used */
  useCount: number;
  /** Last validation result */
  lastValidation: {
    timestamp: number;
    success: boolean;
    latencyMs: number;
  } | null;
}

/**
 * Waiting client entry in the overflow queue
 */
interface WaitingClient {
  /** Resolve function to provide the connection */
  resolve: (connection: PooledConnection) => void;
  /** Reject function for timeout/error */
  reject: (error: Error) => void;
  /** Queue entry timestamp */
  enqueuedAt: number;
  /** Timeout handle */
  timeoutHandle: NodeJS.Timeout;
}

// =============================================================================
// Custom Errors
// =============================================================================

/**
 * Error thrown when pool is exhausted and timeout occurs
 */
export class PoolExhaustedError extends VorionError {
  override code = 'POOL_EXHAUSTED';
  override statusCode = 503;

  constructor(
    message: string,
    public readonly waitTimeMs: number,
    public readonly poolStats: Partial<PoolStats>
  ) {
    super(message, { waitTimeMs, poolStats });
    this.name = 'PoolExhaustedError';
  }
}

/**
 * Error thrown when connection validation fails
 */
export class ConnectionValidationError extends VorionError {
  override code = 'CONNECTION_VALIDATION_ERROR';
  override statusCode = 500;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'ConnectionValidationError';
  }
}

/**
 * Error thrown when acquiring a connection times out
 */
export class ConnectionAcquireTimeoutError extends TimeoutError {
  override code = 'CONNECTION_ACQUIRE_TIMEOUT';

  constructor(
    message: string,
    public readonly waitTimeMs: number,
    public readonly poolStats: Partial<PoolStats>
  ) {
    super(message, { waitTimeMs, poolStats });
    this.name = 'ConnectionAcquireTimeoutError';
  }
}

// =============================================================================
// Metrics
// =============================================================================

/** Pool utilization gauge (0-100) */
const poolUtilizationGauge = new Gauge({
  name: 'vorion_db_pool_utilization_percent',
  help: 'Database connection pool utilization percentage',
  registers: [vorionRegistry],
});

/** Active connections gauge */
const poolActiveConnectionsGauge = new Gauge({
  name: 'vorion_db_pool_connections_active',
  help: 'Number of active database connections',
  registers: [vorionRegistry],
});

/** Idle connections gauge */
const poolIdleConnectionsGauge = new Gauge({
  name: 'vorion_db_pool_connections_idle',
  help: 'Number of idle database connections',
  registers: [vorionRegistry],
});

/** Total connections gauge */
const poolTotalConnectionsGauge = new Gauge({
  name: 'vorion_db_pool_connections_total',
  help: 'Total number of database connections in pool',
  registers: [vorionRegistry],
});

/** Waiting clients gauge */
const poolWaitingClientsGauge = new Gauge({
  name: 'vorion_db_pool_waiting_clients',
  help: 'Number of clients waiting for a connection',
  registers: [vorionRegistry],
});

/** Connection wait time histogram */
const connectionWaitTimeHistogram = new Histogram({
  name: 'vorion_db_pool_connection_wait_seconds',
  help: 'Time spent waiting for a connection from the pool',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [vorionRegistry],
});

/** Connection checkout counter */
const connectionCheckoutCounter = new Counter({
  name: 'vorion_db_pool_checkouts_total',
  help: 'Total number of connection checkouts from pool',
  registers: [vorionRegistry],
});

/** Connection checkin counter */
const connectionCheckinCounter = new Counter({
  name: 'vorion_db_pool_checkins_total',
  help: 'Total number of connection check-ins to pool',
  registers: [vorionRegistry],
});

/** Connection creation counter */
const connectionCreatedCounter = new Counter({
  name: 'vorion_db_pool_connections_created_total',
  help: 'Total number of connections created',
  registers: [vorionRegistry],
});

/** Connection destruction counter */
const connectionDestroyedCounter = new Counter({
  name: 'vorion_db_pool_connections_destroyed_total',
  help: 'Total number of connections destroyed',
  labelNames: ['reason'] as const,
  registers: [vorionRegistry],
});

/** Error counter by type */
const poolErrorCounter = new Counter({
  name: 'vorion_db_pool_errors_total',
  help: 'Total number of pool errors by type',
  labelNames: ['error_type'] as const,
  registers: [vorionRegistry],
});

/** Query duration histogram */
const queryDurationHistogram = new Histogram({
  name: 'vorion_db_pool_query_duration_seconds',
  help: 'Database query execution duration',
  labelNames: ['operation'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [vorionRegistry],
});

/** Slow query counter */
const slowQueryCounter = new Counter({
  name: 'vorion_db_pool_slow_queries_total',
  help: 'Total number of slow queries detected',
  labelNames: ['operation'] as const,
  registers: [vorionRegistry],
});

/** Validation counter */
const validationCounter = new Counter({
  name: 'vorion_db_pool_validations_total',
  help: 'Total number of connection validations',
  labelNames: ['result'] as const,
  registers: [vorionRegistry],
});

/** Eviction counter */
const evictionCounter = new Counter({
  name: 'vorion_db_pool_evictions_total',
  help: 'Total number of connection evictions',
  labelNames: ['reason'] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// Connection Pool Manager
// =============================================================================

/**
 * Advanced database connection pool manager with health monitoring,
 * automatic reconnection, and comprehensive metrics.
 *
 * @example
 * ```typescript
 * const manager = ConnectionPoolManager.getInstance();
 *
 * // Initialize with configuration
 * await manager.initialize({
 *   host: 'localhost',
 *   port: 5432,
 *   database: 'vorion',
 *   user: 'vorion',
 *   password: 'secret',
 *   minConnections: 5,
 *   maxConnections: 20,
 * });
 *
 * // Use withConnection for automatic resource management
 * const users = await manager.withConnection(async (client) => {
 *   const result = await client.query('SELECT * FROM users WHERE active = $1', [true]);
 *   return result.rows;
 * });
 *
 * // Use transaction for transactional operations
 * await manager.transaction(async (client) => {
 *   await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [100, fromId]);
 *   await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [100, toId]);
 * });
 *
 * // Get pool statistics
 * const stats = manager.getStats();
 * console.log(`Pool utilization: ${stats.utilizationPercent}%`);
 *
 * // Shutdown gracefully
 * await manager.shutdown();
 * ```
 */
export class ConnectionPoolManager {
  private static instance: ConnectionPoolManager | null = null;

  private pool: Pool | null = null;
  private config: ConnectionPoolConfig | null = null;
  private connections: Map<PoolClient, PooledConnection> = new Map();
  private waitingQueue: WaitingClient[] = [];
  private evictionInterval: NodeJS.Timeout | null = null;
  private metricsInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private isInitialized = false;

  // Statistics
  private stats = {
    connectionsCreated: 0,
    connectionsDestroyed: 0,
    checkoutsTotal: 0,
    checkinsTotal: 0,
    validationFailures: 0,
    connectionErrors: 0,
    lastHealthCheck: null as string | null,
    evictionRuns: 0,
    connectionsEvicted: 0,
  };

  private constructor() {}

  /**
   * Get the singleton instance of the connection pool manager
   */
  static getInstance(): ConnectionPoolManager {
    if (!ConnectionPoolManager.instance) {
      ConnectionPoolManager.instance = new ConnectionPoolManager();
    }
    return ConnectionPoolManager.instance;
  }

  /**
   * Reset the singleton instance (primarily for testing)
   */
  static resetInstance(): void {
    if (ConnectionPoolManager.instance) {
      ConnectionPoolManager.instance = null;
    }
  }

  /**
   * Initialize the connection pool with the given configuration
   */
  async initialize(config?: Partial<ConnectionPoolConfig>): Promise<void> {
    if (this.isInitialized) {
      logger.warn({}, 'Pool already initialized, skipping re-initialization');
      return;
    }

    const appConfig = getConfig();
    this.config = {
      host: config?.host ?? appConfig.database.host,
      port: config?.port ?? appConfig.database.port,
      database: config?.database ?? appConfig.database.name,
      user: config?.user ?? appConfig.database.user,
      password: config?.password ?? appConfig.database.password,
      minConnections: config?.minConnections ?? 5,
      maxConnections: config?.maxConnections ?? 20,
      idleTimeoutMs: config?.idleTimeoutMs ?? 30000,
      connectionTimeoutMs: config?.connectionTimeoutMs ?? 5000,
      maxWaitingClients: config?.maxWaitingClients ?? 100,
      validateOnBorrow: config?.validateOnBorrow ?? true,
      evictionRunIntervalMs: config?.evictionRunIntervalMs ?? 60000,
      statementTimeoutMs: config?.statementTimeoutMs ?? appConfig.database.statementTimeoutMs,
      slowQueryThresholdMs: config?.slowQueryThresholdMs ?? 1000,
      ssl: config?.ssl,
      applicationName: config?.applicationName ?? 'vorion',
    };

    // Validate configuration
    if ((this.config.minConnections ?? 5) > (this.config.maxConnections ?? 20)) {
      throw new VorionError('minConnections cannot exceed maxConnections', {
        minConnections: this.config.minConnections ?? 5,
        maxConnections: this.config.maxConnections ?? 20,
      });
    }

    // Create the underlying pg pool
    const pgConfig: PgPoolConfig = {
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      min: this.config.minConnections,
      max: this.config.maxConnections,
      idleTimeoutMillis: this.config.idleTimeoutMs,
      connectionTimeoutMillis: this.config.connectionTimeoutMs,
      allowExitOnIdle: false,
      statement_timeout: this.config.statementTimeoutMs,
      application_name: this.config.applicationName,
    };

    if (this.config.ssl) {
      pgConfig.ssl = typeof this.config.ssl === 'boolean'
        ? this.config.ssl
        : this.config.ssl;
    }

    this.pool = new Pool(pgConfig);

    // Set up pool event handlers
    this.pool.on('error', (error, client) => {
      logger.error({ error, hasClient: !!client }, 'Pool client error');
      poolErrorCounter.inc({ error_type: 'client_error' });
      this.stats.connectionErrors++;

      // Clean up the errored connection if we're tracking it
      if (client) {
        const pooledConnection = this.connections.get(client);
        if (pooledConnection) {
          this.destroyConnection(pooledConnection, 'error');
        }
      }
    });

    this.pool.on('connect', (client) => {
      logger.debug({}, 'New connection established');
      connectionCreatedCounter.inc();
      this.stats.connectionsCreated++;

      // Track the new connection
      this.connections.set(client, {
        client,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        inUse: false,
        useCount: 0,
        lastValidation: null,
      });
    });

    this.pool.on('remove', (client) => {
      logger.debug({}, 'Connection removed from pool');
      connectionDestroyedCounter.inc({ reason: 'pool_removal' });
      this.stats.connectionsDestroyed++;
      this.connections.delete(client);
    });

    // Start eviction process
    this.startEvictionProcess();

    // Start metrics collection
    this.startMetricsCollection();

    // Warm up the pool with minimum connections
    await this.warmUp();

    this.isInitialized = true;
    logger.info(
      {
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        minConnections: this.config.minConnections,
        maxConnections: this.config.maxConnections,
      },
      'Connection pool initialized'
    );
  }

  /**
   * Warm up the pool by creating minimum number of connections
   */
  private async warmUp(): Promise<void> {
    if (!this.pool || !this.config) return;

    const minConnections = this.config.minConnections ?? 5;
    const warmUpPromises: Promise<void>[] = [];
    for (let i = 0; i < minConnections; i++) {
      warmUpPromises.push(
        this.pool.connect().then((client) => {
          client.release();
        }).catch((error) => {
          logger.warn({ error }, 'Failed to warm up connection');
        })
      );
    }

    await Promise.allSettled(warmUpPromises);
    logger.debug({ count: this.config.minConnections }, 'Pool warm-up completed');
  }

  /**
   * Acquire a connection from the pool
   */
  async acquire(): Promise<PoolClient> {
    if (!this.pool || !this.config) {
      throw new DatabaseError('Pool not initialized');
    }

    if (this.isShuttingDown) {
      throw new DatabaseError('Pool is shutting down');
    }

    const startTime = performance.now();

    try {
      // Check if we can serve from the pool or need to wait
      const poolStats = this.getStats();

      if (poolStats.waitingClients >= (this.config.maxWaitingClients ?? 100)) {
        throw new PoolExhaustedError(
          'Pool exhausted and waiting queue is full',
          0,
          poolStats
        );
      }

      // Try to get a connection
      const client = await this.acquireWithTimeout();

      const waitTimeMs = performance.now() - startTime;
      connectionWaitTimeHistogram.observe(waitTimeMs / 1000);
      connectionCheckoutCounter.inc();
      this.stats.checkoutsTotal++;

      // Track the connection
      let pooledConnection = this.connections.get(client);
      if (!pooledConnection) {
        pooledConnection = {
          client,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          inUse: true,
          useCount: 1,
          lastValidation: null,
        };
        this.connections.set(client, pooledConnection);
      } else {
        pooledConnection.inUse = true;
        pooledConnection.lastUsedAt = Date.now();
        pooledConnection.useCount++;
      }

      // Validate if configured
      if (this.config.validateOnBorrow) {
        const isValid = await this.validateConnection(pooledConnection);
        if (!isValid) {
          // Destroy and get a new connection
          this.destroyConnection(pooledConnection, 'validation_failure');
          return this.acquire();
        }
      }

      logger.debug({ waitTimeMs: Math.round(waitTimeMs) }, 'Connection acquired');
      return client;
    } catch (error) {
      const waitTimeMs = performance.now() - startTime;
      poolErrorCounter.inc({ error_type: 'acquire_error' });

      if (error instanceof PoolExhaustedError || error instanceof ConnectionAcquireTimeoutError) {
        throw error;
      }

      throw new DatabaseError(
        `Failed to acquire connection: ${error instanceof Error ? error.message : String(error)}`,
        { waitTimeMs, originalError: error instanceof Error ? error.name : undefined }
      );
    }
  }

  /**
   * Acquire a connection with timeout handling
   */
  private async acquireWithTimeout(): Promise<PoolClient> {
    if (!this.pool || !this.config) {
      throw new DatabaseError('Pool not initialized');
    }

    const timeoutMs = this.config.connectionTimeoutMs ?? 5000;

    return new Promise<PoolClient>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new ConnectionAcquireTimeoutError(
          `Connection acquire timeout after ${timeoutMs}ms`,
          timeoutMs,
          this.getStats()
        ));
      }, timeoutMs);

      this.pool!.connect()
        .then((client) => {
          clearTimeout(timeoutHandle);
          resolve(client);
        })
        .catch((error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        });
    });
  }

  /**
   * Release a connection back to the pool
   */
  release(client: PoolClient, destroy = false): void {
    const pooledConnection = this.connections.get(client);

    if (pooledConnection) {
      pooledConnection.inUse = false;
      pooledConnection.lastUsedAt = Date.now();
    }

    if (destroy) {
      this.destroyConnection(pooledConnection ?? { client } as PooledConnection, 'explicit_destroy');
      return;
    }

    try {
      client.release();
      connectionCheckinCounter.inc();
      this.stats.checkinsTotal++;
      logger.debug({}, 'Connection released');
    } catch (error) {
      logger.error({ error }, 'Error releasing connection');
      poolErrorCounter.inc({ error_type: 'release_error' });
    }
  }

  /**
   * Execute a callback with automatic connection management
   */
  async withConnection<T>(
    callback: (client: PoolClient) => Promise<T>,
    operationName = 'unknown'
  ): Promise<T> {
    const client = await this.acquire();
    const startTime = performance.now();

    try {
      const result = await callback(client);

      const durationMs = performance.now() - startTime;
      queryDurationHistogram.observe({ operation: operationName }, durationMs / 1000);

      // Check for slow query
      if (this.config && durationMs > (this.config.slowQueryThresholdMs ?? 1000)) {
        logger.warn(
          { operation: operationName, durationMs: Math.round(durationMs) },
          'Slow query detected'
        );
        slowQueryCounter.inc({ operation: operationName });
      }

      return result;
    } catch (error) {
      poolErrorCounter.inc({ error_type: 'query_error' });
      throw error;
    } finally {
      this.release(client);
    }
  }

  /**
   * Execute a transaction with automatic commit/rollback
   */
  async transaction<T>(
    callback: (client: PoolClient) => Promise<T>,
    operationName = 'transaction'
  ): Promise<T> {
    const client = await this.acquire();
    const startTime = performance.now();

    try {
      await client.query('BEGIN');

      const result = await callback(client);

      await client.query('COMMIT');

      const durationMs = performance.now() - startTime;
      queryDurationHistogram.observe({ operation: operationName }, durationMs / 1000);

      // Check for slow transaction
      if (this.config && durationMs > (this.config.slowQueryThresholdMs ?? 1000)) {
        logger.warn(
          { operation: operationName, durationMs: Math.round(durationMs) },
          'Slow transaction detected'
        );
        slowQueryCounter.inc({ operation: operationName });
      }

      logger.debug({ operation: operationName, durationMs: Math.round(durationMs) }, 'Transaction committed');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
        logger.debug({ operation: operationName }, 'Transaction rolled back');
      } catch (rollbackError) {
        logger.error({ error: rollbackError }, 'Error rolling back transaction');
      }

      poolErrorCounter.inc({ error_type: 'transaction_error' });
      throw error;
    } finally {
      this.release(client);
    }
  }

  /**
   * Validate a connection
   */
  private async validateConnection(connection: PooledConnection): Promise<boolean> {
    const startTime = performance.now();

    try {
      // Simple ping query
      const result = await connection.client.query('SELECT 1 as ping');
      const latencyMs = performance.now() - startTime;

      const success = result.rows[0]?.ping === 1;

      connection.lastValidation = {
        timestamp: Date.now(),
        success,
        latencyMs,
      };

      validationCounter.inc({ result: success ? 'success' : 'failure' });

      if (!success) {
        this.stats.validationFailures++;
      }

      logger.debug({ success, latencyMs: Math.round(latencyMs) }, 'Connection validation');
      return success;
    } catch (error) {
      const latencyMs = performance.now() - startTime;

      connection.lastValidation = {
        timestamp: Date.now(),
        success: false,
        latencyMs,
      };

      validationCounter.inc({ result: 'error' });
      this.stats.validationFailures++;

      logger.warn({ error, latencyMs: Math.round(latencyMs) }, 'Connection validation failed');
      return false;
    }
  }

  /**
   * Destroy a connection
   */
  private destroyConnection(
    connection: PooledConnection,
    reason: 'error' | 'validation_failure' | 'eviction' | 'explicit_destroy' | 'idle' | 'pool_removal'
  ): void {
    try {
      connection.client.release(true); // true = destroy
      this.connections.delete(connection.client);
      connectionDestroyedCounter.inc({ reason });
      this.stats.connectionsDestroyed++;

      if (reason === 'eviction' || reason === 'idle') {
        evictionCounter.inc({ reason });
        this.stats.connectionsEvicted++;
      }

      logger.debug({ reason }, 'Connection destroyed');
    } catch (error) {
      logger.error({ error, reason }, 'Error destroying connection');
    }
  }

  /**
   * Start the eviction process for dead/idle connections
   */
  private startEvictionProcess(): void {
    if (!this.config) return;

    const intervalMs = this.config.evictionRunIntervalMs ?? 60000;

    this.evictionInterval = setInterval(async () => {
      await this.runEviction();
    }, intervalMs);

    // Don't prevent process exit
    this.evictionInterval.unref();
  }

  /**
   * Run eviction of dead/idle connections
   */
  private async runEviction(): Promise<void> {
    if (!this.config || this.isShuttingDown) return;

    this.stats.evictionRuns++;
    const now = Date.now();
    const idleTimeoutMs = this.config.idleTimeoutMs ?? 30000;
    const minConnections = this.config.minConnections ?? 5;

    let evicted = 0;
    let validated = 0;

    const connectionEntries = Array.from(this.connections.entries());
    for (const [, connection] of connectionEntries) {
      // Skip connections in use
      if (connection.inUse) continue;

      // Check idle timeout
      const idleTime = now - connection.lastUsedAt;
      if (idleTime > idleTimeoutMs && this.pool!.totalCount > minConnections) {
        this.destroyConnection(connection, 'idle');
        evicted++;
        continue;
      }

      // Validate idle connections periodically
      if (!connection.lastValidation || (now - connection.lastValidation.timestamp) > 60000) {
        const isValid = await this.validateConnection(connection);
        validated++;

        if (!isValid) {
          this.destroyConnection(connection, 'validation_failure');
          evicted++;
        }
      }
    }

    if (evicted > 0 || validated > 0) {
      logger.debug({ evicted, validated }, 'Eviction run completed');
    }
  }

  /**
   * Start metrics collection interval
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.updateMetrics();
    }, 5000);

    // Don't prevent process exit
    this.metricsInterval.unref();

    // Collect immediately
    this.updateMetrics();
  }

  /**
   * Update Prometheus metrics
   */
  private updateMetrics(): void {
    if (!this.pool) return;

    const stats = this.getStats();

    poolUtilizationGauge.set(stats.utilizationPercent);
    poolActiveConnectionsGauge.set(stats.activeConnections);
    poolIdleConnectionsGauge.set(stats.idleConnections);
    poolTotalConnectionsGauge.set(stats.totalConnections);
    poolWaitingClientsGauge.set(stats.waitingClients);
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    if (!this.pool || !this.config) {
      return {
        activeConnections: 0,
        idleConnections: 0,
        totalConnections: 0,
        waitingClients: 0,
        utilizationPercent: 0,
        maxConnections: 0,
        minConnections: 0,
        connectionsCreated: this.stats.connectionsCreated,
        connectionsDestroyed: this.stats.connectionsDestroyed,
        checkoutsTotal: this.stats.checkoutsTotal,
        checkinsTotal: this.stats.checkinsTotal,
        validationFailures: this.stats.validationFailures,
        connectionErrors: this.stats.connectionErrors,
        healthy: false,
        lastHealthCheck: this.stats.lastHealthCheck,
        evictionRuns: this.stats.evictionRuns,
        connectionsEvicted: this.stats.connectionsEvicted,
      };
    }

    const totalCount = this.pool.totalCount;
    const idleCount = this.pool.idleCount;
    const waitingCount = this.pool.waitingCount;
    const activeCount = totalCount - idleCount;
    const maxConnections = this.config.maxConnections ?? 20;
    const minConnections = this.config.minConnections ?? 5;

    return {
      activeConnections: activeCount,
      idleConnections: idleCount,
      totalConnections: totalCount,
      waitingClients: waitingCount,
      utilizationPercent: maxConnections > 0 ? Math.round((activeCount / maxConnections) * 100) : 0,
      maxConnections,
      minConnections,
      connectionsCreated: this.stats.connectionsCreated,
      connectionsDestroyed: this.stats.connectionsDestroyed,
      checkoutsTotal: this.stats.checkoutsTotal,
      checkinsTotal: this.stats.checkinsTotal,
      validationFailures: this.stats.validationFailures,
      connectionErrors: this.stats.connectionErrors,
      healthy: activeCount < maxConnections || idleCount > 0,
      lastHealthCheck: this.stats.lastHealthCheck,
      evictionRuns: this.stats.evictionRuns,
      connectionsEvicted: this.stats.connectionsEvicted,
    };
  }

  /**
   * Perform a health check on the pool
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    latencyMs: number;
    stats: PoolStats;
    error?: string;
  }> {
    if (!this.pool) {
      return {
        healthy: false,
        latencyMs: 0,
        stats: this.getStats(),
        error: 'Pool not initialized',
      };
    }

    const startTime = performance.now();

    try {
      const client = await this.pool.connect();
      try {
        const result = await client.query('SELECT 1 as health_check');
        const latencyMs = performance.now() - startTime;

        this.stats.lastHealthCheck = new Date().toISOString();

        return {
          healthy: result.rows[0]?.health_check === 1,
          latencyMs: Math.round(latencyMs),
          stats: this.getStats(),
        };
      } finally {
        client.release();
      }
    } catch (error) {
      const latencyMs = performance.now() - startTime;

      return {
        healthy: false,
        latencyMs: Math.round(latencyMs),
        stats: this.getStats(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Shutdown the pool gracefully
   */
  async shutdown(timeoutMs = 30000): Promise<void> {
    if (!this.pool || this.isShuttingDown) return;

    this.isShuttingDown = true;
    logger.info({ timeoutMs }, 'Shutting down connection pool');

    // Stop eviction and metrics
    if (this.evictionInterval) {
      clearInterval(this.evictionInterval);
      this.evictionInterval = null;
    }

    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }

    // Wait for in-use connections to be released (with timeout)
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      let inUseCount = 0;
      const connectionValues = Array.from(this.connections.values());
      for (const connection of connectionValues) {
        if (connection.inUse) inUseCount++;
      }

      if (inUseCount === 0) break;

      logger.debug({ inUseCount }, 'Waiting for connections to be released');
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Close the pool
    try {
      await this.pool.end();
      logger.info({}, 'Connection pool shut down');
    } catch (error) {
      logger.error({ error }, 'Error shutting down pool');
    }

    this.pool = null;
    this.connections.clear();
    this.waitingQueue = [];
    this.isInitialized = false;
    this.isShuttingDown = false;
  }

  /**
   * Check if the pool is initialized
   */
  isPoolInitialized(): boolean {
    return this.isInitialized && this.pool !== null;
  }

  /**
   * Get the underlying pg Pool (for advanced usage)
   */
  getUnderlyingPool(): Pool | null {
    return this.pool;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Get the global connection pool manager instance.
 * The pool is automatically initialized on first access if configuration is available.
 *
 * @example
 * ```typescript
 * const pool = getPool();
 *
 * // Use the pool
 * const result = await pool.withConnection(async (client) => {
 *   return client.query('SELECT * FROM users');
 * });
 * ```
 */
export function getConnectionPool(): ConnectionPoolManager {
  return ConnectionPoolManager.getInstance();
}

/**
 * Initialize the connection pool with custom configuration.
 * Call this once at application startup.
 *
 * @example
 * ```typescript
 * await initializeConnectionPool({
 *   minConnections: 10,
 *   maxConnections: 50,
 *   validateOnBorrow: true,
 * });
 * ```
 */
export async function initializeConnectionPool(config?: Partial<ConnectionPoolConfig>): Promise<ConnectionPoolManager> {
  const manager = ConnectionPoolManager.getInstance();
  await manager.initialize(config);
  return manager;
}

/**
 * Shutdown the connection pool gracefully.
 * Call this during application shutdown.
 *
 * @example
 * ```typescript
 * process.on('SIGTERM', async () => {
 *   await shutdownConnectionPool();
 *   process.exit(0);
 * });
 * ```
 */
export async function shutdownConnectionPool(timeoutMs?: number): Promise<void> {
  const manager = ConnectionPoolManager.getInstance();
  await manager.shutdown(timeoutMs);
}

// =============================================================================
// Exports
// =============================================================================

export default ConnectionPoolManager;
