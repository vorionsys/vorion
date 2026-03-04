# Enterprise Deployment Guide

The Enterprise deployment mode provides high availability, horizontal scaling, and production-grade observability for large-scale deployments.

## Overview

- **High availability** with multiple API replicas
- **Load balancing** with Traefik (or NGINX/HAProxy)
- **Leader election** for singleton tasks
- **Graceful shutdown** with request draining
- **Full observability** stack (Prometheus, Grafana, OpenTelemetry)
- **Database clustering** support
- **Redis Sentinel/Cluster** for cache HA

## Architecture

```
                         Internet
                            |
                    +-------v--------+
                    |   CDN / WAF    |
                    +-------+--------+
                            |
                    +-------v--------+
                    |  Load Balancer |
                    |    (Traefik)   |
                    +-------+--------+
                            |
         +------------------+------------------+
         |                  |                  |
   +-----v-----+      +-----v-----+      +-----v-----+
   | Vorion 1  |      | Vorion 2  |      | Vorion 3  |
   | (Leader)  |      | (Worker)  |      | (Worker)  |
   +-----+-----+      +-----+-----+      +-----+-----+
         |                  |                  |
         +------------------+------------------+
                            |
         +------------------+------------------+
         |                                     |
   +-----v------+                       +------v------+
   | PostgreSQL |                       |    Redis    |
   |  Primary   |<---Replication--->    |  Sentinel   |
   |            |                       |             |
   +-----+------+                       +-------------+
         |
   +-----v------+
   | PostgreSQL |
   |  Replica   |
   +------------+
```

## Prerequisites

- Kubernetes 1.25+ or Docker Swarm
- PostgreSQL 15+ (managed service recommended)
- Redis 7+ with Sentinel or Cluster mode
- TLS certificates
- Secret management (Vault, AWS Secrets Manager, etc.)

## High Availability Setup

### Docker Compose (Development HA)

The `docker-compose.enterprise.yml` provides a starting point:

```bash
# Start with required secrets
export VORION_JWT_SECRET=$(openssl rand -base64 64)
export VORION_ENCRYPTION_KEY=$(openssl rand -base64 32)
export VORION_ENCRYPTION_SALT=$(openssl rand -base64 16)
export VORION_DEDUPE_SECRET=$(openssl rand -base64 32)
export VORION_CSRF_SECRET=$(openssl rand -base64 32)
export VORION_DB_PASSWORD=$(openssl rand -base64 24)

# Start with 3 replicas
docker compose -f docker-compose.enterprise.yml up -d --scale vorion=3

# Include local database and Redis for testing
docker compose -f docker-compose.enterprise.yml --profile with-db --profile with-redis up -d
```

### Required Environment Variables

All secrets are **required** in enterprise mode (no defaults):

```bash
# These will error if not set
VORION_JWT_SECRET       # JWT signing secret
VORION_ENCRYPTION_KEY   # Data encryption key
VORION_ENCRYPTION_SALT  # PBKDF2 salt
VORION_DEDUPE_SECRET    # Deduplication HMAC
VORION_CSRF_SECRET      # CSRF protection
VORION_DB_PASSWORD      # Database password
```

## Kubernetes Deployment

### Namespace Setup

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: vorion
  labels:
    name: vorion
```

### Secrets

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: vorion-secrets
  namespace: vorion
type: Opaque
stringData:
  jwt-secret: "your-64-byte-secret-here"
  encryption-key: "your-32-byte-key-here"
  encryption-salt: "your-16-byte-salt-here"
  dedupe-secret: "your-32-byte-secret-here"
  csrf-secret: "your-32-byte-secret-here"
  db-password: "your-database-password"
  redis-password: "your-redis-password"
```

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vorion
  namespace: vorion
spec:
  replicas: 3
  selector:
    matchLabels:
      app: vorion
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: vorion
    spec:
      terminationGracePeriodSeconds: 45
      containers:
      - name: vorion
        image: vorion/vorion:latest
        ports:
        - containerPort: 3000
          name: http
        - containerPort: 9090
          name: metrics
        env:
        - name: VORION_ENV
          value: "production"
        - name: VORION_LITE_MODE
          value: "false"
        - name: VORION_LEADER_ELECTION_ENABLED
          value: "true"
        - name: VORION_JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: vorion-secrets
              key: jwt-secret
        - name: VORION_ENCRYPTION_KEY
          valueFrom:
            secretKeyRef:
              name: vorion-secrets
              key: encryption-key
        - name: VORION_ENCRYPTION_SALT
          valueFrom:
            secretKeyRef:
              name: vorion-secrets
              key: encryption-salt
        - name: VORION_DEDUPE_SECRET
          valueFrom:
            secretKeyRef:
              name: vorion-secrets
              key: dedupe-secret
        - name: VORION_CSRF_SECRET
          valueFrom:
            secretKeyRef:
              name: vorion-secrets
              key: csrf-secret
        - name: VORION_DB_HOST
          value: "postgres-primary.vorion.svc.cluster.local"
        - name: VORION_DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: vorion-secrets
              key: db-password
        - name: VORION_REDIS_HOST
          value: "redis-sentinel.vorion.svc.cluster.local"
        - name: VORION_REDIS_PASSWORD
          valueFrom:
            secretKeyRef:
              name: vorion-secrets
              key: redis-password
        - name: VORION_DB_POOL_MIN
          value: "5"
        - name: VORION_DB_POOL_MAX
          value: "20"
        - name: VORION_TELEMETRY_ENABLED
          value: "true"
        - name: VORION_OTLP_ENDPOINT
          value: "http://otel-collector.monitoring.svc.cluster.local:4318/v1/traces"
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 15
          timeoutSeconds: 10
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 15
          periodSeconds: 10
          timeoutSeconds: 10
          failureThreshold: 3
        volumeMounts:
        - name: data
          mountPath: /app/data
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: vorion-data
```

### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: vorion
  namespace: vorion
spec:
  selector:
    app: vorion
  ports:
  - name: http
    port: 80
    targetPort: 3000
  - name: metrics
    port: 9090
    targetPort: 9090
```

### Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: vorion
  namespace: vorion
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
  - hosts:
    - api.vorion.yourdomain.com
    secretName: vorion-tls
  rules:
  - host: api.vorion.yourdomain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: vorion
            port:
              number: 80
```

### Horizontal Pod Autoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: vorion
  namespace: vorion
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: vorion
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

## Load Balancing

### Traefik Configuration

The enterprise compose includes Traefik:

```yaml
traefik:
  image: traefik:v2.10
  command:
    - "--api.dashboard=true"
    - "--providers.docker=true"
    - "--entrypoints.web.address=:80"
    - "--entrypoints.websecure.address=:443"
    - "--metrics.prometheus=true"
  ports:
    - "80:80"
    - "443:443"
    - "8080:8080"  # Dashboard
```

Vorion services are auto-discovered via labels:

```yaml
vorion:
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.vorion.rule=PathPrefix(`/`)"
    - "traefik.http.services.vorion.loadbalancer.server.port=3000"
    - "traefik.http.services.vorion.loadbalancer.healthcheck.path=/health/live"
```

### Health Check Configuration

Load balancer health checks should use:
- **Path**: `/health/live` for basic liveness
- **Path**: `/health/ready` for routing decisions (checks DB and Redis)
- **Interval**: 10-15 seconds
- **Timeout**: 10 seconds
- **Unhealthy threshold**: 3 consecutive failures

## Database Clustering

### Managed PostgreSQL (Recommended)

Use a managed service for production:
- **AWS**: Amazon RDS for PostgreSQL
- **GCP**: Cloud SQL for PostgreSQL
- **Azure**: Azure Database for PostgreSQL

Configuration:
```bash
VORION_DB_HOST=your-instance.region.rds.amazonaws.com
VORION_DB_PORT=5432
VORION_DB_NAME=vorion
VORION_DB_USER=vorion
VORION_DB_PASSWORD=<from-secrets-manager>
VORION_DB_POOL_MIN=5
VORION_DB_POOL_MAX=20
```

### Self-Managed Clustering

For self-managed PostgreSQL:

1. **Patroni** - HA PostgreSQL with automatic failover
2. **PgBouncer** - Connection pooling
3. **Replication** - Streaming replication to read replicas

Example architecture:
```
              +---------------+
              |   PgBouncer   |
              +-------+-------+
                      |
        +-------------+-------------+
        |                           |
  +-----v-----+              +------v-----+
  | Primary   |--Streaming-->|  Replica   |
  | (R/W)     |  Replication |  (R/O)     |
  +-----------+              +------------+
```

## Redis High Availability

### Redis Sentinel

```yaml
# redis-sentinel.yml
apiVersion: v1
kind: ConfigMap
metadata:
  name: redis-sentinel-config
data:
  sentinel.conf: |
    sentinel monitor mymaster redis-master 6379 2
    sentinel down-after-milliseconds mymaster 5000
    sentinel failover-timeout mymaster 60000
    sentinel parallel-syncs mymaster 1
```

Configure Vorion for Sentinel:
```bash
VORION_REDIS_HOST=redis-sentinel
VORION_REDIS_PORT=26379
VORION_REDIS_PASSWORD=<your-password>
```

### Redis Cluster

For larger deployments, use Redis Cluster:
- Automatic sharding across nodes
- Built-in replication
- No single point of failure

## Security Hardening Checklist

### Network Security

- [ ] All services in private subnet
- [ ] Load balancer in public subnet with TLS only
- [ ] Network policies restrict pod-to-pod communication
- [ ] Database accessible only from Vorion pods
- [ ] Redis accessible only from Vorion pods
- [ ] Egress limited to required destinations

### Authentication & Authorization

- [ ] JWT secrets rotated regularly (quarterly minimum)
- [ ] API keys have expiration dates
- [ ] Service accounts use minimal permissions
- [ ] Admin endpoints require additional authentication

### Data Protection

- [ ] Encryption at rest enabled (VORION_INTENT_ENCRYPT_CONTEXT=true)
- [ ] TLS for all connections (API, Database, Redis)
- [ ] Encryption keys stored in secrets manager
- [ ] Database encrypted (RDS encryption, etc.)

### Secrets Management

- [ ] No secrets in environment variables (use mounted secrets)
- [ ] Secrets rotated on schedule
- [ ] Access to secrets audited
- [ ] Separate secrets per environment

### Audit & Compliance

- [ ] Audit logging enabled (VORION_AUDIT_RETENTION_DAYS=365)
- [ ] Logs shipped to central system
- [ ] Access logs retained for compliance period
- [ ] Regular security assessments

### Container Security

- [ ] Images scanned for vulnerabilities
- [ ] Containers run as non-root (vorion user)
- [ ] Read-only root filesystem where possible
- [ ] Resource limits enforced
- [ ] Security contexts defined

### Kubernetes Security

```yaml
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1001
    runAsGroup: 1001
    fsGroup: 1001
  containers:
  - name: vorion
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop:
          - ALL
```

## Observability Stack

### OpenTelemetry Collector

```yaml
# deploy/otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 1s
    send_batch_size: 1024

exporters:
  prometheus:
    endpoint: "0.0.0.0:8889"
  jaeger:
    endpoint: jaeger-collector:14250
    tls:
      insecure: true

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [jaeger]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]
```

### Prometheus

```yaml
# deploy/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'vorion'
    static_configs:
      - targets: ['vorion:9090']

  - job_name: 'traefik'
    static_configs:
      - targets: ['traefik:8080']
```

### Grafana Dashboards

Import the Vorion dashboard from `deploy/grafana/dashboards/vorion.json` for:
- Intent processing metrics
- Queue depth and latency
- Error rates and types
- Database connection pool
- Redis operations

## Graceful Shutdown

The enterprise deployment configures graceful shutdown:

```yaml
vorion:
  stop_grace_period: 45s  # Wait for drain
  stop_signal: SIGTERM    # Graceful signal
```

Shutdown sequence:
1. SIGTERM received
2. Health check starts returning unhealthy
3. Stop accepting new connections (30s drain)
4. Wait for in-flight requests to complete
5. Drain job queue workers
6. Close database connections
7. Exit

Configure shutdown timeout:
```bash
VORION_SHUTDOWN_TIMEOUT_MS=30000  # 30 seconds
```

## Rolling Updates

### Zero-Downtime Deployment

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1        # Add 1 new pod before removing old
    maxUnavailable: 0  # Never reduce below desired count
```

Update sequence:
1. New pod starts
2. Readiness probe passes
3. Traffic routed to new pod
4. Old pod receives SIGTERM
5. Old pod drains and exits
6. Repeat for remaining pods

### Rollback

```bash
# Kubernetes
kubectl rollout undo deployment/vorion -n vorion

# Docker Compose
docker compose -f docker-compose.enterprise.yml down
docker compose -f docker-compose.enterprise.yml up -d --scale vorion=3
```

## Disaster Recovery

### Backup Strategy

| Component | Backup Frequency | Retention | Recovery Time |
|-----------|------------------|-----------|---------------|
| PostgreSQL | Hourly snapshots | 30 days | 15 minutes |
| Redis | AOF + hourly RDB | 7 days | 5 minutes |
| Secrets | On change | Indefinite | Immediate |
| Config | Git versioned | Indefinite | Immediate |

### Recovery Procedures

1. **Database failure**: Failover to replica or restore from snapshot
2. **Redis failure**: Sentinel promotes replica or restore from AOF
3. **Complete cluster failure**: Restore from backups in order:
   - Secrets and configuration
   - Database
   - Redis cache (can be rebuilt)
   - Application pods

### RTO/RPO Targets

| Failure Type | RTO | RPO |
|--------------|-----|-----|
| Single pod | 30s | 0 |
| Database primary | 5m | 0 (sync replication) |
| Redis primary | 30s | 0 (Sentinel) |
| Availability zone | 5m | 0 |
| Region failure | 1h | 5m |
