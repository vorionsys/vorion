# Troubleshooting Runbook

This runbook covers common issues encountered in Vorion deployments and their resolution steps.

## Table of Contents

- [Database Connection Issues](#database-connection-issues)
- [Redis Connection Issues](#redis-connection-issues)
- [Authentication Failures](#authentication-failures)
- [Rate Limiting Issues](#rate-limiting-issues)
- [Memory and Resource Issues](#memory-and-resource-issues)
- [Queue Processing Issues](#queue-processing-issues)
- [Circuit Breaker Tripped](#circuit-breaker-tripped)

---

## Database Connection Issues

### Symptoms

- Health check returns `unhealthy` with database status `error`
- Logs show `Database health check failed`
- API requests fail with 500 errors
- `/health/detailed` shows database circuit `OPEN`

### Diagnostic Steps

1. **Check health endpoint**
   ```bash
   curl -s http://localhost:3000/health/detailed | jq '.services.database'
   ```

2. **Verify database connectivity from the pod**
   ```bash
   # From within the container
   pg_isready -h $VORION_DB_HOST -p $VORION_DB_PORT -U $VORION_DB_USER
   ```

3. **Check connection pool status**
   ```bash
   curl -s http://localhost:3000/health/detailed | jq '.config.database'
   ```

4. **Review database logs**
   ```bash
   # PostgreSQL logs
   kubectl logs -l app=postgresql --tail=100
   ```

### Common Causes and Solutions

#### Connection Pool Exhaustion

**Symptoms**: `connection pool timeout` errors, slow response times

**Solution**:
```bash
# Increase pool size (default: min=10, max=50)
export VORION_DB_POOL_MIN=20
export VORION_DB_POOL_MAX=100
export VORION_DB_POOL_IDLE_TIMEOUT=10000
export VORION_DB_POOL_CONNECTION_TIMEOUT=10000
```

#### Network Connectivity

**Symptoms**: `ECONNREFUSED` or `ETIMEDOUT` errors

**Solution**:
1. Verify network policies allow traffic to database
2. Check DNS resolution: `nslookup $VORION_DB_HOST`
3. Verify security groups/firewall rules

#### Authentication Failures

**Symptoms**: `password authentication failed`

**Solution**:
1. Verify `VORION_DB_PASSWORD` is correctly set
2. Check PostgreSQL `pg_hba.conf` configuration
3. Ensure database user exists with correct permissions

#### Statement Timeout

**Symptoms**: `canceling statement due to statement timeout`

**Solution**:
```bash
# Increase statement timeout (default: 30000ms)
export VORION_DB_STATEMENT_TIMEOUT_MS=60000

# For long-running queries (reports, exports)
export VORION_DB_LONG_QUERY_TIMEOUT_MS=180000
```

### Recovery Actions

1. **Restart affected pods** to reset connection pools
   ```bash
   kubectl rollout restart deployment/vorion
   ```

2. **Clear circuit breaker** (will auto-reset after timeout)
   - Database circuit resets after `VORION_CB_DATABASE_RESET_TIMEOUT_MS` (default: 30000ms)

3. **Scale down, fix, scale up** for configuration changes
   ```bash
   kubectl scale deployment/vorion --replicas=0
   # Apply configuration changes
   kubectl scale deployment/vorion --replicas=3
   ```

---

## Redis Connection Issues

### Symptoms

- Health check returns `degraded` or `unhealthy`
- `/health/detailed` shows redis status `error`
- Queue processing stops
- Rate limiting fails (all requests either pass or fail)

### Diagnostic Steps

1. **Check health endpoint**
   ```bash
   curl -s http://localhost:3000/health/detailed | jq '.services.redis'
   ```

2. **Test Redis connectivity**
   ```bash
   redis-cli -h $VORION_REDIS_HOST -p $VORION_REDIS_PORT -a $VORION_REDIS_PASSWORD ping
   ```

3. **Check Redis memory usage**
   ```bash
   redis-cli -h $VORION_REDIS_HOST INFO memory
   ```

### Common Causes and Solutions

#### Connection Refused

**Symptoms**: `ECONNREFUSED` errors

**Solution**:
1. Verify Redis is running: `redis-cli ping`
2. Check Redis port is accessible
3. Verify `VORION_REDIS_HOST` and `VORION_REDIS_PORT` are correct

#### Authentication Failed

**Symptoms**: `NOAUTH` or `WRONGPASS` errors

**Solution**:
1. Verify `VORION_REDIS_PASSWORD` is set correctly
2. Check Redis `requirepass` configuration

#### Memory Limit Reached

**Symptoms**: `OOM` errors, `maxmemory` exceeded

**Solution**:
1. Increase Redis `maxmemory` configuration
2. Configure eviction policy: `maxmemory-policy volatile-lru`
3. Clear unnecessary keys: `redis-cli FLUSHDB` (caution: data loss)

#### Lite Mode Alternative

If Redis issues persist and you need to operate without Redis:
```bash
# Enable lite mode (no Redis required)
export VORION_LITE_ENABLED=true
export VORION_LITE_REDIS_OPTIONAL=true
```

**Note**: Lite mode uses in-memory adapters; state is not shared across instances.

### Recovery Actions

1. **Circuit breaker will auto-reset** after `VORION_CB_REDIS_RESET_TIMEOUT_MS` (default: 10000ms)

2. **Restart Redis if needed**
   ```bash
   kubectl rollout restart statefulset/redis
   ```

3. **Failover to replica** (if using Redis Sentinel/Cluster)
   ```bash
   redis-cli -h sentinel-host SENTINEL failover mymaster
   ```

---

## Authentication Failures

### Symptoms

- 401 Unauthorized responses
- `JWT verification failed` errors
- `Token expired` errors
- Session fingerprint mismatches

### Diagnostic Steps

1. **Check JWT token validity**
   ```bash
   # Decode JWT (header and payload only)
   echo "$TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null | jq .
   ```

2. **Verify token expiration**
   ```bash
   # Check 'exp' claim in decoded payload
   ```

3. **Check application logs for auth errors**
   ```bash
   kubectl logs -l app=vorion --tail=100 | grep -i "auth\|jwt\|401"
   ```

### Common Causes and Solutions

#### JWT Secret Mismatch

**Symptoms**: All JWT validations fail after deployment

**Cause**: `VORION_JWT_SECRET` changed between deployments

**Solution**:
1. Ensure consistent secret across all instances
2. Use Kubernetes secrets for JWT secret management
3. If secret must change, implement token refresh flow

#### Token Expiration

**Symptoms**: Tokens fail after `VORION_JWT_EXPIRATION` period

**Solution**:
1. Client should refresh tokens before expiration
2. Adjust expiration if needed:
   ```bash
   export VORION_JWT_EXPIRATION=2h
   export VORION_REFRESH_TOKEN_EXPIRATION=14d
   ```

#### Session Fingerprint Mismatch

**Symptoms**: `403 Forbidden` with fingerprint validation errors

**Cause**: Client characteristics changed (User-Agent, IP, etc.)

**Solution**:
1. Review fingerprint components:
   ```bash
   export VORION_SESSION_FINGERPRINT_COMPONENTS=userAgent,acceptLanguage
   ```

2. Temporarily switch to warn mode for investigation:
   ```bash
   export VORION_SESSION_FINGERPRINT_STRICTNESS=warn
   ```

3. If false positives persist, disable fingerprinting:
   ```bash
   export VORION_SESSION_FINGERPRINT_ENABLED=false
   ```

#### CSRF Token Failures

**Symptoms**: `403 Forbidden` on POST/PUT/DELETE requests

**Solution**:
1. Ensure client sends CSRF token in header:
   ```
   X-CSRF-Token: <token from cookie>
   ```

2. Check excluded paths:
   ```bash
   export VORION_CSRF_EXCLUDE_PATHS="/api/webhooks/*,/api/health"
   ```

---

## Rate Limiting Issues

### Symptoms

- 429 Too Many Requests responses
- Legitimate traffic being blocked
- Rate limit headers show unexpected values

### Diagnostic Steps

1. **Check rate limit headers**
   ```bash
   curl -v http://localhost:3000/api/v1/intent \
     -H "Authorization: Bearer $TOKEN" 2>&1 | grep -i "x-ratelimit"
   ```

2. **Review rate limit configuration**
   ```bash
   # Default limits
   echo "Default: $VORION_RATELIMIT_DEFAULT_LIMIT per $VORION_RATELIMIT_DEFAULT_WINDOW seconds"
   ```

### Common Causes and Solutions

#### Limits Too Restrictive

**Solution**: Adjust rate limits per intent type:
```bash
# Default operations (per minute)
export VORION_RATELIMIT_DEFAULT_LIMIT=200
export VORION_RATELIMIT_DEFAULT_WINDOW=60

# High-risk operations
export VORION_RATELIMIT_HIGH_RISK_LIMIT=20
export VORION_RATELIMIT_HIGH_RISK_WINDOW=60

# Data exports
export VORION_RATELIMIT_DATA_EXPORT_LIMIT=10
export VORION_RATELIMIT_DATA_EXPORT_WINDOW=60

# Admin actions
export VORION_RATELIMIT_ADMIN_ACTION_LIMIT=50
export VORION_RATELIMIT_ADMIN_ACTION_WINDOW=60
```

#### Per-Tenant Limits

**Solution**: Configure tenant-specific limits:
```bash
export VORION_INTENT_TENANT_LIMITS='{"tenant-a":500,"tenant-b":1000}'
```

#### Bulk Operations

**Solution**: Adjust bulk rate limit:
```bash
export VORION_API_BULK_RATE_LIMIT=20  # Default: 10 per minute
```

#### Redis Issues Affecting Rate Limiting

If Redis is down, rate limiting may fail open or closed depending on configuration. See [Redis Connection Issues](#redis-connection-issues).

---

## Memory and Resource Issues

### Symptoms

- OOMKilled pods
- Slow response times
- Health checks showing high memory usage
- Node resource pressure

### Diagnostic Steps

1. **Check process memory**
   ```bash
   curl -s http://localhost:3000/health/detailed | jq '.process.memory'
   ```

2. **Monitor memory over time**
   ```bash
   # Prometheus query
   process_resident_memory_bytes{job="vorion"}
   ```

3. **Check Kubernetes resource usage**
   ```bash
   kubectl top pods -l app=vorion
   ```

### Common Causes and Solutions

#### Memory Leak

**Symptoms**: Memory grows continuously over time

**Solution**:
1. Check for unprocessed queue jobs building up
2. Review heap dump if available
3. Restart pods as temporary mitigation
4. Enable heap profiling for investigation

#### Large Request Payloads

**Symptoms**: Memory spikes during specific operations

**Solution**:
1. Configure request size limits at load balancer
2. Implement pagination for large responses
3. Stream large data exports

#### Resource Limits Too Low

**Symptoms**: OOMKilled even under normal load

**Solution**:
```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "250m"
  limits:
    memory: "1Gi"
    cpu: "1000m"
```

#### High Heap Usage

**Symptoms**: `heapUsed` consistently above 80% of `heapTotal`

**Solution**:
1. Increase Node.js heap size:
   ```bash
   export NODE_OPTIONS="--max-old-space-size=2048"
   ```

2. Review memory-intensive operations (encryption, large policy sets)

### Monitoring Memory

Key metrics from `/health/detailed`:
```json
{
  "process": {
    "memory": {
      "rss": 256,        // Total memory allocated (MB)
      "heapTotal": 128,  // V8 heap total (MB)
      "heapUsed": 96,    // V8 heap used (MB)
      "external": 16,    // Memory used by C++ objects (MB)
      "arrayBuffers": 8  // Memory for ArrayBuffers (MB)
    }
  }
}
```

---

## Queue Processing Issues

### Symptoms

- Intents stuck in `pending` state
- Queue depth growing continuously
- Health check shows queue unhealthy
- Worker process errors in logs

### Diagnostic Steps

1. **Check queue health**
   ```bash
   curl -s http://localhost:3000/health/detailed | jq '.services.queues'
   ```

2. **Review queue metrics**
   ```bash
   curl -s http://localhost:3000/health/ready | jq '.checks.queue'
   ```

3. **Check worker status**
   ```bash
   kubectl logs -l app=vorion --tail=100 | grep -i "worker\|queue\|job"
   ```

### Common Causes and Solutions

#### Workers Not Running

**Symptoms**: `workersRunning: false` in health check

**Solution**:
1. Verify Redis connectivity (queues depend on Redis)
2. Check worker initialization in logs
3. Restart pods if workers failed to start

#### Queue Depth Exceeded

**Symptoms**: `queueDepth` exceeds `maxQueueDepth` threshold

**Solution**:
1. Increase threshold if appropriate:
   ```bash
   export VORION_INTENT_QUEUE_DEPTH_THRESHOLD=20000  # Default: 10000
   ```

2. Scale up workers:
   ```bash
   export VORION_INTENT_QUEUE_CONCURRENCY=10  # Default: 5
   ```

3. Investigate why jobs are accumulating

#### Job Timeouts

**Symptoms**: Jobs failing with timeout errors

**Solution**:
```bash
# Increase job timeout (default: 30000ms)
export VORION_INTENT_JOB_TIMEOUT_MS=60000
```

#### Dead Letter Queue Growing

**Symptoms**: `deadLetterCount` increasing

**Solution**:
1. Review failed job logs
2. Check dead letter queue:
   ```bash
   redis-cli LRANGE bull:intent-submission:dead 0 10
   ```
3. Reprocess failed jobs if appropriate
4. Investigate root cause of failures

---

## Circuit Breaker Tripped

### Symptoms

- Requests failing immediately without attempting backend
- Health status `degraded`
- Circuit state showing `OPEN`

### Diagnostic Steps

1. **Check circuit breaker states**
   ```bash
   curl -s http://localhost:3000/health/detailed | jq '.circuitBreakers'
   ```

2. **Identify affected service**
   ```bash
   curl -s http://localhost:3000/health | jq '.affectedServices'
   ```

### Circuit Breaker Configuration

Each service has configurable circuit breaker settings:

| Service | Failure Threshold | Reset Timeout | Half-Open Attempts |
|---------|-------------------|---------------|-------------------|
| Database | 5 | 30s | 3 |
| Redis | 10 | 10s | 5 |
| Webhook | 3 | 60s | 2 |
| Policy Engine | 5 | 15s | 3 |
| Trust Engine | 5 | 15s | 3 |

### Common Causes and Solutions

#### Database Circuit Open

**Solution**:
1. Check database connectivity (see [Database Connection Issues](#database-connection-issues))
2. Wait for auto-reset or fix underlying issue
3. Adjust thresholds if false positives:
   ```bash
   export VORION_CB_DATABASE_FAILURE_THRESHOLD=10
   export VORION_CB_DATABASE_RESET_TIMEOUT_MS=60000
   ```

#### Redis Circuit Open

**Solution**:
1. Check Redis connectivity (see [Redis Connection Issues](#redis-connection-issues))
2. Consider lite mode if Redis is non-critical
3. Adjust thresholds:
   ```bash
   export VORION_CB_REDIS_FAILURE_THRESHOLD=15
   export VORION_CB_REDIS_RESET_TIMEOUT_MS=20000
   ```

#### Webhook Circuit Open

**Solution**:
1. Check webhook endpoint availability
2. Review webhook delivery logs
3. Adjust per-endpoint circuit:
   ```bash
   export VORION_CB_WEBHOOK_FAILURE_THRESHOLD=5
   export VORION_CB_WEBHOOK_RESET_TIMEOUT_MS=120000
   ```

### Circuit Recovery

1. **Automatic recovery**: Circuit enters `HALF_OPEN` state after reset timeout
2. **In `HALF_OPEN`**: Limited requests are allowed to test recovery
3. **Success**: Circuit closes after `halfOpenMaxAttempts` successful requests
4. **Failure**: Circuit reopens on any failure during half-open phase

### Forcing Circuit Reset

**Warning**: Only use in emergencies when you've confirmed the backend is healthy.

Restart the pod to reset circuit breaker state:
```bash
kubectl delete pod <pod-name>
```

---

## Escalation Path

If issues persist after following this runbook:

1. **Collect diagnostic information**
   - Full `/health/detailed` output
   - Recent logs (last 30 minutes)
   - Timeline of issue

2. **Check for known issues**
   - Review recent deployments
   - Check upstream service status

3. **Escalate to platform team**
   - Include diagnostic information
   - Describe actions already taken
   - Note business impact
