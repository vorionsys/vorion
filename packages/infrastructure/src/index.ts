/**
 * @vorionsys/infrastructure
 *
 * Infrastructure components for the Vorion platform.
 *
 * Provides:
 * - Database HA (PostgreSQL replication, failover)
 * - Cluster management (Patroni, pg_auto_failover)
 * - Health monitoring and metrics
 *
 * @packageDocumentation
 */

// Database infrastructure
export * as database from './database/index.js';

// Re-export commonly used types and classes
export {
  ReplicationManager,
  type ReplicationClusterConfig,
  type PostgresNodeConfig,
  type ClusterHealth,
  type ReplicationStats,
  type FailoverEvent,
  type NodeHealthCheck,
  type PatroniConfig,
  type PgAutoFailoverConfig,
  type ReplicaStatus,
  type NodeRole,
  type FailoverReason,
  type ReplicationMode,
  type ClusterOrchestrator,
  generateStreamingReplicationConfig,
  generatePatroniConfig,
  generatePgAutoFailoverCommands,
  createHealthCheckResponse,
  replicationRegistry,
  replicationLagBytesGauge,
  replicationLagSecondsGauge,
  clusterHealthGauge,
  healthyReplicaCountGauge,
  failoverEventsCounter,
  failoverDurationHistogram,
} from './database/replication.js';
