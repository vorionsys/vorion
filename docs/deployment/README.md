# Vorion Deployment Guide

Vorion is a Governed AI Execution Platform that supports multiple deployment modes to match your organization's scale and requirements.

## Deployment Modes

| Mode | Use Case | Infrastructure | Redis Required |
|------|----------|----------------|----------------|
| **Personal** | Individual developers, small projects | Single container + PostgreSQL | No |
| **Business** | Teams, production workloads | Full stack with Redis | Yes |
| **Enterprise** | High availability, large scale | Kubernetes, replicated services | Yes (Sentinel/Cluster) |

## Prerequisites

### All Deployments

- **Docker** 20.10+ and Docker Compose v2
- **PostgreSQL** 15+ (included in compose files or external)
- Minimum 2GB RAM for the Vorion container
- Persistent storage for data directory

### Production Requirements

- TLS/SSL certificates for HTTPS
- Secure secrets management (not environment variables in plain text)
- Network isolation between services
- Regular backup strategy for PostgreSQL

## Quick Start

### Personal Deployment (Fastest)

```bash
# Clone and start
git clone https://github.com/vorion/vorion.git
cd vorion

# Start with auto-generated secrets (development only)
docker compose -f docker-compose.personal.yml up -d

# Check status
docker compose -f docker-compose.personal.yml logs -f vorion
```

Access: http://localhost:3000

### Business Deployment

```bash
# Create environment file with secrets
cat > .env << 'EOF'
VORION_JWT_SECRET=$(openssl rand -base64 64)
VORION_ENCRYPTION_KEY=$(openssl rand -base64 32)
VORION_ENCRYPTION_SALT=$(openssl rand -base64 16)
VORION_DEDUPE_SECRET=$(openssl rand -base64 32)
VORION_CSRF_SECRET=$(openssl rand -base64 32)
VORION_DB_PASSWORD=$(openssl rand -base64 24)
EOF

# Start full stack
docker compose -f docker-compose.business.yml up -d

# Verify health
curl http://localhost:3000/health
```

Access:
- API: http://localhost:3000
- Metrics: http://localhost:9090/metrics

### Enterprise Deployment

See [enterprise.md](./enterprise.md) for Kubernetes manifests and high-availability configuration.

## Health Endpoints

Vorion provides multiple health check endpoints:

| Endpoint | Purpose | Use Case |
|----------|---------|----------|
| `/health/live` | Liveness probe | Container orchestrator liveness check |
| `/health/ready` | Readiness probe | Load balancer routing decisions |
| `/health` | Full health status | Monitoring dashboards |

## Architecture Overview

```
                    +------------------+
                    |   Load Balancer  |
                    |   (Traefik/NGINX)|
                    +--------+---------+
                             |
              +--------------+--------------+
              |              |              |
        +-----v----+  +------v-----+  +-----v----+
        | Vorion 1 |  | Vorion 2   |  | Vorion N |
        +-----+----+  +------+-----+  +-----+----+
              |              |              |
              +--------------+--------------+
                             |
              +--------------+--------------+
              |                             |
        +-----v------+              +-------v------+
        | PostgreSQL |              |    Redis     |
        | (Primary)  |              | (Sentinel)   |
        +------------+              +--------------+
```

## Configuration Reference

All configuration is done via environment variables prefixed with `VORION_`. See the individual deployment guides for mode-specific variables:

- [Personal Deployment](./personal.md) - Minimal configuration
- [Business Deployment](./business.md) - Full configuration options
- [Enterprise Deployment](./enterprise.md) - HA and security hardening

## Security Considerations

### Secret Generation

Always use cryptographically secure random values:

```bash
# JWT Secret (64 bytes minimum)
openssl rand -base64 64

# Encryption Key (32 bytes)
openssl rand -base64 32

# Encryption Salt (16 bytes)
openssl rand -base64 16
```

### Production Checklist

- [ ] All secrets are unique and randomly generated
- [ ] TLS enabled for all external endpoints
- [ ] Database connections use TLS
- [ ] Redis connections use TLS and authentication
- [ ] Network policies restrict inter-service communication
- [ ] Secrets stored in a secrets manager (not .env files)
- [ ] Regular security updates applied
- [ ] Audit logging enabled and monitored

## Support

- Documentation: https://docs.vorion.io
- Issues: https://github.com/vorion/vorion/issues
- Security: security@vorion.io
