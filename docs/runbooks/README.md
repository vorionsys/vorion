# Vorion Operational Runbooks

This directory contains operational runbooks for managing, troubleshooting, and maintaining Vorion deployments.

## Available Runbooks

| Runbook | Description | When to Use |
|---------|-------------|-------------|
| [Troubleshooting](./troubleshooting.md) | Common issues and resolution steps | Service degradation, errors, or outages |
| [Monitoring](./monitoring.md) | Key metrics, alerts, and dashboards | Setting up observability, investigating performance |
| [Backup & Restore](./backup-restore.md) | Database backups, Redis persistence, disaster recovery | Data protection, recovery scenarios |
| [Scaling](./scaling.md) | Horizontal/vertical scaling, clustering | Capacity planning, handling load increases |

## Quick Reference

### Health Check Endpoints

| Endpoint | Purpose | Response Codes |
|----------|---------|----------------|
| `GET /health/live` | Kubernetes liveness probe | 200 OK, 503 Service Unavailable |
| `GET /health/ready` | Kubernetes readiness probe | 200 OK, 503 Service Unavailable |
| `GET /health/startup` | Kubernetes startup probe | 200 OK, 503 Service Unavailable |
| `GET /health` | Basic health status | 200 OK/Degraded, 503 Unhealthy |
| `GET /health/detailed` | Full system status with circuit breakers | 200 OK, 503 Unhealthy |

### Operating Modes

Vorion supports two operating modes:

- **Full Mode**: Requires PostgreSQL, Redis, and BullMQ queues
- **Lite Mode**: Requires only PostgreSQL (enabled via `VORION_LITE_ENABLED=true`)

### Critical Environment Variables

```bash
# Required in Production
VORION_JWT_SECRET           # Min 32 chars, high entropy
VORION_ENCRYPTION_KEY       # Min 32 chars, for data at rest
VORION_ENCRYPTION_SALT      # Min 16 chars, for PBKDF2
VORION_DEDUPE_SECRET        # Min 32 chars, for hash security

# Database
VORION_DB_HOST
VORION_DB_PORT
VORION_DB_NAME
VORION_DB_USER
VORION_DB_PASSWORD

# Redis (required in full mode)
VORION_REDIS_HOST
VORION_REDIS_PORT
VORION_REDIS_PASSWORD
```

### Service Status Values

| Status | Description |
|--------|-------------|
| `healthy` | All components functioning normally, all circuits closed |
| `degraded` | Some circuits open but service can still function |
| `unhealthy` | Critical components unavailable |
| `shutting_down` | Graceful shutdown in progress |

### Circuit Breaker States

| State | Description |
|-------|-------------|
| `CLOSED` | Normal operation, requests pass through |
| `OPEN` | Circuit tripped, requests fail fast |
| `HALF_OPEN` | Testing recovery, limited requests allowed |

## Emergency Contacts

Update this section with your organization's contacts:

- **On-Call**: [Your PagerDuty/OpsGenie rotation]
- **Platform Team**: [Slack channel or email]
- **Security Team**: [For security incidents]

## Runbook Maintenance

These runbooks should be reviewed and updated:
- After any production incident
- When configuration options change
- When new dependencies are added
- Quarterly as part of operational review
