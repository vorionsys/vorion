# Business Deployment Guide

The Business deployment mode is designed for teams and production workloads. It includes Redis for job queuing, caching, and distributed state management.

## Overview

- **Full stack** with Vorion API, PostgreSQL, and Redis
- **Redis-backed job queue** for reliable async processing
- **Horizontal scaling** support (with shared Redis)
- **Production-ready** configuration options
- **Metrics endpoint** for monitoring

## Prerequisites

- Docker 20.10+ with Docker Compose v2
- 4GB+ available RAM
- 20GB+ disk space
- Production secrets (see Secret Generation)

## Quick Start

### 1. Generate Secrets

```bash
# Create .env file with secure secrets
cat > .env << 'EOF'
# JWT signing secret (minimum 64 characters)
VORION_JWT_SECRET=$(openssl rand -base64 64)

# Encryption key for data at rest
VORION_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Salt for key derivation
VORION_ENCRYPTION_SALT=$(openssl rand -base64 16)

# HMAC secret for deduplication
VORION_DEDUPE_SECRET=$(openssl rand -base64 32)

# CSRF protection secret
VORION_CSRF_SECRET=$(openssl rand -base64 32)

# Database password
VORION_DB_PASSWORD=$(openssl rand -base64 24)

# Log level
VORION_LOG_LEVEL=info
EOF

# Actually generate the values
source <(cat .env | sed 's/\$(/`/g' | sed 's/)/`/g')
```

### 2. Start the Stack

```bash
# Start all services
docker compose -f docker-compose.business.yml up -d

# Watch startup logs
docker compose -f docker-compose.business.yml logs -f
```

### 3. Verify Installation

```bash
# Check health
curl http://localhost:3000/health

# Check metrics
curl http://localhost:9090/metrics
```

## docker-compose.business.yml

```yaml
services:
  vorion:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"   # API
      - "9090:9090"   # Metrics
    environment:
      - VORION_ENV=production
      - VORION_LITE_MODE=false
      - VORION_JWT_SECRET=${VORION_JWT_SECRET}
      - VORION_ENCRYPTION_KEY=${VORION_ENCRYPTION_KEY}
      - VORION_ENCRYPTION_SALT=${VORION_ENCRYPTION_SALT}
      - VORION_DEDUPE_SECRET=${VORION_DEDUPE_SECRET}
      - VORION_CSRF_SECRET=${VORION_CSRF_SECRET}
      - VORION_DB_HOST=postgres
      - VORION_DB_PASSWORD=${VORION_DB_PASSWORD}
      - VORION_REDIS_HOST=redis
    volumes:
      - vorion-data:/app/data
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=vorion
      - POSTGRES_PASSWORD=${VORION_DB_PASSWORD}
      - POSTGRES_DB=vorion
    volumes:
      - postgres-data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis-data:/data
```

## Environment Variables

### Required Secrets

| Variable | Min Length | Description |
|----------|------------|-------------|
| `VORION_JWT_SECRET` | 32 chars | JWT signing secret (use 64+ bytes) |
| `VORION_ENCRYPTION_KEY` | 32 chars | AES-256 encryption key |
| `VORION_ENCRYPTION_SALT` | 16 chars | PBKDF2 salt for key derivation |
| `VORION_DEDUPE_SECRET` | 32 chars | HMAC secret for deduplication |
| `VORION_CSRF_SECRET` | 32 chars | CSRF token signing secret |
| `VORION_DB_PASSWORD` | - | PostgreSQL password |

### Database Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VORION_DB_HOST` | `postgres` | PostgreSQL hostname |
| `VORION_DB_PORT` | `5432` | PostgreSQL port |
| `VORION_DB_NAME` | `vorion` | Database name |
| `VORION_DB_USER` | `vorion` | Database username |
| `VORION_DB_POOL_MIN` | `10` | Minimum pool connections |
| `VORION_DB_POOL_MAX` | `50` | Maximum pool connections |
| `VORION_DB_STATEMENT_TIMEOUT_MS` | `30000` | Query timeout (30s) |

### Redis Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VORION_REDIS_HOST` | `redis` | Redis hostname |
| `VORION_REDIS_PORT` | `6379` | Redis port |
| `VORION_REDIS_PASSWORD` | - | Redis password (optional) |
| `VORION_REDIS_DB` | `0` | Redis database number |

### API Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VORION_API_HOST` | `0.0.0.0` | API bind address |
| `VORION_API_PORT` | `3000` | API port |
| `VORION_API_TIMEOUT` | `30000` | Request timeout (ms) |
| `VORION_API_RATE_LIMIT` | `1000` | Requests/minute per IP |
| `VORION_API_BULK_RATE_LIMIT` | `10` | Bulk operations/minute |

### Queue Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VORION_INTENT_QUEUE_CONCURRENCY` | `5` | Concurrent job workers |
| `VORION_INTENT_JOB_TIMEOUT_MS` | `30000` | Job execution timeout |
| `VORION_INTENT_MAX_RETRIES` | `3` | Failed job retry count |
| `VORION_INTENT_RETRY_BACKOFF_MS` | `1000` | Base retry delay |
| `VORION_INTENT_QUEUE_DEPTH_THRESHOLD` | `10000` | Queue depth health threshold |

### Telemetry Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VORION_TELEMETRY_ENABLED` | `false` | Enable OpenTelemetry |
| `VORION_OTLP_ENDPOINT` | - | OTLP collector endpoint |
| `VORION_TELEMETRY_SAMPLE_RATE` | `1.0` | Trace sampling rate (0.0-1.0) |

## Redis Configuration

### Memory Management

Redis is configured with:
- `maxmemory 256mb` - Maximum memory limit
- `maxmemory-policy allkeys-lru` - Evict least recently used keys

For production, consider increasing memory:

```yaml
redis:
  command: redis-server --appendonly yes --maxmemory 1gb --maxmemory-policy allkeys-lru
```

### Persistence

Redis uses AOF (Append Only File) persistence:
- Data is persisted to disk on every write
- Recovery is possible after restart

### Security

For production, enable Redis authentication:

```yaml
redis:
  command: redis-server --appendonly yes --requirepass ${VORION_REDIS_PASSWORD}
```

And configure Vorion:
```bash
VORION_REDIS_PASSWORD=your-secure-password
```

## Scaling Considerations

### Horizontal Scaling

The business deployment supports running multiple Vorion instances:

```bash
# Scale to 3 instances
docker compose -f docker-compose.business.yml up -d --scale vorion=3
```

**Requirements for scaling:**
- All instances must share the same Redis
- All instances must share the same PostgreSQL
- Load balancer in front (not included in business compose)

### Vertical Scaling

Adjust resource limits based on workload:

```yaml
services:
  vorion:
    deploy:
      resources:
        limits:
          memory: 2G
        reservations:
          memory: 512M

  postgres:
    deploy:
      resources:
        limits:
          memory: 2G

  redis:
    deploy:
      resources:
        limits:
          memory: 1G
```

### Database Pool Sizing

Tune connection pool based on instance count:

```bash
# Per-instance settings
VORION_DB_POOL_MIN=5
VORION_DB_POOL_MAX=20

# Total connections = instances * POOL_MAX
# Ensure PostgreSQL max_connections > total
```

## Monitoring Setup

### Prometheus Metrics

Vorion exposes Prometheus metrics on port 9090:

```bash
curl http://localhost:9090/metrics
```

Key metrics:
- `vorion_intents_total` - Total intents processed
- `vorion_intent_duration_seconds` - Processing latency
- `vorion_queue_depth` - Current queue size
- `vorion_db_pool_size` - Database connection pool
- `vorion_redis_commands_total` - Redis operations

### Health Checks

| Endpoint | Interval | Timeout | Purpose |
|----------|----------|---------|---------|
| `/health/live` | 30s | 10s | Container liveness |
| `/health/ready` | 30s | 10s | Load balancer routing |

### Development Tools

Enable database and Redis UIs for debugging:

```bash
# Start with dev tools profile
docker compose -f docker-compose.business.yml --profile dev-tools up -d

# Access:
# - Adminer (PostgreSQL): http://localhost:8080
# - Redis Commander: http://localhost:8081
```

## Backup and Recovery

### Database Backup

```bash
# Create backup
docker compose -f docker-compose.business.yml exec postgres \
  pg_dump -U vorion -Fc vorion > backup.dump

# Schedule regular backups (example cron entry)
0 2 * * * docker compose -f docker-compose.business.yml exec -T postgres \
  pg_dump -U vorion -Fc vorion > /backups/vorion-$(date +%Y%m%d).dump
```

### Database Restore

```bash
# Restore from backup
docker compose -f docker-compose.business.yml exec -T postgres \
  pg_restore -U vorion -d vorion --clean < backup.dump
```

### Redis Backup

Redis AOF provides automatic persistence. For additional safety:

```bash
# Trigger RDB snapshot
docker compose -f docker-compose.business.yml exec redis \
  redis-cli BGSAVE
```

## Security Hardening

### Network Isolation

The compose file creates an isolated network. Services are not exposed externally except:
- Port 3000 (API)
- Port 9090 (Metrics)

Consider using a reverse proxy for TLS termination.

### Secret Management

For production, use Docker secrets or external secret management:

```yaml
services:
  vorion:
    secrets:
      - vorion_jwt_secret
      - vorion_db_password

secrets:
  vorion_jwt_secret:
    external: true
  vorion_db_password:
    external: true
```

### TLS Configuration

For TLS, add a reverse proxy (nginx, traefik, or caddy):

```yaml
services:
  caddy:
    image: caddy:latest
    ports:
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
    depends_on:
      - vorion
```

Example Caddyfile:
```
api.yourdomain.com {
    reverse_proxy vorion:3000
}
```

## Troubleshooting

### Redis Connection Issues

```bash
# Check Redis health
docker compose -f docker-compose.business.yml exec redis redis-cli ping

# Check Redis info
docker compose -f docker-compose.business.yml exec redis redis-cli info
```

### Queue Backlog

```bash
# Check queue depth via metrics
curl -s http://localhost:9090/metrics | grep vorion_queue_depth

# If queue is growing, check worker health
docker compose -f docker-compose.business.yml logs vorion | grep -i error
```

### Memory Issues

```bash
# Check container memory usage
docker stats

# Check Redis memory
docker compose -f docker-compose.business.yml exec redis redis-cli info memory
```

## Migrating to Enterprise

When you need high availability:

1. Export database and configuration
2. Set up Kubernetes cluster or Docker Swarm
3. Deploy Redis Sentinel or Cluster
4. Configure managed PostgreSQL or replication
5. Follow [enterprise.md](./enterprise.md) for HA setup
