# Vorion Configuration Reference

This document provides a comprehensive reference for all environment variables used to configure Vorion.

## Table of Contents

- [Environment](#environment)
- [API Configuration](#api-configuration)
- [CORS Configuration](#cors-configuration)
- [Health Check Configuration](#health-check-configuration)
- [Database Configuration](#database-configuration)
- [Redis Configuration](#redis-configuration)
- [JWT Authentication](#jwt-authentication)
- [Proof System](#proof-system)
- [Trust Engine](#trust-engine)
- [BASIS Rule Engine](#basis-rule-engine)
- [Cognigate Execution](#cognigate-execution)
- [Intent Processing](#intent-processing)
- [Circuit Breakers](#circuit-breakers)
- [Webhooks](#webhooks)
- [GDPR Compliance](#gdpr-compliance)
- [Audit Configuration](#audit-configuration)
- [Encryption](#encryption)
- [CSRF Protection](#csrf-protection)
- [Session Management](#session-management)
- [Lite Mode](#lite-mode)
- [Telemetry](#telemetry)

---

## Environment

### VORION_ENV
- **Required:** No
- **Default:** `development`
- **Values:** `development`, `staging`, `production`
- **Description:** Application environment. Controls security validations and defaults.

```bash
VORION_ENV=production
```

### VORION_LOG_LEVEL
- **Required:** No
- **Default:** `info`
- **Values:** `debug`, `info`, `warn`, `error`
- **Description:** Logging verbosity level.

```bash
VORION_LOG_LEVEL=debug
```

---

## API Configuration

### VORION_API_PORT
- **Required:** No
- **Default:** `3000`
- **Description:** Port for the HTTP API server.

```bash
VORION_API_PORT=8080
```

### VORION_API_HOST
- **Required:** No
- **Default:** `localhost`
- **Description:** Host/IP address to bind the API server.

```bash
VORION_API_HOST=0.0.0.0
```

### VORION_API_BASE_PATH
- **Required:** No
- **Default:** `/api/v1`
- **Description:** Base path prefix for all API routes.

```bash
VORION_API_BASE_PATH=/api/v1
```

### VORION_API_TIMEOUT
- **Required:** No
- **Default:** `30000` (30 seconds)
- **Description:** Request timeout in milliseconds.

```bash
VORION_API_TIMEOUT=60000
```

### VORION_API_RATE_LIMIT
- **Required:** No
- **Default:** `1000`
- **Description:** Maximum requests per minute per client.

```bash
VORION_API_RATE_LIMIT=500
```

### VORION_API_BULK_RATE_LIMIT
- **Required:** No
- **Default:** `10`
- **Description:** Maximum bulk operation requests per minute.

```bash
VORION_API_BULK_RATE_LIMIT=5
```

---

## CORS Configuration

### VORION_CORS_ALLOWED_ORIGINS
- **Required:** No
- **Default:** `http://localhost:3000,http://localhost:5173`
- **Description:** Comma-separated list of allowed CORS origins (used in non-production environments).

```bash
VORION_CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
```

---

## Health Check Configuration

### VORION_HEALTH_CHECK_TIMEOUT_MS
- **Required:** No
- **Default:** `5000` (5 seconds)
- **Description:** Timeout for individual health checks (database, Redis).

```bash
VORION_HEALTH_CHECK_TIMEOUT_MS=3000
```

### VORION_READY_CHECK_TIMEOUT_MS
- **Required:** No
- **Default:** `10000` (10 seconds)
- **Description:** Overall timeout for the /ready endpoint.

```bash
VORION_READY_CHECK_TIMEOUT_MS=15000
```

### VORION_LIVENESS_CHECK_TIMEOUT_MS
- **Required:** No
- **Default:** `1000` (1 second)
- **Description:** Timeout for liveness checks.

```bash
VORION_LIVENESS_CHECK_TIMEOUT_MS=2000
```

---

## Database Configuration

### VORION_DB_HOST
- **Required:** Yes (in production)
- **Default:** `localhost`
- **Description:** PostgreSQL server hostname.

```bash
VORION_DB_HOST=postgres.example.com
```

### VORION_DB_PORT
- **Required:** No
- **Default:** `5432`
- **Description:** PostgreSQL server port.

```bash
VORION_DB_PORT=5432
```

### VORION_DB_NAME
- **Required:** No
- **Default:** `vorion`
- **Description:** PostgreSQL database name.

```bash
VORION_DB_NAME=vorion_prod
```

### VORION_DB_USER
- **Required:** Yes (in production)
- **Default:** `vorion`
- **Description:** PostgreSQL username.

```bash
VORION_DB_USER=vorion_app
```

### VORION_DB_PASSWORD
- **Required:** Yes (in production)
- **Default:** (empty)
- **Description:** PostgreSQL password.

```bash
VORION_DB_PASSWORD=your-secure-password
```

### VORION_DB_POOL_MIN
- **Required:** No
- **Default:** `10`
- **Description:** Minimum number of connections in the pool.

```bash
VORION_DB_POOL_MIN=5
```

### VORION_DB_POOL_MAX
- **Required:** No
- **Default:** `50`
- **Description:** Maximum number of connections in the pool.

```bash
VORION_DB_POOL_MAX=100
```

### VORION_DB_POOL_IDLE_TIMEOUT
- **Required:** No
- **Default:** `10000` (10 seconds)
- **Description:** Time in ms before idle connections are closed.

```bash
VORION_DB_POOL_IDLE_TIMEOUT=30000
```

### VORION_DB_POOL_CONNECTION_TIMEOUT
- **Required:** No
- **Default:** `5000` (5 seconds)
- **Description:** Timeout for acquiring a connection from the pool.

```bash
VORION_DB_POOL_CONNECTION_TIMEOUT=10000
```

### VORION_DB_METRICS_INTERVAL_MS
- **Required:** No
- **Default:** `5000` (5 seconds)
- **Description:** Interval for collecting database pool metrics.

```bash
VORION_DB_METRICS_INTERVAL_MS=10000
```

### VORION_DB_STATEMENT_TIMEOUT_MS
- **Required:** No
- **Default:** `30000` (30 seconds)
- **Range:** 1000-600000
- **Description:** Default statement timeout for database queries.

```bash
VORION_DB_STATEMENT_TIMEOUT_MS=60000
```

### VORION_DB_LONG_QUERY_TIMEOUT_MS
- **Required:** No
- **Default:** `120000` (2 minutes)
- **Range:** 1000-600000
- **Description:** Extended timeout for long-running queries (reports, exports).

```bash
VORION_DB_LONG_QUERY_TIMEOUT_MS=300000
```

---

## Redis Configuration

### VORION_REDIS_HOST
- **Required:** Yes (unless using lite mode)
- **Default:** `localhost`
- **Description:** Redis server hostname.

```bash
VORION_REDIS_HOST=redis.example.com
```

### VORION_REDIS_PORT
- **Required:** No
- **Default:** `6379`
- **Description:** Redis server port.

```bash
VORION_REDIS_PORT=6379
```

### VORION_REDIS_PASSWORD
- **Required:** No (recommended in production)
- **Default:** (none)
- **Description:** Redis authentication password.

```bash
VORION_REDIS_PASSWORD=your-redis-password
```

### VORION_REDIS_DB
- **Required:** No
- **Default:** `0`
- **Description:** Redis database index (0-15).

```bash
VORION_REDIS_DB=1
```

---

## JWT Authentication

### VORION_JWT_SECRET
- **Required:** Yes (CRITICAL in production/staging)
- **Default:** Development-only fallback
- **Minimum:** 32 characters
- **Description:** Secret key for signing JWT tokens. Must have sufficient entropy.

```bash
# Generate a secure secret:
# openssl rand -base64 64
VORION_JWT_SECRET=your-cryptographically-secure-secret-at-least-32-characters
```

### VORION_JWT_EXPIRATION
- **Required:** No
- **Default:** `1h`
- **Description:** JWT access token expiration (e.g., `1h`, `30m`, `15m`).

```bash
VORION_JWT_EXPIRATION=30m
```

### VORION_REFRESH_TOKEN_EXPIRATION
- **Required:** No
- **Default:** `7d`
- **Description:** Refresh token expiration (e.g., `7d`, `30d`).

```bash
VORION_REFRESH_TOKEN_EXPIRATION=14d
```

### VORION_JWT_REQUIRE_JTI
- **Required:** No
- **Default:** `false`
- **Description:** Require JWT ID (jti) claim for token revocation support.

```bash
VORION_JWT_REQUIRE_JTI=true
```

---

## Proof System

### VORION_PROOF_STORAGE
- **Required:** No
- **Default:** `local`
- **Values:** `local`, `s3`, `gcs`
- **Description:** Storage backend for proof chain records.

```bash
VORION_PROOF_STORAGE=s3
```

### VORION_PROOF_LOCAL_PATH
- **Required:** No
- **Default:** `./data/proofs`
- **Description:** Local filesystem path for proof storage.

```bash
VORION_PROOF_LOCAL_PATH=/var/vorion/proofs
```

### VORION_PROOF_RETENTION_DAYS
- **Required:** No
- **Default:** `2555` (7 years)
- **Description:** Number of days to retain proof records.

```bash
VORION_PROOF_RETENTION_DAYS=3650
```

---

## Trust Engine

### VORION_TRUST_CALC_INTERVAL
- **Required:** No
- **Default:** `1000` (1 second)
- **Description:** Trust score calculation interval in milliseconds.

```bash
VORION_TRUST_CALC_INTERVAL=5000
```

### VORION_TRUST_CACHE_TTL
- **Required:** No
- **Default:** `30` (seconds)
- **Description:** Trust score cache time-to-live in seconds.

```bash
VORION_TRUST_CACHE_TTL=60
```

### VORION_TRUST_DECAY_RATE
- **Required:** No
- **Default:** `0.01`
- **Description:** Trust score decay rate per day (0-1).

```bash
VORION_TRUST_DECAY_RATE=0.005
```

---

## BASIS Rule Engine

### VORION_BASIS_EVAL_TIMEOUT
- **Required:** No
- **Default:** `100` (ms)
- **Description:** Maximum time for rule evaluation.

```bash
VORION_BASIS_EVAL_TIMEOUT=200
```

### VORION_BASIS_MAX_RULES
- **Required:** No
- **Default:** `10000`
- **Description:** Maximum rules per namespace.

```bash
VORION_BASIS_MAX_RULES=50000
```

### VORION_BASIS_CACHE_ENABLED
- **Required:** No
- **Default:** `true`
- **Description:** Enable rule evaluation caching.

```bash
VORION_BASIS_CACHE_ENABLED=true
```

---

## Cognigate Execution

### VORION_COGNIGATE_TIMEOUT
- **Required:** No
- **Default:** `300000` (5 minutes)
- **Description:** Maximum execution time for agent actions.

```bash
VORION_COGNIGATE_TIMEOUT=600000
```

### VORION_COGNIGATE_MAX_CONCURRENT
- **Required:** No
- **Default:** `100`
- **Description:** Maximum concurrent executions.

```bash
VORION_COGNIGATE_MAX_CONCURRENT=50
```

### VORION_COGNIGATE_MAX_MEMORY_MB
- **Required:** No
- **Default:** `512`
- **Description:** Maximum memory per execution in MB.

```bash
VORION_COGNIGATE_MAX_MEMORY_MB=1024
```

### VORION_COGNIGATE_MAX_CPU_PERCENT
- **Required:** No
- **Default:** `50`
- **Description:** Maximum CPU percentage per execution.

```bash
VORION_COGNIGATE_MAX_CPU_PERCENT=75
```

---

## Intent Processing

### VORION_INTENT_DEFAULT_NAMESPACE
- **Required:** No
- **Default:** `default`
- **Description:** Default namespace for intent routing.

```bash
VORION_INTENT_DEFAULT_NAMESPACE=production
```

### VORION_INTENT_DEDUPE_TTL
- **Required:** No
- **Default:** `600` (10 minutes)
- **Description:** Deduplication key TTL in seconds.

```bash
VORION_INTENT_DEDUPE_TTL=300
```

### VORION_DEDUPE_SECRET
- **Required:** Yes (in production/staging)
- **Minimum:** 32 characters
- **Description:** HMAC secret for secure deduplication hash computation.

```bash
# Generate with: openssl rand -base64 32
VORION_DEDUPE_SECRET=your-32-character-minimum-secret-key
```

### VORION_DEDUPE_TIMESTAMP_WINDOW_SECONDS
- **Required:** No
- **Default:** `300` (5 minutes)
- **Range:** 60-3600
- **Description:** Timestamp window for deduplication hashes.

```bash
VORION_DEDUPE_TIMESTAMP_WINDOW_SECONDS=600
```

### VORION_INTENT_DEFAULT_MAX_IN_FLIGHT
- **Required:** No
- **Default:** `1000`
- **Description:** Default maximum in-flight intents per tenant.

```bash
VORION_INTENT_DEFAULT_MAX_IN_FLIGHT=500
```

### VORION_INTENT_QUEUE_CONCURRENCY
- **Required:** No
- **Default:** `5`
- **Description:** Number of concurrent queue workers.

```bash
VORION_INTENT_QUEUE_CONCURRENCY=10
```

### VORION_INTENT_JOB_TIMEOUT_MS
- **Required:** No
- **Default:** `30000` (30 seconds)
- **Description:** Timeout for individual queue jobs.

```bash
VORION_INTENT_JOB_TIMEOUT_MS=60000
```

### VORION_INTENT_MAX_RETRIES
- **Required:** No
- **Default:** `3`
- **Description:** Maximum retry attempts for failed jobs.

```bash
VORION_INTENT_MAX_RETRIES=5
```

### VORION_INTENT_RETRY_BACKOFF_MS
- **Required:** No
- **Default:** `1000` (1 second)
- **Description:** Base delay between retries.

```bash
VORION_INTENT_RETRY_BACKOFF_MS=2000
```

### VORION_INTENT_EVENT_RETENTION_DAYS
- **Required:** No
- **Default:** `90`
- **Description:** Days to retain intent events.

```bash
VORION_INTENT_EVENT_RETENTION_DAYS=180
```

### VORION_INTENT_ENCRYPT_CONTEXT
- **Required:** No
- **Default:** `true`
- **Description:** Encrypt intent context at rest.

```bash
VORION_INTENT_ENCRYPT_CONTEXT=true
```

### VORION_INTENT_DEFAULT_MIN_TRUST_LEVEL
- **Required:** No
- **Default:** `0`
- **Range:** 0-4
- **Description:** Default minimum trust level for intents.

```bash
VORION_INTENT_DEFAULT_MIN_TRUST_LEVEL=1
```

### VORION_INTENT_REVALIDATE_TRUST
- **Required:** No
- **Default:** `true`
- **Description:** Re-validate trust at decision stage.

```bash
VORION_INTENT_REVALIDATE_TRUST=true
```

### VORION_INTENT_SOFT_DELETE_RETENTION_DAYS
- **Required:** No
- **Default:** `30`
- **Description:** Days to retain soft-deleted intents.

```bash
VORION_INTENT_SOFT_DELETE_RETENTION_DAYS=60
```

### VORION_INTENT_ESCALATION_TIMEOUT
- **Required:** No
- **Default:** `PT1H` (1 hour, ISO 8601)
- **Description:** Escalation timeout duration.

```bash
VORION_INTENT_ESCALATION_TIMEOUT=PT2H
```

### VORION_INTENT_ESCALATION_RECIPIENT
- **Required:** No
- **Default:** `governance-team`
- **Description:** Default escalation recipient.

```bash
VORION_INTENT_ESCALATION_RECIPIENT=security-team
```

### VORION_INTENT_CLEANUP_CRON
- **Required:** No
- **Default:** `0 2 * * *` (2 AM daily)
- **Description:** Cron schedule for cleanup jobs.

```bash
VORION_INTENT_CLEANUP_CRON=0 3 * * *
```

### VORION_INTENT_TIMEOUT_CHECK_CRON
- **Required:** No
- **Default:** `*/5 * * * *` (every 5 minutes)
- **Description:** Cron schedule for timeout checks.

```bash
VORION_INTENT_TIMEOUT_CHECK_CRON=*/10 * * * *
```

### VORION_SHUTDOWN_TIMEOUT_MS
- **Required:** No
- **Default:** `30000` (30 seconds)
- **Range:** 5000-300000
- **Description:** Maximum time to wait for graceful shutdown.

```bash
VORION_SHUTDOWN_TIMEOUT_MS=60000
```

---

## Rate Limiting

### VORION_RATELIMIT_DEFAULT_LIMIT
- **Required:** No
- **Default:** `100`
- **Description:** Default rate limit (requests per window).

### VORION_RATELIMIT_DEFAULT_WINDOW
- **Required:** No
- **Default:** `60` (seconds)
- **Description:** Default rate limit window.

### VORION_RATELIMIT_HIGH_RISK_LIMIT
- **Required:** No
- **Default:** `10`
- **Description:** Rate limit for high-risk operations.

### VORION_RATELIMIT_HIGH_RISK_WINDOW
- **Required:** No
- **Default:** `60` (seconds)

### VORION_RATELIMIT_DATA_EXPORT_LIMIT
- **Required:** No
- **Default:** `5`
- **Description:** Rate limit for data export operations.

### VORION_RATELIMIT_DATA_EXPORT_WINDOW
- **Required:** No
- **Default:** `60` (seconds)

### VORION_RATELIMIT_ADMIN_ACTION_LIMIT
- **Required:** No
- **Default:** `20`
- **Description:** Rate limit for admin actions.

### VORION_RATELIMIT_ADMIN_ACTION_WINDOW
- **Required:** No
- **Default:** `60` (seconds)

---

## Circuit Breakers

Circuit breakers protect against cascading failures. Each service has configurable thresholds.

### Database Circuit Breaker

| Variable | Default | Description |
|----------|---------|-------------|
| `VORION_CB_DATABASE_FAILURE_THRESHOLD` | `5` | Failures before opening |
| `VORION_CB_DATABASE_RESET_TIMEOUT_MS` | `30000` | Time before retry |
| `VORION_CB_DATABASE_HALF_OPEN_MAX_ATTEMPTS` | `3` | Attempts in half-open |
| `VORION_CB_DATABASE_MONITOR_WINDOW_MS` | `60000` | Monitoring window |

### Redis Circuit Breaker

| Variable | Default | Description |
|----------|---------|-------------|
| `VORION_CB_REDIS_FAILURE_THRESHOLD` | `10` | Failures before opening |
| `VORION_CB_REDIS_RESET_TIMEOUT_MS` | `10000` | Time before retry |
| `VORION_CB_REDIS_HALF_OPEN_MAX_ATTEMPTS` | `5` | Attempts in half-open |
| `VORION_CB_REDIS_MONITOR_WINDOW_MS` | `30000` | Monitoring window |

### Webhook Circuit Breaker

| Variable | Default | Description |
|----------|---------|-------------|
| `VORION_CB_WEBHOOK_FAILURE_THRESHOLD` | `3` | Failures before opening |
| `VORION_CB_WEBHOOK_RESET_TIMEOUT_MS` | `60000` | Time before retry |
| `VORION_CB_WEBHOOK_HALF_OPEN_MAX_ATTEMPTS` | `2` | Attempts in half-open |
| `VORION_CB_WEBHOOK_MONITOR_WINDOW_MS` | `120000` | Monitoring window |

### Policy Engine Circuit Breaker

| Variable | Default | Description |
|----------|---------|-------------|
| `VORION_CB_POLICY_ENGINE_FAILURE_THRESHOLD` | `5` | Failures before opening |
| `VORION_CB_POLICY_ENGINE_RESET_TIMEOUT_MS` | `15000` | Time before retry |
| `VORION_CB_POLICY_ENGINE_HALF_OPEN_MAX_ATTEMPTS` | `3` | Attempts in half-open |
| `VORION_CB_POLICY_ENGINE_MONITOR_WINDOW_MS` | `60000` | Monitoring window |

### Trust Engine Circuit Breaker

| Variable | Default | Description |
|----------|---------|-------------|
| `VORION_CB_TRUST_ENGINE_FAILURE_THRESHOLD` | `5` | Failures before opening |
| `VORION_CB_TRUST_ENGINE_RESET_TIMEOUT_MS` | `15000` | Time before retry |
| `VORION_CB_TRUST_ENGINE_HALF_OPEN_MAX_ATTEMPTS` | `3` | Attempts in half-open |
| `VORION_CB_TRUST_ENGINE_MONITOR_WINDOW_MS` | `60000` | Monitoring window |

---

## Webhooks

### VORION_WEBHOOK_TIMEOUT_MS
- **Required:** No
- **Default:** `10000` (10 seconds)
- **Range:** 1000-60000
- **Description:** HTTP timeout for webhook delivery.

```bash
VORION_WEBHOOK_TIMEOUT_MS=15000
```

### VORION_WEBHOOK_RETRY_ATTEMPTS
- **Required:** No
- **Default:** `3`
- **Range:** 0-10
- **Description:** Retry attempts for failed webhooks.

```bash
VORION_WEBHOOK_RETRY_ATTEMPTS=5
```

### VORION_WEBHOOK_RETRY_DELAY_MS
- **Required:** No
- **Default:** `1000` (1 second)
- **Range:** 100-30000
- **Description:** Base delay between retries (exponential backoff).

```bash
VORION_WEBHOOK_RETRY_DELAY_MS=2000
```

### VORION_WEBHOOK_ALLOW_DNS_CHANGE
- **Required:** No
- **Default:** `false`
- **Description:** Allow DNS changes between registration and delivery. Setting to `true` disables DNS rebinding protection.

```bash
VORION_WEBHOOK_ALLOW_DNS_CHANGE=false
```

### VORION_WEBHOOK_CIRCUIT_FAILURE_THRESHOLD
- **Required:** No
- **Default:** `5`
- **Description:** Failures before opening webhook circuit breaker.

```bash
VORION_WEBHOOK_CIRCUIT_FAILURE_THRESHOLD=10
```

### VORION_WEBHOOK_CIRCUIT_RESET_TIMEOUT_MS
- **Required:** No
- **Default:** `300000` (5 minutes)
- **Description:** Time before attempting webhook delivery after circuit opens.

```bash
VORION_WEBHOOK_CIRCUIT_RESET_TIMEOUT_MS=600000
```

### VORION_WEBHOOK_DELIVERY_CONCURRENCY
- **Required:** No
- **Default:** `10`
- **Range:** 1-50
- **Description:** Maximum parallel webhook deliveries per tenant.

```bash
VORION_WEBHOOK_DELIVERY_CONCURRENCY=20
```

---

## GDPR Compliance

### VORION_GDPR_EXPORT_CONCURRENCY
- **Required:** No
- **Default:** CPU count (minimum 2)
- **Range:** 1-32
- **Description:** Concurrency for GDPR data export operations.

```bash
VORION_GDPR_EXPORT_CONCURRENCY=4
```

---

## Audit Configuration

### VORION_AUDIT_RETENTION_DAYS
- **Required:** No
- **Default:** `365` (1 year)
- **Minimum:** 30
- **Description:** Days to retain audit records. For SOX compliance, use 2555 (7 years).

```bash
VORION_AUDIT_RETENTION_DAYS=2555
```

### VORION_AUDIT_ARCHIVE_ENABLED
- **Required:** No
- **Default:** `true`
- **Description:** Enable archival instead of hard delete.

```bash
VORION_AUDIT_ARCHIVE_ENABLED=true
```

### VORION_AUDIT_ARCHIVE_AFTER_DAYS
- **Required:** No
- **Default:** `90`
- **Description:** Days before moving records to archived state.

```bash
VORION_AUDIT_ARCHIVE_AFTER_DAYS=180
```

### VORION_AUDIT_CLEANUP_BATCH_SIZE
- **Required:** No
- **Default:** `1000`
- **Range:** 100-10000
- **Description:** Batch size for cleanup operations.

```bash
VORION_AUDIT_CLEANUP_BATCH_SIZE=5000
```

---

## Encryption

### VORION_ENCRYPTION_KEY
- **Required:** Yes (in production/staging when encryption enabled)
- **Minimum:** 32 characters
- **Description:** Key for encrypting data at rest.

```bash
# Generate with: openssl rand -base64 32
VORION_ENCRYPTION_KEY=your-32-character-minimum-encryption-key
```

### VORION_ENCRYPTION_SALT
- **Required:** Yes (in production/staging with PBKDF2)
- **Minimum:** 16 characters
- **Description:** Salt for PBKDF2 key derivation.

```bash
# Generate with: openssl rand -base64 16
VORION_ENCRYPTION_SALT=your-16-char-salt
```

### VORION_ENCRYPTION_ALGORITHM
- **Required:** No
- **Default:** `aes-256-gcm`
- **Description:** Encryption algorithm.

```bash
VORION_ENCRYPTION_ALGORITHM=aes-256-gcm
```

### VORION_ENCRYPTION_PBKDF2_ITERATIONS
- **Required:** No
- **Default:** `100000`
- **Minimum:** 10000
- **Description:** PBKDF2 iterations (higher = more secure but slower).

```bash
VORION_ENCRYPTION_PBKDF2_ITERATIONS=150000
```

### VORION_ENCRYPTION_KDF_VERSION
- **Required:** No
- **Default:** `2`
- **Values:** `1` (legacy SHA-256, insecure), `2` (PBKDF2-SHA512)
- **Description:** Key derivation function version.

```bash
VORION_ENCRYPTION_KDF_VERSION=2
```

---

## CSRF Protection

### VORION_CSRF_ENABLED
- **Required:** No
- **Default:** `true`
- **Description:** Enable CSRF protection.

```bash
VORION_CSRF_ENABLED=true
```

### VORION_CSRF_SECRET
- **Required:** No (auto-generated if not provided)
- **Minimum:** 32 characters
- **Description:** Secret key for HMAC signing CSRF tokens.

```bash
VORION_CSRF_SECRET=your-csrf-secret-key
```

### VORION_CSRF_COOKIE_NAME
- **Required:** No
- **Default:** `__vorion_csrf`
- **Description:** Name of the CSRF cookie.

```bash
VORION_CSRF_COOKIE_NAME=_csrf
```

### VORION_CSRF_HEADER_NAME
- **Required:** No
- **Default:** `X-CSRF-Token`
- **Description:** Header name for CSRF token.

```bash
VORION_CSRF_HEADER_NAME=X-CSRF-Token
```

### VORION_CSRF_TOKEN_TTL
- **Required:** No
- **Default:** `3600000` (1 hour)
- **Description:** Token validity duration in milliseconds.

```bash
VORION_CSRF_TOKEN_TTL=7200000
```

### VORION_CSRF_EXCLUDE_PATHS
- **Required:** No
- **Default:** `/api/webhooks/*,/api/health,/api/metrics`
- **Description:** Comma-separated paths to exclude from CSRF protection.

```bash
VORION_CSRF_EXCLUDE_PATHS=/api/webhooks/*,/api/health
```

### VORION_CSRF_EXCLUDE_METHODS
- **Required:** No
- **Default:** `GET,HEAD,OPTIONS`
- **Description:** Comma-separated HTTP methods to exclude.

```bash
VORION_CSRF_EXCLUDE_METHODS=GET,HEAD,OPTIONS
```

---

## Session Management

### VORION_SESSION_FINGERPRINT_ENABLED
- **Required:** No
- **Default:** `true`
- **Description:** Enable server-side session fingerprint validation.

```bash
VORION_SESSION_FINGERPRINT_ENABLED=true
```

### VORION_SESSION_FINGERPRINT_STRICTNESS
- **Required:** No
- **Default:** `warn`
- **Values:** `warn`, `block`
- **Description:** Action on fingerprint mismatch: `warn` logs, `block` rejects.

```bash
VORION_SESSION_FINGERPRINT_STRICTNESS=block
```

### VORION_SESSION_FINGERPRINT_COMPONENTS
- **Required:** No
- **Default:** `userAgent,acceptLanguage`
- **Description:** Comma-separated components for fingerprint computation.

```bash
VORION_SESSION_FINGERPRINT_COMPONENTS=userAgent,acceptLanguage,acceptEncoding
```

---

## Lite Mode

Lite mode enables simplified single-instance deployments with reduced infrastructure requirements.

### VORION_LITE_ENABLED
- **Required:** No
- **Default:** `false`
- **Description:** Enable lite mode for simplified deployments.

```bash
VORION_LITE_ENABLED=true
```

### VORION_LITE_AUTO_GENERATE_SECRETS
- **Required:** No
- **Default:** `true`
- **Description:** Auto-generate secrets in development. MUST be `false` in production.

```bash
VORION_LITE_AUTO_GENERATE_SECRETS=false
```

### VORION_LITE_DATA_DIRECTORY
- **Required:** No
- **Default:** `./data`
- **Description:** Directory for local data storage.

```bash
VORION_LITE_DATA_DIRECTORY=/var/vorion/data
```

### VORION_LITE_REDIS_OPTIONAL
- **Required:** No
- **Default:** `true`
- **Description:** Allow running without Redis (uses in-memory adapters). Note: In-memory state is NOT shared across instances.

```bash
VORION_LITE_REDIS_OPTIONAL=true
```

---

## Telemetry

### VORION_TELEMETRY_ENABLED
- **Required:** No
- **Default:** `false`
- **Description:** Enable OpenTelemetry distributed tracing.

```bash
VORION_TELEMETRY_ENABLED=true
```

### VORION_TELEMETRY_SERVICE_NAME
- **Required:** No
- **Default:** `vorion-intent`
- **Description:** Service name for telemetry.

```bash
VORION_TELEMETRY_SERVICE_NAME=vorion-production
```

### VORION_OTLP_ENDPOINT
- **Required:** No
- **Default:** `http://localhost:4318/v1/traces`
- **Description:** OpenTelemetry collector endpoint.

```bash
VORION_OTLP_ENDPOINT=https://otel.example.com/v1/traces
```

### VORION_OTLP_HEADERS
- **Required:** No
- **Default:** `{}`
- **Description:** JSON object of headers for OTLP requests.

```bash
VORION_OTLP_HEADERS='{"Authorization":"Bearer token"}'
```

### VORION_TELEMETRY_SAMPLE_RATE
- **Required:** No
- **Default:** `1.0`
- **Range:** 0.0-1.0
- **Description:** Trace sampling rate (1.0 = 100%).

```bash
VORION_TELEMETRY_SAMPLE_RATE=0.1
```

---

## Production Checklist

Before deploying to production, ensure:

- [ ] `VORION_ENV=production`
- [ ] `VORION_JWT_SECRET` set to a cryptographically secure value (64+ chars)
- [ ] `VORION_DEDUPE_SECRET` set (32+ chars)
- [ ] `VORION_ENCRYPTION_KEY` set (32+ chars)
- [ ] `VORION_ENCRYPTION_SALT` set (16+ chars)
- [ ] Database credentials configured securely
- [ ] Redis password configured
- [ ] `VORION_LITE_AUTO_GENERATE_SECRETS=false`
- [ ] Review and configure rate limits
- [ ] Configure appropriate log level (`info` or `warn`)
- [ ] Set up monitoring and alerting
- [ ] Configure backup procedures
