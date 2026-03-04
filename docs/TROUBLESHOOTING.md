# Vorion Troubleshooting Guide

This guide covers common issues and their solutions when running Vorion.

## Table of Contents

- [Database Issues](#database-issues)
- [Redis Issues](#redis-issues)
- [Authentication Issues](#authentication-issues)
- [Intent Processing Issues](#intent-processing-issues)
- [Performance Issues](#performance-issues)
- [Configuration Issues](#configuration-issues)
- [Deployment Issues](#deployment-issues)
- [Debugging Tips](#debugging-tips)

---

## Database Issues

### Cannot connect to database

**Symptoms:**
```
Error: connect ECONNREFUSED 127.0.0.1:5432
Error: FATAL: password authentication failed for user "vorion"
Error: FATAL: database "vorion" does not exist
```

**Solutions:**

1. **Check PostgreSQL is running:**
   ```bash
   # macOS
   brew services list | grep postgresql

   # Linux (systemd)
   systemctl status postgresql

   # Docker
   docker ps | grep postgres
   ```

2. **Verify connection settings:**
   ```bash
   # Test connection manually
   psql -h $VORION_DB_HOST -p $VORION_DB_PORT -U $VORION_DB_USER -d $VORION_DB_NAME
   ```

3. **Check environment variables:**
   ```bash
   echo "Host: $VORION_DB_HOST"
   echo "Port: $VORION_DB_PORT"
   echo "User: $VORION_DB_USER"
   echo "Database: $VORION_DB_NAME"
   ```

4. **Create database if missing:**
   ```sql
   CREATE DATABASE vorion;
   CREATE USER vorion WITH ENCRYPTED PASSWORD 'your-password';
   GRANT ALL PRIVILEGES ON DATABASE vorion TO vorion;
   ```

---

### Database connection pool exhausted

**Symptoms:**
```
Error: timeout exceeded when trying to connect
Error: too many clients already
```

**Solutions:**

1. **Increase pool size:**
   ```bash
   VORION_DB_POOL_MAX=100
   ```

2. **Check for connection leaks:**
   ```sql
   -- List active connections
   SELECT * FROM pg_stat_activity WHERE datname = 'vorion';

   -- Kill idle connections older than 10 minutes
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE datname = 'vorion'
     AND state = 'idle'
     AND state_change < NOW() - INTERVAL '10 minutes';
   ```

3. **Reduce idle timeout:**
   ```bash
   VORION_DB_POOL_IDLE_TIMEOUT=5000
   ```

---

### Database query timeout

**Symptoms:**
```
Error: canceling statement due to statement timeout
Error: Query read timeout
```

**Solutions:**

1. **Increase statement timeout:**
   ```bash
   VORION_DB_STATEMENT_TIMEOUT_MS=60000
   ```

2. **For long-running operations (exports, reports):**
   ```bash
   VORION_DB_LONG_QUERY_TIMEOUT_MS=300000
   ```

3. **Check for slow queries:**
   ```sql
   SELECT pid, now() - pg_stat_activity.query_start AS duration, query
   FROM pg_stat_activity
   WHERE (now() - pg_stat_activity.query_start) > interval '5 seconds'
     AND state != 'idle';
   ```

---

## Redis Issues

### Cannot connect to Redis

**Symptoms:**
```
Error: connect ECONNREFUSED 127.0.0.1:6379
Error: NOAUTH Authentication required
Error: Redis connection to localhost:6379 failed
```

**Solutions:**

1. **Check Redis is running:**
   ```bash
   # macOS
   brew services list | grep redis

   # Linux (systemd)
   systemctl status redis

   # Docker
   docker ps | grep redis
   ```

2. **Test connection:**
   ```bash
   redis-cli -h $VORION_REDIS_HOST -p $VORION_REDIS_PORT ping
   # Should return: PONG
   ```

3. **If password is required:**
   ```bash
   redis-cli -h $VORION_REDIS_HOST -p $VORION_REDIS_PORT -a $VORION_REDIS_PASSWORD ping
   ```

4. **Use lite mode for development (no Redis required):**
   ```bash
   VORION_LITE_ENABLED=true
   VORION_LITE_REDIS_OPTIONAL=true
   ```

---

### Lock acquisition timeout

**Symptoms:**
```
Error: Lock acquisition timeout for key: intent:dedupe:...
Error: Could not acquire lock within timeout
```

**Solutions:**

1. **Check Redis connectivity (see above)**

2. **Increase lock timeout:**
   ```bash
   VORION_INTENT_DEDUPE_TTL=1200  # 20 minutes
   ```

3. **Clear stale locks (use with caution):**
   ```bash
   redis-cli KEYS "vorion:lock:*" | xargs redis-cli DEL
   ```

4. **Check circuit breaker status:**
   ```bash
   # Adjust Redis circuit breaker
   VORION_CB_REDIS_FAILURE_THRESHOLD=15
   VORION_CB_REDIS_RESET_TIMEOUT_MS=5000
   ```

---

### Redis memory exhausted

**Symptoms:**
```
Error: OOM command not allowed when used memory > 'maxmemory'
```

**Solutions:**

1. **Check Redis memory usage:**
   ```bash
   redis-cli INFO memory
   ```

2. **Increase Redis maxmemory:**
   ```bash
   # In redis.conf or via CLI
   redis-cli CONFIG SET maxmemory 2gb
   ```

3. **Enable eviction policy:**
   ```bash
   redis-cli CONFIG SET maxmemory-policy allkeys-lru
   ```

---

## Authentication Issues

### JWT verification failed

**Symptoms:**
```
Error: JWT verification failed
Error: invalid signature
Error: jwt expired
```

**Solutions:**

1. **Ensure JWT secret is consistent:**
   - The same `VORION_JWT_SECRET` must be used across all instances
   - Check that the secret hasn't changed between token issuance and verification

2. **Check token expiration:**
   ```bash
   VORION_JWT_EXPIRATION=1h  # Increase if needed
   ```

3. **Verify secret meets requirements (production):**
   ```bash
   # Secret must be at least 32 characters with sufficient entropy
   # Generate a proper secret:
   openssl rand -base64 64
   ```

4. **Debug token issues:**
   ```bash
   # Decode JWT (without verification) to inspect claims
   # Use https://jwt.io or:
   echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq .
   ```

---

### CSRF token invalid

**Symptoms:**
```
Error: CSRF token validation failed
Error: Missing CSRF token
```

**Solutions:**

1. **Ensure CSRF token is sent in header:**
   ```javascript
   fetch('/api/v1/intents', {
     method: 'POST',
     headers: {
       'X-CSRF-Token': csrfToken,  // From cookie __vorion_csrf
       'Content-Type': 'application/json'
     },
     body: JSON.stringify(data)
   });
   ```

2. **Check excluded paths:**
   ```bash
   # If your endpoint should be excluded:
   VORION_CSRF_EXCLUDE_PATHS=/api/webhooks/*,/api/health,/your/path
   ```

3. **Disable CSRF for development (not recommended for production):**
   ```bash
   VORION_CSRF_ENABLED=false
   ```

---

### Unauthorized - Token required

**Symptoms:**
```
Error: Unauthorized - No token provided
Error: Authorization header missing
```

**Solutions:**

1. **Include Authorization header:**
   ```javascript
   fetch('/api/v1/intents', {
     headers: {
       'Authorization': `Bearer ${accessToken}`
     }
   });
   ```

2. **Check token is not expired:**
   ```bash
   VORION_JWT_EXPIRATION=1h
   VORION_REFRESH_TOKEN_EXPIRATION=7d
   ```

---

## Intent Processing Issues

### Trust level insufficient

**Symptoms:**
```
Error: Trust level insufficient for intent type
Error: TrustInsufficientError: Entity trust level 1 below required 2
```

**Solutions:**

1. **Check entity trust level:**
   - Entities start at trust level 0 (Untrusted)
   - Trust must be earned through successful operations

2. **Configure trust gates per intent type:**
   ```bash
   # JSON mapping of intent types to minimum trust levels
   VORION_INTENT_TRUST_GATES='{"high_risk_action":3,"standard_action":1}'
   ```

3. **Lower default minimum trust level (development only):**
   ```bash
   VORION_INTENT_DEFAULT_MIN_TRUST_LEVEL=0
   ```

4. **For testing, bypass trust gate (requires admin role):**
   ```javascript
   // This requires userRoles: ['admin'] or ['system']
   await intentService.submit(payload, {
     ...options,
     bypassTrustGate: true,
     userRoles: ['admin']
   });
   ```

---

### Consent required

**Symptoms:**
```
Error: ConsentRequiredError: Consent required for data_processing
Error: Intent submission rejected: data processing consent not granted
```

**Solutions:**

1. **Ensure user has granted consent:**
   ```javascript
   // Record user consent before submitting intents
   await consentService.grantConsent({
     userId: 'user-123',
     tenantId: 'tenant-456',
     consentType: 'data_processing',
     version: '1.0'
   });
   ```

2. **Include userId in submit options:**
   ```javascript
   await intentService.submit(payload, {
     tenantId,
     userId: 'user-123'  // Required for consent validation
   });
   ```

---

### Rate limit exceeded

**Symptoms:**
```
Error: Rate limit exceeded
Error: Too many requests
HTTP 429 Too Many Requests
```

**Solutions:**

1. **Wait and retry with exponential backoff:**
   ```javascript
   async function submitWithRetry(payload, options, maxRetries = 3) {
     for (let i = 0; i < maxRetries; i++) {
       try {
         return await intentService.submit(payload, options);
       } catch (error) {
         if (error.statusCode === 429 && i < maxRetries - 1) {
           await sleep(Math.pow(2, i) * 1000);  // Exponential backoff
           continue;
         }
         throw error;
       }
     }
   }
   ```

2. **Increase rate limits:**
   ```bash
   VORION_RATELIMIT_DEFAULT_LIMIT=200
   VORION_API_RATE_LIMIT=2000
   ```

3. **Use bulk operations for batch processing:**
   ```javascript
   // Instead of submitting one at a time:
   const result = await intentService.submitBulk({
     intents: [intent1, intent2, intent3],
     options: { stopOnError: false, returnPartial: true }
   }, tenantId);
   ```

---

### Duplicate intent detected

**Symptoms:**
```
Info: Returning existing intent (dedupe)
```

**This is expected behavior.** Vorion deduplicates identical intents within a time window.

**If you need to submit again:**

1. **Change the idempotency key:**
   ```javascript
   const intent = {
     ...payload,
     idempotencyKey: `${action}-${entityId}-${Date.now()}`
   };
   ```

2. **Wait for dedupe TTL to expire:**
   ```bash
   VORION_INTENT_DEDUPE_TTL=600  # 10 minutes default
   ```

---

## Performance Issues

### Slow intent processing

**Symptoms:**
- Intents take longer than expected to process
- Queue backlog growing

**Solutions:**

1. **Increase queue concurrency:**
   ```bash
   VORION_INTENT_QUEUE_CONCURRENCY=10
   ```

2. **Check circuit breaker states:**
   - Circuit breakers may be open due to downstream failures
   - Check metrics/logs for circuit breaker events

3. **Scale horizontally:**
   - Deploy additional Vorion instances
   - Ensure Redis is accessible by all instances

4. **Check database performance:**
   ```sql
   -- Find slow queries
   SELECT query, mean_time, calls
   FROM pg_stat_statements
   ORDER BY mean_time DESC
   LIMIT 10;
   ```

---

### High memory usage

**Symptoms:**
- OOM errors
- Process killed by OS

**Solutions:**

1. **Limit concurrent executions:**
   ```bash
   VORION_COGNIGATE_MAX_CONCURRENT=50
   VORION_COGNIGATE_MAX_MEMORY_MB=256
   ```

2. **Reduce connection pool sizes:**
   ```bash
   VORION_DB_POOL_MAX=20
   ```

3. **Enable telemetry to identify memory leaks:**
   ```bash
   VORION_TELEMETRY_ENABLED=true
   ```

---

## Configuration Issues

### Configuration validation errors

**Symptoms:**
```
Error: VORION_JWT_SECRET must be set to a secure value in production/staging
Error: VORION_ENCRYPTION_KEY must be set when encryption is enabled
Error: Database poolMin cannot exceed poolMax
```

**Solutions:**

1. **Set required production variables:**
   ```bash
   # Generate secrets:
   openssl rand -base64 64  # For JWT_SECRET
   openssl rand -base64 32  # For ENCRYPTION_KEY, DEDUPE_SECRET
   openssl rand -base64 16  # For ENCRYPTION_SALT
   ```

2. **Check your environment:**
   ```bash
   echo $VORION_ENV  # Should be: development, staging, or production
   ```

3. **Use development mode for local testing:**
   ```bash
   VORION_ENV=development
   ```

---

### Encryption key errors

**Symptoms:**
```
Error: VORION_ENCRYPTION_KEY must be set when encryption is enabled
Error: VORION_ENCRYPTION_SALT must be set when using PBKDF2
```

**Solutions:**

1. **Generate and set encryption keys:**
   ```bash
   VORION_ENCRYPTION_KEY=$(openssl rand -base64 32)
   VORION_ENCRYPTION_SALT=$(openssl rand -base64 16)
   ```

2. **Or disable encryption (development only):**
   ```bash
   VORION_INTENT_ENCRYPT_CONTEXT=false
   ```

---

## Deployment Issues

### Health check failing

**Symptoms:**
- Kubernetes pods not becoming ready
- Load balancer marking instances as unhealthy

**Solutions:**

1. **Check health endpoint:**
   ```bash
   curl http://localhost:3000/api/v1/health
   curl http://localhost:3000/api/v1/ready
   ```

2. **Increase health check timeouts:**
   ```bash
   VORION_HEALTH_CHECK_TIMEOUT_MS=10000
   VORION_READY_CHECK_TIMEOUT_MS=20000
   ```

3. **Check dependencies are accessible:**
   - Database connectivity
   - Redis connectivity (unless using lite mode)

---

### Graceful shutdown timeout

**Symptoms:**
```
Warning: Graceful shutdown timeout exceeded
Error: SIGKILL received during shutdown
```

**Solutions:**

1. **Increase shutdown timeout:**
   ```bash
   VORION_SHUTDOWN_TIMEOUT_MS=60000
   ```

2. **Ensure Kubernetes terminationGracePeriodSeconds matches:**
   ```yaml
   spec:
     terminationGracePeriodSeconds: 60
   ```

---

## Debugging Tips

### Enable debug logging

```bash
VORION_LOG_LEVEL=debug
```

### Check circuit breaker states

Look for these log messages:
```
Circuit breaker [database] opened after 5 failures
Circuit breaker [redis] in half-open state
Circuit breaker [webhook] closed - service recovered
```

### View metrics

```bash
curl http://localhost:3000/api/v1/metrics
```

Key metrics to watch:
- `vorion_intent_submissions_total` - Intent submission rate
- `vorion_intent_status_transitions_total` - State machine transitions
- `vorion_db_pool_connections` - Database pool usage
- `vorion_circuit_breaker_state` - Circuit breaker states

### Trace requests

Enable telemetry for distributed tracing:
```bash
VORION_TELEMETRY_ENABLED=true
VORION_OTLP_ENDPOINT=http://jaeger:4318/v1/traces
```

### Common log patterns to search for

```bash
# Errors
grep -i "error" vorion.log

# Security events
grep "SECURITY" vorion.log

# Deprecation warnings
grep "DEPRECATION" vorion.log

# Audit events
grep "AUDIT" vorion.log

# Circuit breaker events
grep "circuit" vorion.log
```

---

## Getting Help

If you're still stuck:

1. **Check the documentation:**
   - [CONFIG_REFERENCE.md](./CONFIG_REFERENCE.md) - All configuration options
   - [DEVELOPER_QUICK_START.md](./VORION_V1_FULL_APPROVAL_PDFS/DEVELOPER_QUICK_START.md) - Getting started guide

2. **Search existing issues:**
   - [GitHub Issues](https://github.com/vorion/vorion/issues)

3. **Contact support:**
   - Email: support@vorion.io
   - Community: community.vorion.io

When reporting issues, please include:
- Vorion version
- Node.js version
- Error messages (with stack traces)
- Relevant configuration (redact secrets)
- Steps to reproduce
