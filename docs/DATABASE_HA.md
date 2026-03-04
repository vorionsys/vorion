# PostgreSQL High Availability Architecture

This document describes the PostgreSQL High Availability (HA) setup for the Vorion platform, including replication architecture, failover procedures, monitoring, and operational runbooks.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Replication Configuration](#replication-configuration)
4. [Cluster Orchestration](#cluster-orchestration)
5. [Monitoring Setup](#monitoring-setup)
6. [Failover Procedures](#failover-procedures)
7. [Replica Promotion](#replica-promotion)
8. [Operational Runbooks](#operational-runbooks)
9. [Troubleshooting](#troubleshooting)

## Overview

The Vorion platform uses PostgreSQL streaming replication for high availability. The architecture supports:

- **Streaming Replication**: Asynchronous or synchronous WAL streaming
- **Automatic Failover**: Via Patroni or pg_auto_failover
- **Read Scaling**: Query routing to replicas for read-heavy workloads
- **Zero/Near-Zero Data Loss**: Synchronous replication option for critical data

### Key Components

| Component | Purpose |
|-----------|---------|
| Primary | Handles all write operations |
| Replica(s) | Receive streamed WAL, serve read queries |
| Orchestrator | Patroni or pg_auto_failover for cluster management |
| DCS | Distributed configuration store (etcd/Consul/ZooKeeper) |
| Replication Manager | Monitoring and metrics collection |

## Architecture

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                     Load Balancer                        │
                    │              (HAProxy / PgBouncer / Cloud LB)            │
                    └────────────────────────┬────────────────────────────────┘
                                             │
                    ┌────────────────────────┼────────────────────────────────┐
                    │                        │                                 │
                    ▼                        ▼                                 ▼
         ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
         │   Primary Node   │    │  Replica Node 1  │    │  Replica Node 2  │
         │                  │    │                  │    │                  │
         │  ┌────────────┐  │    │  ┌────────────┐  │    │  ┌────────────┐  │
         │  │ PostgreSQL │  │    │  │ PostgreSQL │  │    │  │ PostgreSQL │  │
         │  │            │──┼────┼──│ (standby)  │  │    │  │ (standby)  │  │
         │  └────────────┘  │    │  └────────────┘  │    │  └────────────┘  │
         │        │         │    │        │         │    │        │         │
         │  ┌────────────┐  │    │  ┌────────────┐  │    │  ┌────────────┐  │
         │  │  Patroni   │  │    │  │  Patroni   │  │    │  │  Patroni   │  │
         │  └────────────┘  │    │  └────────────┘  │    │  └────────────┘  │
         └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘
                  │                       │                       │
                  └───────────────────────┼───────────────────────┘
                                          │
                              ┌───────────┴───────────┐
                              │   DCS (etcd/Consul)   │
                              │   Leader Election     │
                              └───────────────────────┘
```

### Replication Flow

1. Client writes to Primary
2. Primary writes to WAL (Write-Ahead Log)
3. WAL records streamed to Replicas via walsender
4. Replicas apply WAL records (walreceiver)
5. Replicas become available for read queries

## Replication Configuration

### Using the Infrastructure Package

```typescript
import {
  ReplicationManager,
  generateStreamingReplicationConfig,
  generatePatroniConfig,
} from '@vorionsys/infrastructure';

// Create replication manager
const manager = new ReplicationManager({
  clusterName: 'vorion-production',
  replicationMode: 'streaming',
  orchestrator: 'patroni',
  primary: {
    nodeId: 'pg-primary',
    host: 'pg-primary.internal',
    port: 5432,
    database: 'vorion',
    user: 'replication_user',
    password: process.env.REPLICATION_PASSWORD!,
  },
  replicas: [
    {
      nodeId: 'pg-replica-1',
      host: 'pg-replica-1.internal',
      port: 5432,
      database: 'vorion',
      user: 'replication_user',
      password: process.env.REPLICATION_PASSWORD!,
    },
    {
      nodeId: 'pg-replica-2',
      host: 'pg-replica-2.internal',
      port: 5432,
      database: 'vorion',
      user: 'replication_user',
      password: process.env.REPLICATION_PASSWORD!,
    },
  ],
  maxReplicationLagBytes: 100 * 1024 * 1024, // 100MB
  maxReplicationLagSeconds: 30,
  healthCheckIntervalMs: 10000,
  autoFailoverEnabled: true,
  patroni: {
    apiEndpoint: 'http://pg-primary.internal:8008',
    dcsType: 'etcd',
    dcsEndpoint: 'http://etcd.internal:2379',
    namespace: 'vorion',
  },
});

await manager.start();
```

### Primary Configuration (postgresql.conf)

```ini
# Replication Settings
wal_level = replica
max_wal_senders = 10
max_replication_slots = 10
wal_keep_size = 1GB
hot_standby = on

# Synchronous Replication (optional, for zero data loss)
synchronous_commit = on
synchronous_standby_names = 'FIRST 1 (pg-replica-1, pg-replica-2)'

# Archive Mode (for point-in-time recovery)
archive_mode = on
archive_command = 'pgbackrest --stanza=vorion archive-push %p'

# Performance Tuning
wal_buffers = 64MB
checkpoint_completion_target = 0.9
max_wal_size = 4GB
min_wal_size = 1GB
```

### Primary Configuration (pg_hba.conf)

```
# Replication connections
host    replication     replicator      10.0.0.0/8              scram-sha-256
host    replication     replicator      172.16.0.0/12           scram-sha-256
host    replication     replicator      192.168.0.0/16          scram-sha-256
```

### Replica Configuration

```ini
# Replica Settings
hot_standby = on
hot_standby_feedback = on
max_standby_streaming_delay = 30s
max_standby_archive_delay = 30s

# Recovery Configuration (PostgreSQL 12+)
# Create standby.signal file instead of recovery.conf
primary_conninfo = 'host=pg-primary port=5432 user=replicator password=secret'
primary_slot_name = 'replica_1_slot'
recovery_target_timeline = 'latest'
```

## Cluster Orchestration

### Patroni Setup

Patroni provides automatic failover with distributed consensus via etcd/Consul/ZooKeeper.

```yaml
# patroni.yml
scope: vorion-cluster
name: pg-node-1

restapi:
  listen: 0.0.0.0:8008
  connect_address: pg-node-1:8008

etcd:
  hosts:
    - etcd-1:2379
    - etcd-2:2379
    - etcd-3:2379

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576  # 1MB
    postgresql:
      use_pg_rewind: true
      use_slots: true
      parameters:
        wal_level: replica
        hot_standby: on
        max_connections: 200
        max_wal_senders: 10
        max_replication_slots: 10

  initdb:
    - encoding: UTF8
    - data-checksums

  pg_hba:
    - host replication replicator 0.0.0.0/0 md5
    - host all all 0.0.0.0/0 md5

postgresql:
  listen: 0.0.0.0:5432
  connect_address: pg-node-1:5432
  data_dir: /var/lib/postgresql/data
  authentication:
    superuser:
      username: postgres
      password: ${POSTGRES_PASSWORD}
    replication:
      username: replicator
      password: ${REPLICATION_PASSWORD}
```

### pg_auto_failover Setup

```bash
# Create monitor node
pg_autoctl create monitor \
  --pgdata /var/lib/postgresql/monitor \
  --pgport 5000 \
  --hostname monitor.internal \
  --ssl-mode require

# Create primary node
pg_autoctl create postgres \
  --pgdata /var/lib/postgresql/data \
  --pgport 5432 \
  --hostname primary.internal \
  --name primary \
  --formation vorion \
  --monitor 'postgres://autoctl_node@monitor.internal:5000/pg_auto_failover'

# Create secondary node
pg_autoctl create postgres \
  --pgdata /var/lib/postgresql/data \
  --pgport 5432 \
  --hostname secondary.internal \
  --name secondary \
  --formation vorion \
  --monitor 'postgres://autoctl_node@monitor.internal:5000/pg_auto_failover'
```

## Monitoring Setup

### Prometheus Metrics

The infrastructure package exposes the following metrics:

| Metric | Type | Description |
|--------|------|-------------|
| `vorion_pg_replication_lag_bytes` | Gauge | Replication lag in bytes per replica |
| `vorion_pg_replication_lag_seconds` | Gauge | Replication lag in seconds per replica |
| `vorion_pg_replica_status` | Gauge | Replica status (1=streaming, 0=failed) |
| `vorion_pg_cluster_health` | Gauge | Overall cluster health (1=healthy, 0=unhealthy) |
| `vorion_pg_healthy_replica_count` | Gauge | Number of healthy replicas |
| `vorion_pg_failover_events_total` | Counter | Total failover events |
| `vorion_pg_failover_duration_seconds` | Histogram | Failover duration |
| `vorion_pg_health_check_duration_seconds` | Histogram | Health check latency |
| `vorion_pg_health_check_errors_total` | Counter | Health check errors |

### Integration Example

```typescript
import { replicationRegistry } from '@vorionsys/infrastructure';
import { register } from 'prom-client';

// Merge replication metrics into global registry
register.merge(replicationRegistry);

// Expose /metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### Grafana Dashboard

Example queries for Grafana:

```promql
# Replication lag across replicas
vorion_pg_replication_lag_bytes{cluster="vorion-production"}

# Lag threshold alert
vorion_pg_replication_lag_seconds{cluster="vorion-production"} > 30

# Cluster health
vorion_pg_cluster_health{cluster="vorion-production"}

# Failover rate (last hour)
increase(vorion_pg_failover_events_total{cluster="vorion-production"}[1h])
```

### AlertManager Rules

```yaml
groups:
  - name: postgresql-ha
    rules:
      - alert: PostgreSQLReplicationLagHigh
        expr: vorion_pg_replication_lag_seconds > 30
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "PostgreSQL replication lag is high"
          description: "Replica {{ $labels.replica_id }} has {{ $value }}s lag"

      - alert: PostgreSQLClusterUnhealthy
        expr: vorion_pg_cluster_health == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL cluster is unhealthy"
          description: "Cluster {{ $labels.cluster }} is in unhealthy state"

      - alert: PostgreSQLNoHealthyReplicas
        expr: vorion_pg_healthy_replica_count == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "No healthy PostgreSQL replicas"
          description: "Cluster {{ $labels.cluster }} has no healthy replicas"
```

## Failover Procedures

### Automatic Failover (Patroni)

Patroni handles automatic failover when:
1. Primary becomes unreachable
2. Primary health check fails
3. Replication lag exceeds threshold

Failover process:
1. Patroni detects primary failure
2. Leader lock is released/expires in DCS
3. Replicas compete for leadership
4. Most up-to-date replica wins election
5. New leader promotes itself
6. Other replicas reconfigure to follow new primary

### Manual Switchover

For planned maintenance:

```typescript
// Using Replication Manager
const event = await manager.switchover('pg-replica-1', 'scheduled_maintenance');

console.log(`Switchover ${event.success ? 'succeeded' : 'failed'}`);
console.log(`Previous primary: ${event.previousPrimary}`);
console.log(`New primary: ${event.newPrimary}`);
```

Or via Patroni CLI:

```bash
# Switchover with Patroni
patronictl switchover vorion-cluster --leader pg-primary --candidate pg-replica-1 --force

# Check cluster status
patronictl list vorion-cluster
```

Or via pg_auto_failover:

```bash
# Perform failover
pg_autoctl perform failover --formation vorion --group 0

# Check state
pg_autoctl show state --formation vorion
```

## Replica Promotion

### Manual Promotion Steps

1. **Verify replica is caught up**:
   ```sql
   -- On replica
   SELECT pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn();

   -- On primary
   SELECT pg_current_wal_lsn();
   ```

2. **Stop primary** (if not already down):
   ```bash
   pg_ctl stop -D /var/lib/postgresql/data -m fast
   ```

3. **Promote replica**:
   ```bash
   # Using pg_ctl
   pg_ctl promote -D /var/lib/postgresql/data

   # Or using SQL (PostgreSQL 12+)
   SELECT pg_promote();
   ```

4. **Verify promotion**:
   ```sql
   SELECT pg_is_in_recovery();  -- Should return false
   ```

5. **Reconfigure other replicas**:
   ```bash
   # Update primary_conninfo in postgresql.auto.conf or via ALTER SYSTEM
   ALTER SYSTEM SET primary_conninfo = 'host=new-primary port=5432 user=replicator';
   SELECT pg_reload_conf();
   ```

### Using Replication Manager

```typescript
// Listen for promotion events
manager.on('switchover_completed', (event) => {
  console.log(`Promotion complete: ${event.newPrimary} is now primary`);
});

manager.on('switchover_failed', (event) => {
  console.error(`Promotion failed: ${event.errorMessage}`);
});
```

## Operational Runbooks

### Runbook: Add New Replica

1. **Provision new server** with PostgreSQL installed

2. **Take base backup from primary**:
   ```bash
   pg_basebackup -h primary.internal -D /var/lib/postgresql/data \
     -U replicator -Fp -Xs -P -R
   ```

3. **Configure replica** (postgresql.conf):
   ```ini
   hot_standby = on
   primary_conninfo = 'host=primary.internal port=5432 user=replicator'
   ```

4. **Create standby.signal file**:
   ```bash
   touch /var/lib/postgresql/data/standby.signal
   ```

5. **Start PostgreSQL**:
   ```bash
   pg_ctl start -D /var/lib/postgresql/data
   ```

6. **Update Replication Manager config** and restart

### Runbook: Remove Replica

1. **Stop replica PostgreSQL**:
   ```bash
   pg_ctl stop -D /var/lib/postgresql/data -m fast
   ```

2. **Drop replication slot** (on primary):
   ```sql
   SELECT pg_drop_replication_slot('replica_slot_name');
   ```

3. **Update Replication Manager config** and restart

4. **Deprovision server**

### Runbook: Rebuild Lagging Replica

If a replica falls too far behind:

1. **Stop replica**:
   ```bash
   pg_ctl stop -D /var/lib/postgresql/data -m immediate
   ```

2. **Remove data directory**:
   ```bash
   rm -rf /var/lib/postgresql/data/*
   ```

3. **Take fresh base backup**:
   ```bash
   pg_basebackup -h primary.internal -D /var/lib/postgresql/data \
     -U replicator -Fp -Xs -P -R
   ```

4. **Start replica**:
   ```bash
   pg_ctl start -D /var/lib/postgresql/data
   ```

## Troubleshooting

### Common Issues

#### High Replication Lag

**Symptoms**: `vorion_pg_replication_lag_seconds` consistently > 30s

**Causes**:
- Network latency between nodes
- Replica under-provisioned (CPU/IO)
- Heavy write load on primary
- Long-running transactions on replica

**Resolution**:
1. Check network: `ping`, `traceroute`, bandwidth tests
2. Monitor replica resources: `top`, `iostat`, `vmstat`
3. Consider increasing `max_standby_streaming_delay`
4. Enable `hot_standby_feedback` to prevent query conflicts

#### Replica Not Streaming

**Symptoms**: Replica status shows `disconnected` or `catchup`

**Causes**:
- Network connectivity issues
- Authentication failure
- Replication slot full
- Primary configuration issue

**Resolution**:
1. Check connectivity: `pg_isready -h primary.internal`
2. Verify credentials in `primary_conninfo`
3. Check replication slots: `SELECT * FROM pg_replication_slots;`
4. Review PostgreSQL logs on both nodes

#### Split-Brain Prevention

With Patroni/pg_auto_failover, split-brain is prevented via:
- Distributed consensus (DCS quorum)
- Fencing of old primary
- Timeline ID tracking

If manual intervention caused split-brain:
1. **Identify authoritative primary** (highest timeline, most data)
2. **Stop secondary primary immediately**
3. **Rebuild the secondary from base backup**

### Useful Diagnostic Queries

```sql
-- Check replication status on primary
SELECT
  client_addr,
  state,
  sent_lsn,
  write_lsn,
  flush_lsn,
  replay_lsn,
  write_lag,
  flush_lag,
  replay_lag
FROM pg_stat_replication;

-- Check replication slots
SELECT
  slot_name,
  slot_type,
  active,
  restart_lsn,
  confirmed_flush_lsn
FROM pg_replication_slots;

-- Check if in recovery (replica)
SELECT pg_is_in_recovery();

-- Get current WAL position
SELECT pg_current_wal_lsn();  -- Primary
SELECT pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn();  -- Replica

-- Calculate lag in bytes
SELECT
  pg_wal_lsn_diff(
    pg_current_wal_lsn(),
    replay_lsn
  ) as lag_bytes
FROM pg_stat_replication;
```

## References

- [PostgreSQL Streaming Replication](https://www.postgresql.org/docs/current/warm-standby.html)
- [Patroni Documentation](https://patroni.readthedocs.io/)
- [pg_auto_failover](https://pg-auto-failover.readthedocs.io/)
- [PostgreSQL High Availability](https://www.postgresql.org/docs/current/high-availability.html)
