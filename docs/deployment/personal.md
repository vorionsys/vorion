# Personal Deployment Guide

The Personal deployment mode is designed for individual developers, small projects, and evaluation purposes. It runs Vorion in "lite mode" with simplified infrastructure requirements.

## Overview

- **Single container** Vorion instance
- **No Redis required** - uses in-process job handling
- **Auto-secret generation** for development convenience
- **Minimal resource footprint** (~512MB RAM)

## Prerequisites

- Docker 20.10+ with Docker Compose v2
- 2GB available RAM
- 10GB disk space for data persistence

## Quick Start

### 1. Start the Stack

```bash
# Start Vorion with PostgreSQL
docker compose -f docker-compose.personal.yml up -d

# Watch startup logs
docker compose -f docker-compose.personal.yml logs -f vorion
```

### 2. Verify Installation

```bash
# Check health endpoint
curl http://localhost:3000/health/live

# Expected response:
# {"status":"ok","timestamp":"..."}
```

### 3. Access the API

The API is available at `http://localhost:3000/api/v1/`

## docker-compose.personal.yml

The personal compose file defines a minimal two-service stack:

```yaml
services:
  vorion:
    build:
      context: .
      dockerfile: Dockerfile.lite
    ports:
      - "3000:3000"
    environment:
      - VORION_LITE_MODE=true
      - VORION_AUTO_GENERATE_SECRETS=true
      - VORION_DB_HOST=postgres
      - VORION_DB_PORT=5432
      - VORION_DB_NAME=vorion
      - VORION_DB_USER=vorion
      - VORION_DB_PASSWORD=vorion_dev
    volumes:
      - vorion-data:/app/data
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=vorion
      - POSTGRES_PASSWORD=vorion_dev
      - POSTGRES_DB=vorion
    volumes:
      - postgres-data:/var/lib/postgresql/data
```

## Environment Variables

### Core Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `VORION_LITE_MODE` | `true` | Enable lite mode (required for personal deployment) |
| `VORION_ENV` | `development` | Environment: development, staging, production |
| `VORION_LOG_LEVEL` | `info` | Log level: debug, info, warn, error |

### Auto-Secret Generation

| Variable | Default | Description |
|----------|---------|-------------|
| `VORION_AUTO_GENERATE_SECRETS` | `true` | Auto-generate missing secrets on startup |

When `VORION_AUTO_GENERATE_SECRETS=true`, Vorion automatically generates:
- JWT signing secret
- Encryption key and salt
- CSRF protection secret
- Deduplication HMAC secret

Generated secrets are stored in `/app/data/secrets/` and reused across restarts.

**Warning**: Auto-secret generation is for development only. In production, always provide explicit secrets.

### Database Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VORION_DB_HOST` | `postgres` | PostgreSQL hostname |
| `VORION_DB_PORT` | `5432` | PostgreSQL port |
| `VORION_DB_NAME` | `vorion` | Database name |
| `VORION_DB_USER` | `vorion` | Database username |
| `VORION_DB_PASSWORD` | - | Database password (required) |

### API Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VORION_API_HOST` | `0.0.0.0` | API bind address |
| `VORION_API_PORT` | `3000` | API port |
| `VORION_API_RATE_LIMIT` | `1000` | Requests per minute per IP |

### Proof Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `VORION_PROOF_STORAGE` | `local` | Storage backend: local, s3, gcs |
| `VORION_PROOF_LOCAL_PATH` | `/app/data/proofs` | Local storage path |

## Data Persistence

The personal deployment uses two Docker volumes:

### vorion-data

Contains application data:
```
/app/data/
├── proofs/       # Proof artifacts
├── secrets/      # Auto-generated secrets
└── exports/      # GDPR export files
```

### postgres-data

Contains PostgreSQL database files.

### Backup

```bash
# Backup database
docker compose -f docker-compose.personal.yml exec postgres \
  pg_dump -U vorion vorion > backup.sql

# Backup data volume
docker run --rm \
  -v vorion-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/vorion-data.tar.gz -C /data .
```

### Restore

```bash
# Restore database
docker compose -f docker-compose.personal.yml exec -T postgres \
  psql -U vorion vorion < backup.sql

# Restore data volume
docker run --rm \
  -v vorion-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/vorion-data.tar.gz -C /data
```

## Resource Limits

The personal deployment includes conservative resource limits:

| Service | Memory Limit | Notes |
|---------|--------------|-------|
| Vorion | (unlimited) | Typically uses 256-512MB |
| PostgreSQL | 512MB | Sufficient for small datasets |

To add resource limits to Vorion:

```yaml
services:
  vorion:
    deploy:
      resources:
        limits:
          memory: 1G
        reservations:
          memory: 256M
```

## Upgrading

### Minor Versions

```bash
# Pull latest images
docker compose -f docker-compose.personal.yml pull

# Restart with new version
docker compose -f docker-compose.personal.yml up -d
```

### Major Versions

1. Backup your data (see above)
2. Check release notes for migration steps
3. Run database migrations if required
4. Start the new version

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose -f docker-compose.personal.yml logs vorion

# Common issues:
# - Database not ready: Wait for postgres health check
# - Port conflict: Change VORION_API_PORT
# - Permission error: Check volume permissions
```

### Database Connection Failed

```bash
# Verify PostgreSQL is running
docker compose -f docker-compose.personal.yml ps postgres

# Test connection
docker compose -f docker-compose.personal.yml exec postgres \
  psql -U vorion -d vorion -c "SELECT 1"
```

### Health Check Failing

```bash
# Check detailed health
curl -s http://localhost:3000/health | jq .

# Check container health status
docker inspect vorion --format='{{.State.Health.Status}}'
```

## Migrating to Business Deployment

When you outgrow the personal deployment:

1. Export your database:
   ```bash
   docker compose -f docker-compose.personal.yml exec postgres \
     pg_dump -U vorion vorion > migration.sql
   ```

2. Generate production secrets:
   ```bash
   openssl rand -base64 64  # JWT_SECRET
   openssl rand -base64 32  # ENCRYPTION_KEY
   openssl rand -base64 16  # ENCRYPTION_SALT
   ```

3. Import to business deployment:
   ```bash
   docker compose -f docker-compose.business.yml exec -T postgres \
     psql -U vorion vorion < migration.sql
   ```

4. Disable auto-secret generation and configure explicit secrets

See [business.md](./business.md) for the full business deployment guide.
