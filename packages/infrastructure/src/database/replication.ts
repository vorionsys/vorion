/**
 * PostgreSQL High Availability Replication Module
 *
 * Provides infrastructure for PostgreSQL HA with:
 * - Streaming replication configuration
 * - Patroni cluster management helpers
 * - pg_auto_failover setup and monitoring
 * - Automatic failover configuration
 * - Replication lag monitoring
 * - Health check endpoints for replicas
 *
 * @packageDocumentation
 */

import { Pool, PoolClient, PoolConfig } from 'pg';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { EventEmitter } from 'events';

// =============================================================================
// Types
// =============================================================================

/**
 * Replication mode for PostgreSQL
 */
export type ReplicationMode = 'streaming' | 'logical' | 'synchronous';

/**
 * Cluster orchestration type
 */
export type ClusterOrchestrator = 'patroni' | 'pg_auto_failover' | 'manual';

/**
 * Replica node status
 */
export type ReplicaStatus =
  | 'streaming'
  | 'catchup'
  | 'potential'
  | 'disconnected'
  | 'failed'
  | 'unknown';

/**
 * Node role in the cluster
 */
export type NodeRole = 'primary' | 'replica' | 'witness' | 'unknown';

/**
 * Failover reason
 */
export type FailoverReason =
  | 'primary_failure'
  | 'manual_switchover'
  | 'scheduled_maintenance'
  | 'replication_lag_exceeded'
  | 'health_check_failure';

/**
 * Configuration for a PostgreSQL node
 */
export interface PostgresNodeConfig {
  /** Node identifier */
  nodeId: string;
  /** Host address */
  host: string;
  /** Port number */
  port: number;
  /** Database name */
  database: string;
  /** Username */
  user: string;
  /** Password */
  password: string;
  /** SSL configuration */
  ssl?: boolean | { rejectUnauthorized?: boolean; ca?: string; cert?: string; key?: string };
  /** Connection timeout in milliseconds */
  connectionTimeoutMs?: number;
  /** Idle timeout in milliseconds */
  idleTimeoutMs?: number;
  /** Maximum connections */
  maxConnections?: number;
  /** Application name */
  applicationName?: string;
}

/**
 * Replication cluster configuration
 */
export interface ReplicationClusterConfig {
  /** Cluster name */
  clusterName: string;
  /** Replication mode */
  replicationMode: ReplicationMode;
  /** Cluster orchestrator */
  orchestrator: ClusterOrchestrator;
  /** Primary node configuration */
  primary: PostgresNodeConfig;
  /** Replica node configurations */
  replicas: PostgresNodeConfig[];
  /** Maximum acceptable replication lag in bytes */
  maxReplicationLagBytes?: number;
  /** Maximum acceptable replication lag in seconds */
  maxReplicationLagSeconds?: number;
  /** Health check interval in milliseconds */
  healthCheckIntervalMs?: number;
  /** Failover timeout in milliseconds */
  failoverTimeoutMs?: number;
  /** Whether automatic failover is enabled */
  autoFailoverEnabled?: boolean;
  /** Minimum replicas required for synchronous commit */
  synchronousStandbyCount?: number;
  /** Patroni-specific configuration */
  patroni?: PatroniConfig;
  /** pg_auto_failover specific configuration */
  pgAutoFailover?: PgAutoFailoverConfig;
}

/**
 * Patroni cluster configuration
 */
export interface PatroniConfig {
  /** Patroni REST API endpoint */
  apiEndpoint: string;
  /** API username */
  apiUsername?: string;
  /** API password */
  apiPassword?: string;
  /** DCS (Distributed Configuration Store) type */
  dcsType: 'etcd' | 'consul' | 'zookeeper' | 'kubernetes';
  /** DCS connection string */
  dcsEndpoint: string;
  /** Namespace/scope */
  namespace: string;
  /** TTL for leader lock in seconds */
  ttlSeconds?: number;
  /** Loop wait time in seconds */
  loopWaitSeconds?: number;
  /** Retry timeout in seconds */
  retryTimeoutSeconds?: number;
  /** Maximum lag before failover (bytes) */
  maximumLagOnFailover?: number;
}

/**
 * pg_auto_failover configuration
 */
export interface PgAutoFailoverConfig {
  /** Monitor node connection string */
  monitorConnectionString: string;
  /** Formation name */
  formation: string;
  /** Group ID */
  groupId: number;
  /** Replication quorum */
  replicationQuorum?: boolean;
  /** Number sync standbys */
  numberSyncStandbys?: number;
}

/**
 * Replication statistics for a replica
 */
export interface ReplicationStats {
  /** Replica node ID */
  nodeId: string;
  /** Current status */
  status: ReplicaStatus;
  /** Replication lag in bytes */
  lagBytes: number;
  /** Replication lag in seconds */
  lagSeconds: number;
  /** Last received LSN (Log Sequence Number) */
  receivedLsn: string;
  /** Last replayed LSN */
  replayedLsn: string;
  /** Replay lag in bytes */
  replayLagBytes: number;
  /** Write lag in bytes */
  writeLagBytes: number;
  /** Flush lag in bytes */
  flushLagBytes: number;
  /** Whether replica is in sync */
  isInSync: boolean;
  /** Timestamp of last stats collection */
  collectedAt: Date;
}

/**
 * Cluster health status
 */
export interface ClusterHealth {
  /** Overall cluster health */
  healthy: boolean;
  /** Primary node health */
  primaryHealthy: boolean;
  /** Number of healthy replicas */
  healthyReplicaCount: number;
  /** Total replica count */
  totalReplicaCount: number;
  /** Current primary node ID */
  currentPrimary: string;
  /** Replication statistics per replica */
  replicationStats: ReplicationStats[];
  /** Average replication lag in bytes */
  averageLagBytes: number;
  /** Maximum replication lag in bytes */
  maxLagBytes: number;
  /** Any replicas exceeding lag threshold */
  lagThresholdExceeded: boolean;
  /** Last health check timestamp */
  lastCheckAt: Date;
  /** Health check duration in milliseconds */
  checkDurationMs: number;
}

/**
 * Failover event
 */
export interface FailoverEvent {
  /** Event ID */
  eventId: string;
  /** Previous primary node ID */
  previousPrimary: string;
  /** New primary node ID */
  newPrimary: string;
  /** Reason for failover */
  reason: FailoverReason;
  /** Failover initiated at */
  initiatedAt: Date;
  /** Failover completed at */
  completedAt?: Date;
  /** Whether failover was successful */
  success: boolean;
  /** Error message if failed */
  errorMessage?: string;
  /** Replication lag at failover time */
  lagAtFailover?: number;
}

/**
 * Health check result for a single node
 */
export interface NodeHealthCheck {
  /** Node ID */
  nodeId: string;
  /** Node role */
  role: NodeRole;
  /** Whether node is reachable */
  reachable: boolean;
  /** Response latency in milliseconds */
  latencyMs: number;
  /** PostgreSQL version */
  pgVersion?: string;
  /** Whether node is in recovery */
  isInRecovery: boolean;
  /** Transaction ID (XID) */
  currentXid?: string;
  /** Timeline ID */
  timelineId?: number;
  /** Error message if unhealthy */
  errorMessage?: string;
  /** Timestamp of check */
  checkedAt: Date;
}

// =============================================================================
// Metrics Registry
// =============================================================================

/**
 * Dedicated registry for replication metrics
 */
export const replicationRegistry = new Registry();

// Replication lag metrics
export const replicationLagBytesGauge = new Gauge({
  name: 'vorion_pg_replication_lag_bytes',
  help: 'PostgreSQL replication lag in bytes',
  labelNames: ['cluster', 'replica_id', 'replica_host'] as const,
  registers: [replicationRegistry],
});

export const replicationLagSecondsGauge = new Gauge({
  name: 'vorion_pg_replication_lag_seconds',
  help: 'PostgreSQL replication lag in seconds',
  labelNames: ['cluster', 'replica_id', 'replica_host'] as const,
  registers: [replicationRegistry],
});

// Replica status metrics
export const replicaStatusGauge = new Gauge({
  name: 'vorion_pg_replica_status',
  help: 'PostgreSQL replica status (1=streaming, 0.75=catchup, 0.5=potential, 0.25=disconnected, 0=failed)',
  labelNames: ['cluster', 'replica_id', 'replica_host', 'status'] as const,
  registers: [replicationRegistry],
});

// Cluster health metrics
export const clusterHealthGauge = new Gauge({
  name: 'vorion_pg_cluster_health',
  help: 'PostgreSQL cluster health (1=healthy, 0=unhealthy)',
  labelNames: ['cluster'] as const,
  registers: [replicationRegistry],
});

export const healthyReplicaCountGauge = new Gauge({
  name: 'vorion_pg_healthy_replica_count',
  help: 'Number of healthy PostgreSQL replicas',
  labelNames: ['cluster'] as const,
  registers: [replicationRegistry],
});

// Failover metrics
export const failoverEventsCounter = new Counter({
  name: 'vorion_pg_failover_events_total',
  help: 'Total PostgreSQL failover events',
  labelNames: ['cluster', 'reason', 'success'] as const,
  registers: [replicationRegistry],
});

export const failoverDurationHistogram = new Histogram({
  name: 'vorion_pg_failover_duration_seconds',
  help: 'PostgreSQL failover duration in seconds',
  labelNames: ['cluster', 'reason'] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300],
  registers: [replicationRegistry],
});

// Health check metrics
export const healthCheckDurationHistogram = new Histogram({
  name: 'vorion_pg_health_check_duration_seconds',
  help: 'PostgreSQL health check duration',
  labelNames: ['cluster', 'node_id', 'role'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [replicationRegistry],
});

export const healthCheckErrorsCounter = new Counter({
  name: 'vorion_pg_health_check_errors_total',
  help: 'Total PostgreSQL health check errors',
  labelNames: ['cluster', 'node_id', 'error_type'] as const,
  registers: [replicationRegistry],
});

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create a connection pool for a node
 */
function createNodePool(config: PostgresNodeConfig): Pool {
  const poolConfig: PoolConfig = {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: config.maxConnections ?? 5,
    idleTimeoutMillis: config.idleTimeoutMs ?? 30000,
    connectionTimeoutMillis: config.connectionTimeoutMs ?? 10000,
    application_name: config.applicationName ?? 'vorion-replication-monitor',
  };

  if (config.ssl) {
    poolConfig.ssl = typeof config.ssl === 'boolean' ? config.ssl : config.ssl;
  }

  return new Pool(poolConfig);
}

/**
 * Parse LSN (Log Sequence Number) to bytes offset
 */
function parseLsn(lsn: string): bigint {
  if (!lsn) return BigInt(0);
  const [segment, offset] = lsn.split('/');
  const segmentBigInt = BigInt('0x' + segment);
  const offsetBigInt = BigInt('0x' + offset);
  return (segmentBigInt << BigInt(32)) + offsetBigInt;
}

/**
 * Calculate lag between two LSNs in bytes
 */
function calculateLagBytes(primaryLsn: string, replicaLsn: string): number {
  const primaryOffset = parseLsn(primaryLsn);
  const replicaOffset = parseLsn(replicaLsn);
  const lag = primaryOffset - replicaOffset;
  return Number(lag > BigInt(0) ? lag : BigInt(0));
}

/**
 * Map replica state to ReplicaStatus
 */
function mapReplicaState(state: string | null): ReplicaStatus {
  if (!state) return 'unknown';
  switch (state.toLowerCase()) {
    case 'streaming':
      return 'streaming';
    case 'catchup':
      return 'catchup';
    case 'potential':
      return 'potential';
    case 'disconnected':
      return 'disconnected';
    default:
      return 'unknown';
  }
}

/**
 * Map replica status to numeric value for metrics
 */
function replicaStatusToNumber(status: ReplicaStatus): number {
  switch (status) {
    case 'streaming':
      return 1;
    case 'catchup':
      return 0.75;
    case 'potential':
      return 0.5;
    case 'disconnected':
      return 0.25;
    case 'failed':
      return 0;
    default:
      return 0;
  }
}

// =============================================================================
// PostgreSQL Replication Manager
// =============================================================================

/**
 * PostgreSQL Replication Manager
 *
 * Manages PostgreSQL HA clusters with streaming replication,
 * health monitoring, and failover coordination.
 *
 * @example
 * ```typescript
 * const manager = new ReplicationManager({
 *   clusterName: 'vorion-production',
 *   replicationMode: 'streaming',
 *   orchestrator: 'patroni',
 *   primary: { nodeId: 'primary', host: 'pg-primary', port: 5432, ... },
 *   replicas: [
 *     { nodeId: 'replica-1', host: 'pg-replica-1', port: 5432, ... },
 *     { nodeId: 'replica-2', host: 'pg-replica-2', port: 5432, ... },
 *   ],
 *   maxReplicationLagSeconds: 30,
 *   healthCheckIntervalMs: 10000,
 * });
 *
 * await manager.start();
 *
 * // Get cluster health
 * const health = await manager.getClusterHealth();
 *
 * // Get replication lag for a specific replica
 * const stats = await manager.getReplicationStats('replica-1');
 *
 * // Manual switchover
 * await manager.switchover('replica-1', 'scheduled_maintenance');
 * ```
 */
export class ReplicationManager extends EventEmitter {
  private config: ReplicationClusterConfig;
  private primaryPool: Pool | null = null;
  private replicaPools: Map<string, Pool> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private currentPrimaryId: string;
  private lastHealth: ClusterHealth | null = null;

  constructor(config: ReplicationClusterConfig) {
    super();
    this.config = {
      maxReplicationLagBytes: 100 * 1024 * 1024, // 100MB default
      maxReplicationLagSeconds: 30,
      healthCheckIntervalMs: 10000,
      failoverTimeoutMs: 60000,
      autoFailoverEnabled: true,
      synchronousStandbyCount: 1,
      ...config,
    };
    this.currentPrimaryId = config.primary.nodeId;
  }

  /**
   * Start the replication manager
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    // Initialize primary pool
    this.primaryPool = createNodePool(this.config.primary);

    // Initialize replica pools
    for (const replica of this.config.replicas) {
      const pool = createNodePool(replica);
      this.replicaPools.set(replica.nodeId, pool);
    }

    // Start health check loop
    this.startHealthChecks();

    this.isRunning = true;
    this.emit('started', { clusterName: this.config.clusterName });
  }

  /**
   * Stop the replication manager
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // Stop health checks
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Close all pools
    if (this.primaryPool) {
      await this.primaryPool.end();
      this.primaryPool = null;
    }

    for (const [, pool] of this.replicaPools) {
      await pool.end();
    }
    this.replicaPools.clear();

    this.isRunning = false;
    this.emit('stopped', { clusterName: this.config.clusterName });
  }

  /**
   * Start health check interval
   */
  private startHealthChecks(): void {
    const runHealthCheck = async () => {
      try {
        const health = await this.getClusterHealth();
        this.lastHealth = health;

        // Update metrics
        this.updateMetrics(health);

        // Check for issues
        if (!health.healthy) {
          this.emit('unhealthy', health);
        }

        if (health.lagThresholdExceeded) {
          this.emit('lag_threshold_exceeded', health);
        }

        // Auto-failover check
        if (this.config.autoFailoverEnabled && !health.primaryHealthy) {
          this.emit('primary_failure', {
            currentPrimary: this.currentPrimaryId,
            health,
          });
          // Note: Actual failover should be handled by Patroni/pg_auto_failover
          // This just emits events for monitoring
        }
      } catch (error) {
        this.emit('health_check_error', { error });
        healthCheckErrorsCounter.inc({
          cluster: this.config.clusterName,
          node_id: 'cluster',
          error_type: error instanceof Error ? error.name : 'unknown',
        });
      }
    };

    // Run immediately
    runHealthCheck();

    // Schedule interval
    this.healthCheckInterval = setInterval(
      runHealthCheck,
      this.config.healthCheckIntervalMs
    );
  }

  /**
   * Update Prometheus metrics from health data
   */
  private updateMetrics(health: ClusterHealth): void {
    const cluster = this.config.clusterName;

    // Cluster health
    clusterHealthGauge.set({ cluster }, health.healthy ? 1 : 0);
    healthyReplicaCountGauge.set({ cluster }, health.healthyReplicaCount);

    // Per-replica metrics
    for (const stats of health.replicationStats) {
      const replica = this.config.replicas.find((r) => r.nodeId === stats.nodeId);
      const host = replica?.host ?? 'unknown';

      replicationLagBytesGauge.set(
        { cluster, replica_id: stats.nodeId, replica_host: host },
        stats.lagBytes
      );

      replicationLagSecondsGauge.set(
        { cluster, replica_id: stats.nodeId, replica_host: host },
        stats.lagSeconds
      );

      replicaStatusGauge.set(
        { cluster, replica_id: stats.nodeId, replica_host: host, status: stats.status },
        replicaStatusToNumber(stats.status)
      );
    }
  }

  /**
   * Get comprehensive cluster health status
   */
  async getClusterHealth(): Promise<ClusterHealth> {
    const startTime = performance.now();

    // Check primary health
    const primaryHealth = await this.checkNodeHealth(
      this.config.primary,
      'primary'
    );

    // Get replication stats from primary
    const replicationStats = await this.getAllReplicationStats();

    // Calculate health metrics
    const healthyReplicaCount = replicationStats.filter(
      (s) => s.status === 'streaming' && s.isInSync
    ).length;

    const lagValues = replicationStats.map((s) => s.lagBytes);
    const averageLagBytes =
      lagValues.length > 0
        ? lagValues.reduce((a, b) => a + b, 0) / lagValues.length
        : 0;
    const maxLagBytes = lagValues.length > 0 ? Math.max(...lagValues) : 0;

    const lagThresholdExceeded =
      maxLagBytes > (this.config.maxReplicationLagBytes ?? Infinity) ||
      replicationStats.some(
        (s) => s.lagSeconds > (this.config.maxReplicationLagSeconds ?? Infinity)
      );

    const checkDurationMs = performance.now() - startTime;

    const health: ClusterHealth = {
      healthy:
        primaryHealth.reachable &&
        healthyReplicaCount >= (this.config.synchronousStandbyCount ?? 1),
      primaryHealthy: primaryHealth.reachable && !primaryHealth.isInRecovery,
      healthyReplicaCount,
      totalReplicaCount: this.config.replicas.length,
      currentPrimary: this.currentPrimaryId,
      replicationStats,
      averageLagBytes: Math.round(averageLagBytes),
      maxLagBytes,
      lagThresholdExceeded,
      lastCheckAt: new Date(),
      checkDurationMs: Math.round(checkDurationMs),
    };

    healthCheckDurationHistogram.observe(
      { cluster: this.config.clusterName, node_id: 'cluster', role: 'cluster' },
      checkDurationMs / 1000
    );

    return health;
  }

  /**
   * Get replication statistics for all replicas
   */
  async getAllReplicationStats(): Promise<ReplicationStats[]> {
    if (!this.primaryPool) {
      throw new Error('Primary pool not initialized');
    }

    let client: PoolClient | null = null;

    try {
      client = await this.primaryPool.connect();

      // Query pg_stat_replication for all replicas
      const result = await client.query(`
        SELECT
          pid,
          usename,
          application_name,
          client_addr,
          client_hostname,
          client_port,
          backend_start,
          state,
          sent_lsn,
          write_lsn,
          flush_lsn,
          replay_lsn,
          write_lag,
          flush_lag,
          replay_lag,
          sync_priority,
          sync_state,
          reply_time
        FROM pg_stat_replication
        WHERE state IS NOT NULL
      `);

      // Get current primary LSN
      const lsnResult = await client.query('SELECT pg_current_wal_lsn() as current_lsn');
      const currentLsn = lsnResult.rows[0]?.current_lsn ?? '0/0';

      const stats: ReplicationStats[] = [];

      for (const row of result.rows) {
        // Find matching replica config
        const replica = this.config.replicas.find(
          (r) =>
            r.host === row.client_addr ||
            r.host === row.client_hostname ||
            row.application_name?.includes(r.nodeId)
        );

        const nodeId = replica?.nodeId ?? row.application_name ?? row.client_addr;

        const lagBytes = calculateLagBytes(currentLsn, row.replay_lsn ?? '0/0');
        const writeLagBytes = calculateLagBytes(currentLsn, row.write_lsn ?? '0/0');
        const flushLagBytes = calculateLagBytes(currentLsn, row.flush_lsn ?? '0/0');
        const replayLagBytes = calculateLagBytes(row.flush_lsn ?? '0/0', row.replay_lsn ?? '0/0');

        // Parse lag interval to seconds
        const lagSeconds = this.parseIntervalToSeconds(row.replay_lag);

        stats.push({
          nodeId,
          status: mapReplicaState(row.state),
          lagBytes,
          lagSeconds,
          receivedLsn: row.sent_lsn ?? '0/0',
          replayedLsn: row.replay_lsn ?? '0/0',
          replayLagBytes,
          writeLagBytes,
          flushLagBytes,
          isInSync: row.sync_state === 'sync' || row.sync_state === 'quorum',
          collectedAt: new Date(),
        });
      }

      // Add stats for replicas not in pg_stat_replication (disconnected)
      for (const replica of this.config.replicas) {
        if (!stats.find((s) => s.nodeId === replica.nodeId)) {
          stats.push({
            nodeId: replica.nodeId,
            status: 'disconnected',
            lagBytes: -1,
            lagSeconds: -1,
            receivedLsn: '0/0',
            replayedLsn: '0/0',
            replayLagBytes: -1,
            writeLagBytes: -1,
            flushLagBytes: -1,
            isInSync: false,
            collectedAt: new Date(),
          });
        }
      }

      return stats;
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  /**
   * Get replication statistics for a specific replica
   */
  async getReplicationStats(nodeId: string): Promise<ReplicationStats | null> {
    const allStats = await this.getAllReplicationStats();
    return allStats.find((s) => s.nodeId === nodeId) ?? null;
  }

  /**
   * Check health of a specific node
   */
  async checkNodeHealth(
    nodeConfig: PostgresNodeConfig,
    role: NodeRole
  ): Promise<NodeHealthCheck> {
    const startTime = performance.now();
    const pool =
      role === 'primary'
        ? this.primaryPool
        : this.replicaPools.get(nodeConfig.nodeId);

    if (!pool) {
      return {
        nodeId: nodeConfig.nodeId,
        role,
        reachable: false,
        latencyMs: 0,
        isInRecovery: false,
        errorMessage: 'Pool not initialized',
        checkedAt: new Date(),
      };
    }

    let client: PoolClient | null = null;

    try {
      client = await pool.connect();

      // Run health check query
      const result = await client.query(`
        SELECT
          version() as pg_version,
          pg_is_in_recovery() as is_in_recovery,
          txid_current() as current_xid,
          (SELECT timeline_id FROM pg_control_checkpoint()) as timeline_id
      `);

      const row = result.rows[0];
      const latencyMs = performance.now() - startTime;

      healthCheckDurationHistogram.observe(
        { cluster: this.config.clusterName, node_id: nodeConfig.nodeId, role },
        latencyMs / 1000
      );

      return {
        nodeId: nodeConfig.nodeId,
        role,
        reachable: true,
        latencyMs: Math.round(latencyMs),
        pgVersion: row.pg_version,
        isInRecovery: row.is_in_recovery,
        currentXid: row.current_xid?.toString(),
        timelineId: row.timeline_id,
        checkedAt: new Date(),
      };
    } catch (error) {
      const latencyMs = performance.now() - startTime;

      healthCheckErrorsCounter.inc({
        cluster: this.config.clusterName,
        node_id: nodeConfig.nodeId,
        error_type: error instanceof Error ? error.name : 'unknown',
      });

      return {
        nodeId: nodeConfig.nodeId,
        role,
        reachable: false,
        latencyMs: Math.round(latencyMs),
        isInRecovery: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        checkedAt: new Date(),
      };
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  /**
   * Parse PostgreSQL interval to seconds
   */
  private parseIntervalToSeconds(interval: string | null): number {
    if (!interval) return 0;

    // PostgreSQL interval format: "HH:MM:SS.microseconds"
    const match = interval.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
    if (!match) return 0;

    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseFloat(match[3]);

    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Initiate manual switchover to a specified replica
   * Note: For Patroni/pg_auto_failover, this coordinates with the orchestrator
   */
  async switchover(
    targetReplicaId: string,
    reason: FailoverReason = 'manual_switchover'
  ): Promise<FailoverEvent> {
    const eventId = `failover-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const initiatedAt = new Date();

    const event: FailoverEvent = {
      eventId,
      previousPrimary: this.currentPrimaryId,
      newPrimary: targetReplicaId,
      reason,
      initiatedAt,
      success: false,
    };

    this.emit('switchover_started', event);

    try {
      // Get current lag before switchover
      const stats = await this.getReplicationStats(targetReplicaId);
      event.lagAtFailover = stats?.lagBytes ?? 0;

      // Perform switchover based on orchestrator
      if (this.config.orchestrator === 'patroni' && this.config.patroni) {
        await this.performPatroniSwitchover(targetReplicaId);
      } else if (
        this.config.orchestrator === 'pg_auto_failover' &&
        this.config.pgAutoFailover
      ) {
        await this.performPgAutoFailoverSwitchover(targetReplicaId);
      } else {
        throw new Error(
          `Manual switchover not supported for orchestrator: ${this.config.orchestrator}`
        );
      }

      event.success = true;
      event.completedAt = new Date();

      // Update tracking
      this.currentPrimaryId = targetReplicaId;

      // Record metrics
      const durationSeconds =
        (event.completedAt.getTime() - initiatedAt.getTime()) / 1000;
      failoverEventsCounter.inc({
        cluster: this.config.clusterName,
        reason,
        success: 'true',
      });
      failoverDurationHistogram.observe(
        { cluster: this.config.clusterName, reason },
        durationSeconds
      );

      this.emit('switchover_completed', event);
    } catch (error) {
      event.success = false;
      event.errorMessage = error instanceof Error ? error.message : String(error);
      event.completedAt = new Date();

      failoverEventsCounter.inc({
        cluster: this.config.clusterName,
        reason,
        success: 'false',
      });

      this.emit('switchover_failed', event);
    }

    return event;
  }

  /**
   * Perform switchover via Patroni REST API
   */
  private async performPatroniSwitchover(targetReplicaId: string): Promise<void> {
    const patroni = this.config.patroni;
    if (!patroni) {
      throw new Error('Patroni configuration not provided');
    }

    const url = `${patroni.apiEndpoint}/switchover`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (patroni.apiUsername && patroni.apiPassword) {
      const auth = Buffer.from(
        `${patroni.apiUsername}:${patroni.apiPassword}`
      ).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        leader: this.currentPrimaryId,
        candidate: targetReplicaId,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Patroni switchover failed: ${response.status} ${text}`);
    }
  }

  /**
   * Perform switchover via pg_auto_failover
   */
  private async performPgAutoFailoverSwitchover(
    _targetReplicaId: string
  ): Promise<void> {
    const pgaf = this.config.pgAutoFailover;
    if (!pgaf) {
      throw new Error('pg_auto_failover configuration not provided');
    }

    // Connect to monitor node
    const monitorPool = new Pool({
      connectionString: pgaf.monitorConnectionString,
      max: 1,
    });

    try {
      const client = await monitorPool.connect();
      try {
        await client.query(
          'SELECT pgautofailover.perform_failover($1, $2)',
          [pgaf.formation, pgaf.groupId]
        );
      } finally {
        client.release();
      }
    } finally {
      await monitorPool.end();
    }
  }

  /**
   * Get the current cluster configuration
   */
  getConfig(): ReplicationClusterConfig {
    return { ...this.config };
  }

  /**
   * Get the current primary node ID
   */
  getCurrentPrimary(): string {
    return this.currentPrimaryId;
  }

  /**
   * Get the last cached health status
   */
  getLastHealth(): ClusterHealth | null {
    return this.lastHealth;
  }

  /**
   * Check if the manager is running
   */
  isManagerRunning(): boolean {
    return this.isRunning;
  }
}

// =============================================================================
// Streaming Replication Configuration Generator
// =============================================================================

/**
 * Generate PostgreSQL configuration for streaming replication
 */
export interface StreamingReplicationConfig {
  /** Primary node configuration */
  primary: {
    /** postgresql.conf settings */
    postgresqlConf: Record<string, string | number | boolean>;
    /** pg_hba.conf entries */
    pgHbaEntries: string[];
  };
  /** Replica node configuration */
  replica: {
    /** postgresql.conf settings */
    postgresqlConf: Record<string, string | number | boolean>;
    /** recovery.conf / standby.signal settings */
    recoveryConf: Record<string, string>;
  };
}

/**
 * Generate streaming replication configuration
 */
export function generateStreamingReplicationConfig(options: {
  /** Replication user name */
  replicationUser: string;
  /** Primary host address */
  primaryHost: string;
  /** Primary port */
  primaryPort: number;
  /** Replica hosts (for pg_hba.conf) */
  replicaHosts: string[];
  /** Synchronous replication mode */
  synchronousMode?: 'off' | 'on' | 'remote_write' | 'remote_apply';
  /** Synchronous standby names */
  synchronousStandbyNames?: string[];
  /** Max WAL senders */
  maxWalSenders?: number;
  /** Max replication slots */
  maxReplicationSlots?: number;
  /** WAL keep size in MB */
  walKeepSize?: number;
  /** Hot standby enabled */
  hotStandby?: boolean;
  /** Archive mode */
  archiveMode?: boolean;
  /** Archive command */
  archiveCommand?: string;
}): StreamingReplicationConfig {
  const {
    replicationUser,
    primaryHost,
    primaryPort,
    replicaHosts,
    synchronousMode = 'on',
    synchronousStandbyNames = [],
    maxWalSenders = 10,
    maxReplicationSlots = 10,
    walKeepSize = 1024,
    hotStandby = true,
    archiveMode = true,
    archiveCommand = '/bin/true',
  } = options;

  // Primary configuration
  const primaryPostgresqlConf: Record<string, string | number | boolean> = {
    wal_level: 'replica',
    max_wal_senders: maxWalSenders,
    max_replication_slots: maxReplicationSlots,
    wal_keep_size: `${walKeepSize}MB`,
    hot_standby: hotStandby,
    archive_mode: archiveMode,
    archive_command: archiveCommand,
  };

  if (synchronousMode !== 'off' && synchronousStandbyNames.length > 0) {
    primaryPostgresqlConf.synchronous_commit = synchronousMode;
    primaryPostgresqlConf.synchronous_standby_names =
      synchronousStandbyNames.length > 1
        ? `FIRST ${synchronousStandbyNames.length} (${synchronousStandbyNames.join(', ')})`
        : synchronousStandbyNames[0];
  }

  // Generate pg_hba.conf entries for replication
  const pgHbaEntries: string[] = [
    '# Replication connections',
    `host    replication     ${replicationUser}     127.0.0.1/32            scram-sha-256`,
    `host    replication     ${replicationUser}     ::1/128                 scram-sha-256`,
  ];

  for (const host of replicaHosts) {
    // Handle both IP addresses and CIDR notation
    const hostEntry = host.includes('/') ? host : `${host}/32`;
    pgHbaEntries.push(
      `host    replication     ${replicationUser}     ${hostEntry}            scram-sha-256`
    );
  }

  // Replica configuration
  const replicaPostgresqlConf: Record<string, string | number | boolean> = {
    hot_standby: hotStandby,
    hot_standby_feedback: true,
    max_standby_streaming_delay: '30s',
    max_standby_archive_delay: '30s',
    wal_receiver_status_interval: '10s',
    wal_receiver_timeout: '60s',
  };

  const recoveryConf: Record<string, string> = {
    primary_conninfo: `host=${primaryHost} port=${primaryPort} user=${replicationUser}`,
    primary_slot_name: 'replica_slot',
    recovery_target_timeline: 'latest',
    restore_command: archiveMode ? 'cp /archive/%f %p' : '',
  };

  return {
    primary: {
      postgresqlConf: primaryPostgresqlConf,
      pgHbaEntries,
    },
    replica: {
      postgresqlConf: replicaPostgresqlConf,
      recoveryConf,
    },
  };
}

// =============================================================================
// Patroni Configuration Generator
// =============================================================================

/**
 * Generate Patroni cluster configuration
 */
export function generatePatroniConfig(options: {
  /** Cluster name */
  clusterName: string;
  /** Node name */
  nodeName: string;
  /** PostgreSQL data directory */
  dataDir: string;
  /** PostgreSQL bin directory */
  binDir?: string;
  /** PostgreSQL port */
  pgPort: number;
  /** Patroni REST API port */
  restApiPort: number;
  /** DCS type */
  dcsType: 'etcd' | 'consul' | 'zookeeper' | 'kubernetes';
  /** DCS hosts */
  dcsHosts: string[];
  /** Superuser credentials */
  superuser: { username: string; password: string };
  /** Replication credentials */
  replication: { username: string; password: string };
  /** Bootstrap parameters */
  bootstrap?: {
    dcs?: Record<string, unknown>;
    initdb?: string[];
    pgHba?: string[];
  };
}): Record<string, unknown> {
  const {
    clusterName,
    nodeName,
    dataDir,
    binDir,
    pgPort,
    restApiPort,
    dcsType,
    dcsHosts,
    superuser,
    replication,
    bootstrap,
  } = options;

  const config: Record<string, unknown> = {
    scope: clusterName,
    name: nodeName,
    restapi: {
      listen: `0.0.0.0:${restApiPort}`,
      connect_address: `${nodeName}:${restApiPort}`,
    },
    postgresql: {
      listen: `0.0.0.0:${pgPort}`,
      connect_address: `${nodeName}:${pgPort}`,
      data_dir: dataDir,
      ...(binDir && { bin_dir: binDir }),
      authentication: {
        superuser: superuser,
        replication: replication,
      },
      parameters: {
        wal_level: 'replica',
        hot_standby: 'on',
        max_connections: 200,
        max_wal_senders: 10,
        max_replication_slots: 10,
        wal_keep_size: '1GB',
        hot_standby_feedback: 'on',
      },
    },
    bootstrap: {
      dcs: {
        ttl: 30,
        loop_wait: 10,
        retry_timeout: 10,
        maximum_lag_on_failover: 1048576, // 1MB
        postgresql: {
          use_pg_rewind: true,
          use_slots: true,
          parameters: {
            wal_level: 'replica',
            hot_standby: 'on',
            max_connections: 200,
            max_wal_senders: 10,
            max_replication_slots: 10,
          },
        },
        ...bootstrap?.dcs,
      },
      initdb: bootstrap?.initdb ?? [
        'encoding: UTF8',
        'data-checksums',
      ],
      pg_hba: bootstrap?.pgHba ?? [
        'host replication replicator 0.0.0.0/0 md5',
        'host all all 0.0.0.0/0 md5',
      ],
    },
  };

  // Add DCS configuration
  switch (dcsType) {
    case 'etcd':
      config.etcd = {
        hosts: dcsHosts,
      };
      break;
    case 'consul':
      config.consul = {
        host: dcsHosts[0],
      };
      break;
    case 'zookeeper':
      config.zookeeper = {
        hosts: dcsHosts,
      };
      break;
    case 'kubernetes':
      config.kubernetes = {
        use_endpoints: true,
      };
      break;
  }

  return config;
}

// =============================================================================
// pg_auto_failover Configuration Generator
// =============================================================================

/**
 * Generate pg_auto_failover setup commands
 */
export function generatePgAutoFailoverCommands(options: {
  /** Formation name */
  formation: string;
  /** Node role */
  role: 'monitor' | 'primary' | 'secondary';
  /** PostgreSQL data directory */
  dataDir: string;
  /** PostgreSQL port */
  pgPort: number;
  /** Monitor connection string (for primary/secondary) */
  monitorConnectionString?: string;
  /** Node name */
  nodeName: string;
  /** Hostname/IP for connections */
  hostname: string;
  /** Group ID */
  groupId?: number;
  /** SSL mode */
  sslMode?: 'disable' | 'require' | 'verify-ca' | 'verify-full';
}): string[] {
  const {
    formation,
    role,
    dataDir,
    pgPort,
    monitorConnectionString,
    nodeName,
    hostname,
    groupId = 0,
    sslMode = 'require',
  } = options;

  const commands: string[] = [];

  if (role === 'monitor') {
    commands.push(
      `pg_autoctl create monitor \\`,
      `  --pgdata "${dataDir}" \\`,
      `  --pgport ${pgPort} \\`,
      `  --hostname "${hostname}" \\`,
      `  --ssl-mode ${sslMode} \\`,
      `  --auth trust`,
      '',
      '# Start the monitor',
      `pg_autoctl run --pgdata "${dataDir}"`
    );
  } else {
    if (!monitorConnectionString) {
      throw new Error('Monitor connection string required for primary/secondary');
    }

    commands.push(
      `pg_autoctl create postgres \\`,
      `  --pgdata "${dataDir}" \\`,
      `  --pgport ${pgPort} \\`,
      `  --pghost "${hostname}" \\`,
      `  --name "${nodeName}" \\`,
      `  --formation "${formation}" \\`,
      `  --group ${groupId} \\`,
      `  --monitor "${monitorConnectionString}" \\`,
      `  --ssl-mode ${sslMode} \\`,
      `  --auth trust`,
      '',
      '# Start the node',
      `pg_autoctl run --pgdata "${dataDir}"`
    );
  }

  return commands;
}

// =============================================================================
// Health Check Endpoint Handler
// =============================================================================

/**
 * HTTP handler for replica health check endpoint
 * Returns JSON health status suitable for load balancer health checks
 */
export interface HealthCheckEndpointOptions {
  /** Replication manager instance */
  manager: ReplicationManager;
  /** Maximum acceptable lag in bytes for healthy status */
  maxLagBytes?: number;
  /** Maximum acceptable lag in seconds for healthy status */
  maxLagSeconds?: number;
  /** Require at least N healthy replicas */
  minHealthyReplicas?: number;
}

/**
 * Create a health check response for load balancer integration
 */
export async function createHealthCheckResponse(
  options: HealthCheckEndpointOptions
): Promise<{
  status: 'healthy' | 'unhealthy' | 'degraded';
  statusCode: number;
  body: Record<string, unknown>;
}> {
  const {
    manager,
    maxLagBytes = 100 * 1024 * 1024, // 100MB
    maxLagSeconds = 30,
    minHealthyReplicas = 1,
  } = options;

  try {
    const health = await manager.getClusterHealth();

    // Determine status
    let status: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
    let statusCode = 200;

    if (!health.primaryHealthy) {
      status = 'unhealthy';
      statusCode = 503;
    } else if (health.healthyReplicaCount < minHealthyReplicas) {
      status = 'degraded';
      statusCode = 200; // Still accept traffic but with warning
    } else if (health.lagThresholdExceeded) {
      status = 'degraded';
      statusCode = 200;
    } else if (
      health.maxLagBytes > maxLagBytes ||
      health.replicationStats.some((s) => s.lagSeconds > maxLagSeconds)
    ) {
      status = 'degraded';
      statusCode = 200;
    }

    return {
      status,
      statusCode,
      body: {
        status,
        cluster: manager.getConfig().clusterName,
        primary: {
          nodeId: health.currentPrimary,
          healthy: health.primaryHealthy,
        },
        replicas: {
          healthy: health.healthyReplicaCount,
          total: health.totalReplicaCount,
          stats: health.replicationStats.map((s) => ({
            nodeId: s.nodeId,
            status: s.status,
            lagBytes: s.lagBytes,
            lagSeconds: s.lagSeconds,
            isInSync: s.isInSync,
          })),
        },
        metrics: {
          averageLagBytes: health.averageLagBytes,
          maxLagBytes: health.maxLagBytes,
          lagThresholdExceeded: health.lagThresholdExceeded,
        },
        timestamp: health.lastCheckAt.toISOString(),
        checkDurationMs: health.checkDurationMs,
      },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      statusCode: 503,
      body: {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
    };
  }
}

// =============================================================================
// Exports
// =============================================================================

export default ReplicationManager;
