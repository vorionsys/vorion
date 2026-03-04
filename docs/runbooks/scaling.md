# Scaling Runbook

This runbook covers horizontal and vertical scaling strategies for Vorion deployments, including database scaling, Redis clustering, and load balancer configuration.

## Table of Contents

- [Scaling Overview](#scaling-overview)
- [Horizontal Scaling](#horizontal-scaling)
- [Vertical Scaling](#vertical-scaling)
- [Database Scaling](#database-scaling)
- [Redis Scaling](#redis-scaling)
- [Load Balancer Configuration](#load-balancer-configuration)
- [Queue Worker Scaling](#queue-worker-scaling)
- [Capacity Planning](#capacity-planning)

---

## Scaling Overview

### Vorion Architecture for Scaling

```
                    ┌─────────────────┐
                    │  Load Balancer  │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
    ┌────▼────┐        ┌────▼────┐        ┌────▼────┐
    │ Vorion  │        │ Vorion  │        │ Vorion  │
    │ Pod 1   │        │ Pod 2   │        │ Pod N   │
    └────┬────┘        └────┬────┘        └────┬────┘
         │                   │                   │
    ┌────┴───────────────────┴───────────────────┴────┐
    │                                                  │
    ▼                                                  ▼
┌────────────┐                                  ┌────────────┐
│ PostgreSQL │◄──────────────────────────────►  │   Redis    │
│  Primary   │                                  │  Cluster   │
└────────────┘                                  └────────────┘
```

### Scaling Decision Matrix

| Symptom | Recommended Action |
|---------|-------------------|
| High CPU usage (> 80%) | Horizontal scale (more pods) |
| High memory usage (> 80%) | Vertical scale (more memory) or fix leak |
| Slow database queries | Database read replicas or optimization |
| High queue depth | Scale queue workers |
| Redis latency | Redis clustering or vertical scale |
| Rate limiting kicks in | Review limits or horizontal scale |

---

## Horizontal Scaling

### Manual Scaling

```bash
# Scale Vorion deployment
kubectl scale deployment/vorion --replicas=5

# Verify scaling
kubectl get pods -l app=vorion
kubectl rollout status deployment/vorion
```

### Horizontal Pod Autoscaler (HPA)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: vorion-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: vorion
  minReplicas: 3
  maxReplicas: 20
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
  - type: Pods
    pods:
      metric:
        name: vorion_queue_depth
      target:
        type: AverageValue
        averageValue: 1000
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 10
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100
        periodSeconds: 60
      - type: Pods
        value: 4
        periodSeconds: 60
```

Apply HPA:
```bash
kubectl apply -f kubernetes/vorion-hpa.yaml
kubectl get hpa vorion-hpa
```

### Pod Disruption Budget

Ensure availability during scaling operations:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: vorion-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: vorion
```

### Anti-Affinity Rules

Spread pods across nodes for high availability:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vorion
spec:
  template:
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - vorion
              topologyKey: kubernetes.io/hostname
          requiredDuringSchedulingIgnoredDuringExecution:
          - labelSelector:
              matchExpressions:
              - key: app
                operator: In
                values:
                - vorion
            topologyKey: topology.kubernetes.io/zone
```

---

## Vertical Scaling

### Resource Requests and Limits

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vorion
spec:
  template:
    spec:
      containers:
      - name: vorion
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
```

### Recommended Resource Profiles

| Profile | Memory Request | Memory Limit | CPU Request | CPU Limit | Use Case |
|---------|---------------|--------------|-------------|-----------|----------|
| Small | 256Mi | 512Mi | 100m | 500m | Development |
| Medium | 512Mi | 1Gi | 250m | 1000m | Staging |
| Large | 1Gi | 2Gi | 500m | 2000m | Production |
| XLarge | 2Gi | 4Gi | 1000m | 4000m | High load |

### Node.js Memory Tuning

```bash
# Increase V8 heap size (in MB)
NODE_OPTIONS="--max-old-space-size=1536"

# Enable garbage collection optimization
NODE_OPTIONS="--max-old-space-size=1536 --optimize-for-size"
```

In Kubernetes:
```yaml
env:
- name: NODE_OPTIONS
  value: "--max-old-space-size=1536"
```

### Vertical Pod Autoscaler (VPA)

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: vorion-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: vorion
  updatePolicy:
    updateMode: "Auto"
  resourcePolicy:
    containerPolicies:
    - containerName: vorion
      minAllowed:
        memory: "256Mi"
        cpu: "100m"
      maxAllowed:
        memory: "4Gi"
        cpu: "4"
```

---

## Database Scaling

### Connection Pool Sizing

Scale connection pool with application instances:

```bash
# Pool settings per instance
VORION_DB_POOL_MIN=10
VORION_DB_POOL_MAX=50

# Calculate total connections needed:
# Total = (poolMax * instanceCount) + overhead
# Example: 50 * 5 instances + 20 = 270 connections

# Set PostgreSQL max_connections accordingly
# postgresql.conf: max_connections = 300
```

### Read Replicas

For read-heavy workloads, configure read replicas:

```bash
# Primary for writes
VORION_DB_HOST=postgres-primary
VORION_DB_PORT=5432

# Read replica for queries (if supported by application)
VORION_DB_READ_HOST=postgres-replica
VORION_DB_READ_PORT=5432
```

### PostgreSQL Horizontal Scaling

#### Using PgBouncer (Connection Pooling)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: pgbouncer
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: pgbouncer
        image: edoburu/pgbouncer:latest
        env:
        - name: DATABASE_URL
          value: "postgres://vorion:password@postgres-primary:5432/vorion"
        - name: POOL_MODE
          value: "transaction"
        - name: MAX_CLIENT_CONN
          value: "1000"
        - name: DEFAULT_POOL_SIZE
          value: "50"
```

Update Vorion to use PgBouncer:
```bash
VORION_DB_HOST=pgbouncer
VORION_DB_PORT=6432
```

#### Using Citus for Sharding

For very large datasets, consider Citus for horizontal sharding:

```sql
-- Convert tables to distributed tables
SELECT create_distributed_table('intents', 'tenant_id');
SELECT create_distributed_table('audit_logs', 'tenant_id');
```

### Database Performance Tuning

```ini
# postgresql.conf optimizations for scaling

# Memory
shared_buffers = 4GB              # 25% of RAM
effective_cache_size = 12GB       # 75% of RAM
work_mem = 256MB
maintenance_work_mem = 1GB

# Parallelism
max_parallel_workers_per_gather = 4
max_parallel_workers = 8

# Write-ahead log
wal_buffers = 64MB
checkpoint_completion_target = 0.9

# Connections
max_connections = 500
```

---

## Redis Scaling

### Redis Clustering

#### Redis Cluster Setup

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis-cluster
spec:
  serviceName: redis-cluster
  replicas: 6  # 3 masters + 3 replicas
  template:
    spec:
      containers:
      - name: redis
        image: redis:7
        command:
        - redis-server
        args:
        - --cluster-enabled yes
        - --cluster-config-file /data/nodes.conf
        - --cluster-node-timeout 5000
        - --appendonly yes
        ports:
        - containerPort: 6379
        - containerPort: 16379  # Cluster bus
```

Initialize cluster:
```bash
redis-cli --cluster create \
  redis-cluster-0.redis-cluster:6379 \
  redis-cluster-1.redis-cluster:6379 \
  redis-cluster-2.redis-cluster:6379 \
  redis-cluster-3.redis-cluster:6379 \
  redis-cluster-4.redis-cluster:6379 \
  redis-cluster-5.redis-cluster:6379 \
  --cluster-replicas 1
```

### Redis Sentinel (High Availability)

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis-sentinel
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: sentinel
        image: redis:7
        command:
        - redis-sentinel
        - /etc/redis/sentinel.conf
        volumeMounts:
        - name: config
          mountPath: /etc/redis
      volumes:
      - name: config
        configMap:
          name: redis-sentinel-config
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: redis-sentinel-config
data:
  sentinel.conf: |
    sentinel monitor mymaster redis-master-0.redis-master 6379 2
    sentinel down-after-milliseconds mymaster 5000
    sentinel failover-timeout mymaster 60000
    sentinel parallel-syncs mymaster 1
```

### Redis Memory Scaling

```bash
# Redis memory configuration
maxmemory 4gb
maxmemory-policy volatile-lru

# Monitor memory usage
redis-cli INFO memory
```

### Redis Configuration for High Load

```conf
# Increase client output buffer
client-output-buffer-limit normal 0 0 0
client-output-buffer-limit pubsub 256mb 128mb 60

# Increase max clients
maxclients 10000

# Disable persistence if not needed (improves performance)
save ""
appendonly no

# Enable TCP keepalive
tcp-keepalive 60
```

---

## Load Balancer Configuration

### Kubernetes Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: vorion
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: "nlb"
    service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled: "true"
spec:
  type: LoadBalancer
  ports:
  - port: 80
    targetPort: 3000
  selector:
    app: vorion
```

### Ingress with Rate Limiting

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: vorion-ingress
  annotations:
    nginx.ingress.kubernetes.io/rate-limit: "1000"
    nginx.ingress.kubernetes.io/rate-limit-window: "1m"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/proxy-connect-timeout: "10"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "30"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "30"
spec:
  rules:
  - host: vorion.example.com
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

### Health Check Configuration

```yaml
# Load balancer health check endpoints
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
```

### Connection Draining

```yaml
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 60
      containers:
      - name: vorion
        lifecycle:
          preStop:
            exec:
              command:
              - /bin/sh
              - -c
              - "sleep 15"  # Allow time for LB to remove pod
```

Configure graceful shutdown timeout in Vorion:
```bash
VORION_SHUTDOWN_TIMEOUT_MS=30000  # 30 seconds
```

---

## Queue Worker Scaling

### Worker Configuration

```bash
# Queue concurrency per worker
VORION_INTENT_QUEUE_CONCURRENCY=5

# Job timeout
VORION_INTENT_JOB_TIMEOUT_MS=30000

# Max retries
VORION_INTENT_MAX_RETRIES=3

# Queue depth threshold for health check
VORION_INTENT_QUEUE_DEPTH_THRESHOLD=10000
```

### Dedicated Worker Pods

For high-throughput scenarios, deploy dedicated worker pods:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vorion-workers
spec:
  replicas: 5
  template:
    spec:
      containers:
      - name: worker
        image: vorion:latest
        command: ["npm", "run", "start:worker"]
        env:
        - name: VORION_INTENT_QUEUE_CONCURRENCY
          value: "10"
        - name: VORION_ROLE
          value: "worker"
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
```

### Worker Autoscaling

Scale workers based on queue depth:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: vorion-workers-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: vorion-workers
  minReplicas: 2
  maxReplicas: 20
  metrics:
  - type: External
    external:
      metric:
        name: vorion_queue_depth
      target:
        type: Value
        value: 5000
```

### Queue Depth Thresholds

| Queue Depth | Worker Count | Action |
|-------------|--------------|--------|
| 0-1,000 | 2 | Normal operation |
| 1,000-5,000 | 5 | Increase workers |
| 5,000-10,000 | 10 | Warning alert |
| > 10,000 | 20 | Critical alert |

---

## Capacity Planning

### Sizing Calculator

| Metric | Formula |
|--------|---------|
| Required Pods | (Peak RPS / 100) * 1.5 |
| Database Connections | Pods * 50 + 50 |
| Redis Memory | (Active Users * 0.1MB) + (Queue Size * 0.01MB) |
| Storage | (Events/day * 365 * 0.001GB) |

### Benchmark Results

Reference numbers (adjust based on your workload):

| Configuration | RPS | Latency (p99) | CPU | Memory |
|---------------|-----|---------------|-----|--------|
| 1 pod, 256Mi | 50 | 100ms | 40% | 180Mi |
| 3 pods, 512Mi | 200 | 80ms | 50% | 350Mi |
| 5 pods, 1Gi | 500 | 60ms | 60% | 700Mi |
| 10 pods, 2Gi | 1000 | 50ms | 70% | 1.4Gi |

### Scaling Playbook

#### For Expected Traffic Increase

```bash
# 1. Scale database connections
psql -c "ALTER SYSTEM SET max_connections = 500"

# 2. Scale Redis memory
redis-cli CONFIG SET maxmemory 8gb

# 3. Pre-scale Vorion pods
kubectl scale deployment/vorion --replicas=10

# 4. Verify health
kubectl get pods -l app=vorion
curl -s http://vorion:3000/health/detailed | jq '.status'
```

#### For Unexpected Traffic Spike

```bash
# 1. Check current state
kubectl get hpa
kubectl top pods -l app=vorion

# 2. If HPA is too slow, manually scale
kubectl scale deployment/vorion --replicas=20

# 3. Enable rate limiting if needed
kubectl set env deployment/vorion \
  VORION_RATELIMIT_DEFAULT_LIMIT=50

# 4. Monitor recovery
watch -n 5 'kubectl get pods -l app=vorion'
```

### Cost Optimization

| Strategy | Impact | Tradeoff |
|----------|--------|----------|
| Spot instances for workers | 60-70% cost reduction | Interruption risk |
| Right-sizing | 20-40% cost reduction | Initial effort |
| Reserved instances | 30-50% cost reduction | Commitment |
| Autoscaling | Variable | Scaling latency |

### Monitoring Scaling Decisions

Key metrics to track:

```promql
# Pod utilization
avg(rate(container_cpu_usage_seconds_total{pod=~"vorion.*"}[5m])) by (pod)

# Queue depth trend
delta(vorion_queue_depth[1h])

# Request latency trend
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{job="vorion"}[5m]))

# Scaling events
count(kube_replicaset_status_replicas{replicaset=~"vorion.*"}) by (replicaset)
```
