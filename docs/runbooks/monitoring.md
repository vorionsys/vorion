# Monitoring Runbook

This runbook covers key metrics, Prometheus queries, alert thresholds, and dashboard setup for Vorion deployments.

## Table of Contents

- [Key Metrics Overview](#key-metrics-overview)
- [Health Check Metrics](#health-check-metrics)
- [Database Metrics](#database-metrics)
- [Redis Metrics](#redis-metrics)
- [Queue Metrics](#queue-metrics)
- [Circuit Breaker Metrics](#circuit-breaker-metrics)
- [Process Metrics](#process-metrics)
- [Prometheus Queries](#prometheus-queries)
- [Alert Configuration](#alert-configuration)
- [Dashboard Setup](#dashboard-setup)

---

## Key Metrics Overview

### Critical Metrics (Alert on These)

| Metric | Warning Threshold | Critical Threshold |
|--------|-------------------|-------------------|
| Service Status | `degraded` | `unhealthy` |
| Database Circuit | `HALF_OPEN` | `OPEN` |
| Redis Circuit | `HALF_OPEN` | `OPEN` |
| Queue Depth | > 5,000 | > 10,000 |
| Memory Usage | > 80% | > 90% |
| Health Check Latency | > 1s | > 5s |
| Error Rate (5xx) | > 1% | > 5% |

### Operational Metrics (Monitor These)

| Metric | Normal Range | Source |
|--------|--------------|--------|
| Database Latency | < 50ms | `/health/detailed` |
| Redis Latency | < 10ms | `/health/detailed` |
| Queue Processing Latency | < 100ms | `/health/ready` |
| Request Rate | Varies by load | Prometheus |
| Active Connections | < pool max | `/health/detailed` |

---

## Health Check Metrics

### Endpoints to Monitor

```bash
# Liveness (fast, process-level)
GET /health/live

# Readiness (dependency checks)
GET /health/ready

# Startup (one-time initialization)
GET /health/startup

# Detailed status (full diagnostics)
GET /health/detailed
```

### Example Responses

**Healthy Response** (`/health`):
```json
{
  "status": "healthy",
  "mode": "full",
  "version": "0.1.0",
  "environment": "production",
  "uptime": 86400,
  "timestamp": "2024-01-15T10:30:00Z",
  "checks": {
    "database": {
      "status": "ok",
      "latencyMs": 12,
      "circuit": {
        "state": "CLOSED",
        "failureCount": 0
      }
    },
    "redis": {
      "status": "ok",
      "latencyMs": 3,
      "circuit": {
        "state": "CLOSED",
        "failureCount": 0
      }
    }
  },
  "process": {
    "memoryMb": {
      "rss": 256,
      "heapTotal": 128,
      "heapUsed": 96
    },
    "uptimeSeconds": 86400
  }
}
```

**Degraded Response**:
```json
{
  "status": "degraded",
  "affectedServices": ["redis"],
  "checks": {
    "database": { "status": "ok" },
    "redis": {
      "status": "ok",
      "circuit": {
        "state": "HALF_OPEN",
        "timeUntilResetMs": 5000
      }
    }
  }
}
```

### Readiness Check Response

```json
{
  "status": "ready",
  "mode": "full",
  "checks": {
    "database": true,
    "redis": true,
    "queue": {
      "healthy": true,
      "workersAvailable": true,
      "queueDepth": 150,
      "maxQueueDepth": 10000,
      "activeJobs": 5,
      "waitingJobs": 145,
      "failedJobs": 2,
      "deadLetterCount": 0,
      "processingLatencyMs": 45
    }
  }
}
```

---

## Database Metrics

### Key Database Metrics

| Metric | Description | Source |
|--------|-------------|--------|
| `database.healthy` | Connection pool is working | `/health/detailed` |
| `database.latencyMs` | Health check query latency | `/health/detailed` |
| `database.circuit.state` | Circuit breaker state | `/health/detailed` |
| `database.circuit.failureCount` | Recent failures | `/health/detailed` |

### Configuration Metrics

Available in `/health/detailed` response:
```json
{
  "config": {
    "database": {
      "poolMin": 10,
      "poolMax": 50,
      "statementTimeoutMs": 30000
    }
  }
}
```

### Database Health Indicators

| Indicator | Healthy | Warning | Critical |
|-----------|---------|---------|----------|
| Latency | < 50ms | 50-200ms | > 200ms |
| Circuit State | CLOSED | HALF_OPEN | OPEN |
| Failure Count | 0 | 1-3 | > 3 |
| Pool Utilization | < 70% | 70-90% | > 90% |

---

## Redis Metrics

### Key Redis Metrics

| Metric | Description | Source |
|--------|-------------|--------|
| `redis.healthy` | Redis responding to PING | `/health/detailed` |
| `redis.latencyMs` | PING latency | `/health/detailed` |
| `redis.circuit.state` | Circuit breaker state | `/health/detailed` |

### Redis Health Indicators

| Indicator | Healthy | Warning | Critical |
|-----------|---------|---------|----------|
| Latency | < 10ms | 10-50ms | > 50ms |
| Circuit State | CLOSED | HALF_OPEN | OPEN |
| Memory Usage | < 70% | 70-85% | > 85% |

### Lite Mode Behavior

In lite mode (`VORION_LITE_ENABLED=true`), Redis metrics show:
```json
{
  "redis": {
    "status": "skipped",
    "message": "Not required in lite mode"
  }
}
```

---

## Queue Metrics

### Key Queue Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `queueDepth` | Total jobs (waiting + active) | > 10,000 |
| `workersAvailable` | Workers ready to process | `false` |
| `processingLatencyMs` | Canary job latency | > 100ms |
| `activeJobs` | Currently processing | > concurrency |
| `waitingJobs` | Queued for processing | Growing trend |
| `failedJobs` | Failed job count | > 0 and growing |
| `deadLetterCount` | Permanently failed jobs | > 0 |

### Queue Health Response

```json
{
  "queue": {
    "healthy": true,
    "workersAvailable": true,
    "workersRunning": true,
    "queueDepth": 150,
    "maxQueueDepth": 10000,
    "processingLatencyMs": 45,
    "jobs": {
      "active": 5,
      "waiting": 145,
      "completed": 12500,
      "failed": 3,
      "deadLetter": 0
    },
    "details": {
      "intake": { "waiting": 50, "active": 2 },
      "evaluate": { "waiting": 45, "active": 2 },
      "decision": { "waiting": 50, "active": 1 }
    },
    "canaryJob": {
      "success": true,
      "latencyMs": 45
    }
  }
}
```

### Queue Health Indicators

| Indicator | Healthy | Warning | Critical |
|-----------|---------|---------|----------|
| Queue Depth | < 5,000 | 5,000-10,000 | > 10,000 |
| Processing Latency | < 100ms | 100-500ms | > 500ms |
| Dead Letter Count | 0 | 1-10 | > 10 |
| Workers Available | true | - | false |

---

## Circuit Breaker Metrics

### Circuit Breaker States

```
CLOSED --> (failures >= threshold) --> OPEN
   ^                                    |
   |                                    v
   +-- (success in half-open) <-- HALF_OPEN (after reset timeout)
```

### Available Circuit Breakers

| Circuit | Purpose | Default Thresholds |
|---------|---------|-------------------|
| database | PostgreSQL connections | 5 failures, 30s reset |
| redis | Redis connections | 10 failures, 10s reset |
| webhook | Webhook delivery | 3 failures, 60s reset |
| policyEngine | Policy evaluation | 5 failures, 15s reset |
| trustEngine | Trust calculations | 5 failures, 15s reset |

### Circuit Breaker Response

```json
{
  "circuitBreakers": {
    "database": {
      "state": "CLOSED",
      "failureCount": 0,
      "failureThreshold": 5,
      "resetTimeoutMs": 30000,
      "halfOpenMaxAttempts": 3,
      "halfOpenAttempts": 0,
      "monitorWindowMs": 60000,
      "lastFailureTime": null,
      "openedAt": null,
      "timeUntilResetMs": null
    },
    "redis": {
      "state": "HALF_OPEN",
      "failureCount": 0,
      "halfOpenAttempts": 2,
      "timeUntilResetMs": null
    }
  }
}
```

---

## Process Metrics

### Memory Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `rss` | Resident Set Size (total allocated) | > 90% of limit |
| `heapTotal` | V8 heap total size | Growing trend |
| `heapUsed` | V8 heap used | > 80% of total |
| `external` | C++ object memory | Unusual growth |
| `arrayBuffers` | ArrayBuffer memory | Growing trend |

### CPU Metrics

| Metric | Description |
|--------|-------------|
| `cpu.user` | CPU time in user mode (ms) |
| `cpu.system` | CPU time in kernel mode (ms) |

### Example Process Metrics

```json
{
  "process": {
    "pid": 1,
    "uptimeSeconds": 86400,
    "memory": {
      "rss": 256,
      "heapTotal": 128,
      "heapUsed": 96,
      "external": 16,
      "arrayBuffers": 8
    },
    "cpu": {
      "user": 150000,
      "system": 25000
    }
  }
}
```

---

## Prometheus Queries

### Service Health

```promql
# Overall service availability (up/down)
up{job="vorion"}

# Health check status (requires metric exporter)
vorion_health_status{status="healthy"}

# Request error rate
sum(rate(http_requests_total{job="vorion",status=~"5.."}[5m]))
/ sum(rate(http_requests_total{job="vorion"}[5m])) * 100
```

### Database Metrics

```promql
# Database health check latency
vorion_health_check_latency_ms{component="database"}

# Database circuit breaker state (0=closed, 1=half-open, 2=open)
vorion_circuit_breaker_state{service="database"}

# Connection pool utilization
pg_stat_activity_count{datname="vorion"} / vorion_db_pool_max * 100
```

### Redis Metrics

```promql
# Redis health check latency
vorion_health_check_latency_ms{component="redis"}

# Redis circuit breaker state
vorion_circuit_breaker_state{service="redis"}

# Redis memory usage
redis_memory_used_bytes / redis_memory_max_bytes * 100
```

### Queue Metrics

```promql
# Queue depth
vorion_queue_depth{queue="intent-submission"}

# Queue processing rate
rate(vorion_jobs_processed_total[5m])

# Queue failure rate
rate(vorion_jobs_failed_total[5m])

# Dead letter queue size
vorion_dead_letter_count
```

### Resource Metrics

```promql
# Memory usage percentage
process_resident_memory_bytes{job="vorion"}
/ on(pod) kube_pod_container_resource_limits{resource="memory"} * 100

# CPU usage
rate(process_cpu_seconds_total{job="vorion"}[5m])

# Heap memory utilization
nodejs_heap_size_used_bytes{job="vorion"}
/ nodejs_heap_size_total_bytes{job="vorion"} * 100
```

---

## Alert Configuration

### Critical Alerts

```yaml
# Service Unhealthy
- alert: VorionServiceUnhealthy
  expr: vorion_health_status{status="unhealthy"} == 1
  for: 1m
  labels:
    severity: critical
  annotations:
    summary: "Vorion service is unhealthy"
    description: "Service {{ $labels.instance }} has been unhealthy for more than 1 minute"

# Database Circuit Open
- alert: VorionDatabaseCircuitOpen
  expr: vorion_circuit_breaker_state{service="database"} == 2
  for: 30s
  labels:
    severity: critical
  annotations:
    summary: "Database circuit breaker is OPEN"
    description: "Database connectivity issues detected. Circuit will attempt reset after timeout."

# High Error Rate
- alert: VorionHighErrorRate
  expr: |
    sum(rate(http_requests_total{job="vorion",status=~"5.."}[5m]))
    / sum(rate(http_requests_total{job="vorion"}[5m])) > 0.05
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "High error rate detected"
    description: "Error rate is {{ $value | humanizePercentage }} (threshold: 5%)"

# Memory Critical
- alert: VorionMemoryCritical
  expr: |
    process_resident_memory_bytes{job="vorion"}
    / on(pod) kube_pod_container_resource_limits{resource="memory"} > 0.9
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Memory usage critical"
    description: "Memory usage is at {{ $value | humanizePercentage }}"
```

### Warning Alerts

```yaml
# Service Degraded
- alert: VorionServiceDegraded
  expr: vorion_health_status{status="degraded"} == 1
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Vorion service is degraded"
    description: "Service {{ $labels.instance }} has been degraded for more than 5 minutes"

# Queue Depth High
- alert: VorionQueueDepthHigh
  expr: vorion_queue_depth > 5000
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Queue depth is high"
    description: "Queue depth is {{ $value }} (threshold: 5000)"

# Circuit Breaker Half-Open
- alert: VorionCircuitHalfOpen
  expr: vorion_circuit_breaker_state == 1
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Circuit breaker in HALF_OPEN state"
    description: "{{ $labels.service }} circuit has been in recovery mode for 5 minutes"

# Dead Letter Queue Growing
- alert: VorionDeadLetterGrowing
  expr: increase(vorion_dead_letter_count[1h]) > 10
  labels:
    severity: warning
  annotations:
    summary: "Dead letter queue is growing"
    description: "{{ $value }} jobs added to dead letter queue in the last hour"
```

### Informational Alerts

```yaml
# Slow Health Checks
- alert: VorionSlowHealthCheck
  expr: vorion_health_check_latency_ms > 1000
  for: 15m
  labels:
    severity: info
  annotations:
    summary: "Health checks are slow"
    description: "Health check latency is {{ $value }}ms"

# High Queue Processing Latency
- alert: VorionSlowQueueProcessing
  expr: vorion_queue_processing_latency_ms > 500
  for: 15m
  labels:
    severity: info
  annotations:
    summary: "Queue processing is slow"
    description: "Processing latency is {{ $value }}ms"
```

---

## Dashboard Setup

### Recommended Dashboard Layout

#### Row 1: Service Overview
- **Service Status Panel**: Current status (healthy/degraded/unhealthy)
- **Uptime Panel**: Service uptime counter
- **Version Panel**: Current deployed version
- **Mode Panel**: Full or Lite mode indicator

#### Row 2: Health Checks
- **Health Check Latency**: Time series of database/redis check latency
- **Circuit Breaker States**: Stat panels for each circuit
- **Error Rate**: 5xx response percentage over time

#### Row 3: Database
- **Database Latency**: Health check query latency
- **Connection Pool**: Pool utilization percentage
- **Circuit Breaker History**: State transitions over time

#### Row 4: Redis
- **Redis Latency**: PING latency
- **Redis Memory**: Memory usage percentage
- **Circuit Breaker History**: State transitions over time

#### Row 5: Queues
- **Queue Depth**: Current depth vs threshold
- **Job Throughput**: Jobs processed/failed per minute
- **Processing Latency**: Canary job latency
- **Dead Letter Count**: Failed jobs requiring attention

#### Row 6: Resources
- **Memory Usage**: RSS and heap over time
- **CPU Usage**: User and system CPU time
- **Pod Count**: Number of running replicas

### Grafana Dashboard JSON

A sample Grafana dashboard can be imported from:
```
/docs/monitoring/grafana-dashboard.json
```

### Key Panel Configurations

#### Status Panel
```json
{
  "type": "stat",
  "title": "Service Status",
  "targets": [{
    "expr": "vorion_health_status"
  }],
  "fieldConfig": {
    "defaults": {
      "mappings": [{
        "type": "value",
        "options": {
          "healthy": {"color": "green", "text": "Healthy"},
          "degraded": {"color": "yellow", "text": "Degraded"},
          "unhealthy": {"color": "red", "text": "Unhealthy"}
        }
      }]
    }
  }
}
```

#### Circuit Breaker Panel
```json
{
  "type": "stat",
  "title": "Database Circuit",
  "targets": [{
    "expr": "vorion_circuit_breaker_state{service=\"database\"}"
  }],
  "fieldConfig": {
    "defaults": {
      "mappings": [{
        "type": "value",
        "options": {
          "0": {"color": "green", "text": "CLOSED"},
          "1": {"color": "yellow", "text": "HALF_OPEN"},
          "2": {"color": "red", "text": "OPEN"}
        }
      }]
    }
  }
}
```

---

## Metric Collection Configuration

### Health Check Polling

Configure your monitoring system to poll health endpoints:

```yaml
# Prometheus scrape config
scrape_configs:
  - job_name: 'vorion'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['vorion:3000']
    scrape_interval: 15s
    scrape_timeout: 10s

  - job_name: 'vorion-health'
    metrics_path: '/health/detailed'
    static_configs:
      - targets: ['vorion:3000']
    scrape_interval: 30s
    scrape_timeout: 5s
```

### Kubernetes Probes

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 10
  failureThreshold: 3

startupProbe:
  httpGet:
    path: /health/startup
    port: 3000
  initialDelaySeconds: 0
  periodSeconds: 5
  timeoutSeconds: 10
  failureThreshold: 30
```

### Health Check Timeout Configuration

```bash
# Per-check timeout (database, redis individual checks)
VORION_HEALTH_CHECK_TIMEOUT_MS=5000

# Overall /ready endpoint timeout
VORION_READY_CHECK_TIMEOUT_MS=10000

# Liveness check timeout (should be fast)
VORION_LIVENESS_CHECK_TIMEOUT_MS=1000
```
