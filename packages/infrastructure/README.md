# @vorionsys/infrastructure

Infrastructure components for the Vorion platform -- PostgreSQL high availability, replication, and cluster management.

## Installation

```bash
npm install @vorionsys/infrastructure
```

### Peer Dependencies

- `pg` (required) -- PostgreSQL client
- `prom-client` (optional) -- Prometheus metrics

## Features

- **ReplicationManager** -- Manages PostgreSQL HA clusters with streaming replication, health monitoring, and failover coordination.
- **Configuration generators** -- Produce config for streaming replication, Patroni, and pg_auto_failover.
- **Health checks** -- Load-balancer-ready health check responses with degraded/unhealthy statuses.
- **Prometheus metrics** -- Replication lag, cluster health, failover events, and health check duration.

## Usage

```typescript
import { ReplicationManager } from '@vorionsys/infrastructure';

const manager = new ReplicationManager({
  clusterName: 'production',
  replicationMode: 'streaming',
  orchestrator: 'patroni',
  primary: { nodeId: 'primary', host: 'pg-primary', port: 5432, database: 'app', user: 'repl', password: '***' },
  replicas: [
    { nodeId: 'replica-1', host: 'pg-replica-1', port: 5432, database: 'app', user: 'repl', password: '***' },
  ],
  maxReplicationLagSeconds: 30,
  healthCheckIntervalMs: 10000,
});

await manager.start();
const health = await manager.getClusterHealth();
console.log(`Healthy replicas: ${health.healthyReplicaCount}/${health.totalReplicaCount}`);
await manager.stop();
```

### Configuration Generators

```typescript
import {
  generateStreamingReplicationConfig,
  generatePatroniConfig,
  generatePgAutoFailoverCommands,
} from '@vorionsys/infrastructure';

const config = generateStreamingReplicationConfig({
  replicationUser: 'replicator',
  primaryHost: '10.0.0.1',
  primaryPort: 5432,
  replicaHosts: ['10.0.0.2', '10.0.0.3'],
});
```

## Exports

| Export Path                                       | Description                            |
| ------------------------------------------------- | -------------------------------------- |
| `@vorionsys/infrastructure`                      | All exports (manager, types, metrics)  |
| `@vorionsys/infrastructure/database`             | Database module                        |
| `@vorionsys/infrastructure/database/replication` | Replication only                       |

## Prometheus Metrics

| Metric                                  | Type      | Description                  |
| --------------------------------------- | --------- | ---------------------------- |
| `vorion_pg_replication_lag_bytes`       | Gauge     | Replication lag in bytes     |
| `vorion_pg_replication_lag_seconds`     | Gauge     | Replication lag in seconds   |
| `vorion_pg_cluster_health`             | Gauge     | Cluster health (1/0)         |
| `vorion_pg_healthy_replica_count`      | Gauge     | Healthy replica count        |
| `vorion_pg_failover_events_total`      | Counter   | Failover events              |
| `vorion_pg_failover_duration_seconds`  | Histogram | Failover duration            |

## Requirements

- Node.js >= 18
- PostgreSQL 12+

## License

Apache-2.0
