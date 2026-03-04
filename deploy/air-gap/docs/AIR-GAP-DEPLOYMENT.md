# Vorion Air-Gap Deployment Guide

This comprehensive guide covers deploying Vorion in air-gapped (isolated) environments where no internet connectivity is available.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Bundle Preparation](#bundle-preparation)
4. [Transfer Methods](#transfer-methods)
5. [Installation](#installation)
6. [Certificate Setup](#certificate-setup)
7. [Network Configuration](#network-configuration)
8. [Security Hardening](#security-hardening)
9. [Licensing](#licensing)
10. [Updates](#updates)
11. [Backup and Recovery](#backup-and-recovery)
12. [Monitoring](#monitoring)
13. [Troubleshooting](#troubleshooting)
14. [Reference](#reference)

---

## Overview

### What is Air-Gap Deployment?

An air-gapped deployment runs in a network environment with no connection to the internet or external networks. This is common in:

- Government and military installations
- Financial institutions
- Healthcare systems (HIPAA compliance)
- Critical infrastructure
- High-security research facilities

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Air-Gapped Network                          │
│                                                                 │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐       │
│  │   Nginx     │────▶│    API      │────▶│  PostgreSQL │       │
│  │   (443)     │     │   Server    │     │   Database  │       │
│  └─────────────┘     └─────────────┘     └─────────────┘       │
│         │                   │                   │               │
│         │            ┌─────────────┐            │               │
│         └───────────▶│    Web      │            │               │
│                      │  Frontend   │            │               │
│                      └─────────────┘            │               │
│                             │                   │               │
│                      ┌─────────────┐     ┌─────────────┐       │
│                      │   Worker    │────▶│    Redis    │       │
│                      │   Process   │     │    Cache    │       │
│                      └─────────────┘     └─────────────┘       │
│                                                                 │
│  Internal Network: 172.28.0.0/16 (No External Access)          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 8 GB | 16+ GB |
| Storage | 100 GB SSD | 500+ GB SSD |
| Network | 1 Gbps | 10 Gbps |

### Operating System

Supported Linux distributions:

- **RHEL/CentOS**: 8.x, 9.x
- **Ubuntu**: 20.04 LTS, 22.04 LTS
- **Debian**: 11, 12
- **Rocky Linux**: 8.x, 9.x
- **Amazon Linux**: 2023

### Software Requirements

| Software | Minimum Version | Notes |
|----------|-----------------|-------|
| Docker Engine | 24.0.0 | Required |
| Docker Compose | 2.20.0 | Plugin or standalone |
| OpenSSL | 1.1.1 | For certificate generation |
| tar/gzip | - | For bundle extraction |
| bash | 4.0 | For installation scripts |

### Pre-Installation Checklist

- [ ] Server meets hardware requirements
- [ ] Operating system installed and updated
- [ ] Docker installed and running
- [ ] Docker Compose available
- [ ] Sufficient disk space
- [ ] Network interfaces configured
- [ ] Firewall rules prepared
- [ ] Time synchronization plan (NTP or manual)

---

## Bundle Preparation

Bundle creation must be performed on a system with internet access.

### Step 1: Clone Repository

```bash
git clone https://github.com/your-org/vorion.git
cd vorion
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Create Air-Gap Bundle

```bash
# Basic bundle creation
cd deploy/air-gap
npx ts-node bundle-creator.ts

# With specific version
npx ts-node bundle-creator.ts --version 2.0.0

# For ARM64 architecture
npx ts-node bundle-creator.ts --platform linux/arm64

# With bundle signing
npx ts-node bundle-creator.ts --sign /path/to/private.key
```

### Step 4: Verify Bundle

```bash
npx ts-node verify-bundle.ts ./dist/air-gap-bundle/vorion-bundle-*.tar.gz -v
```

### Bundle Contents

```
vorion-bundle-X.X.X/
├── manifest.json           # Bundle metadata and checksums
├── SHA256SUMS              # File checksums
├── SHA256SUMS.sig          # Optional signature
├── docker-images/          # Docker image tarballs
│   ├── manifest.json
│   ├── vorion_api_latest.tar
│   ├── vorion_web_latest.tar
│   ├── vorion_worker_latest.tar
│   ├── postgres_15-alpine.tar
│   ├── redis_7-alpine.tar
│   └── nginx_alpine.tar
├── npm-packages/           # Node.js dependencies
│   └── node_modules.tar.gz
├── database/               # Database initialization
│   ├── init.sql
│   ├── seed.sql
│   └── migrations/
├── config/                 # Configuration templates
│   ├── docker-compose.airgap.yml
│   ├── .env.airgap.template
│   └── nginx.airgap.conf
├── scripts/                # Installation scripts
│   ├── offline-installer.sh
│   ├── health-check.sh
│   ├── backup.sh
│   └── restore.sh
├── certificates/           # Certificate tools
│   ├── generate-ca.sh
│   ├── generate-server-cert.sh
│   └── generate-client-cert.sh
└── docs/                   # Documentation
    ├── AIR-GAP-DEPLOYMENT.md
    └── QUICK-START.md
```

---

## Transfer Methods

### USB Drive

**Most common method for high-security environments.**

1. Copy bundle to USB drive on connected system:
   ```bash
   cp vorion-bundle-*.tar.gz /media/usb/
   sync
   ```

2. Verify checksum:
   ```bash
   sha256sum vorion-bundle-*.tar.gz > /media/usb/bundle.sha256
   ```

3. Transfer USB to air-gapped system

4. Verify on air-gapped system:
   ```bash
   sha256sum -c bundle.sha256
   ```

### DVD/Blu-ray

For permanent archival or when USB is prohibited:

```bash
# Create ISO image
mkisofs -o vorion-bundle.iso -J -R ./vorion-bundle-*/

# Burn to disc
growisofs -dvd-compat -Z /dev/sr0=vorion-bundle.iso
```

### Data Diode

For one-way transfers in high-security environments:

1. Configure data diode according to manufacturer specifications
2. Use approved file transfer protocols
3. Verify integrity using checksums after transfer

### Cross-Domain Solution (CDS)

For transfers between security domains:

1. Submit bundle for security review
2. Follow organization's CDS procedures
3. Retrieve approved bundle on target network

---

## Installation

### Quick Installation

```bash
# Extract bundle
tar -xzf vorion-bundle-X.X.X.tar.gz
cd vorion-bundle-*

# Run installer
sudo ./scripts/offline-installer.sh
```

### Interactive Installation

```bash
sudo ./scripts/offline-installer.sh \
  --dir /opt/vorion \
  --hostname vorion.internal.local \
  --https-port 8443
```

### Non-Interactive Installation

```bash
sudo ./scripts/offline-installer.sh -y \
  --dir /opt/vorion \
  --hostname vorion.internal.local \
  --skip-certs  # If providing your own certificates
```

### Installation Steps Explained

1. **Prerequisite Checks**
   - Docker version verification
   - Disk space check
   - Memory availability

2. **Directory Creation**
   - `/opt/vorion` - Installation directory
   - `/var/lib/vorion` - Data directory
   - `/var/log/vorion` - Log directory
   - `/var/backups/vorion` - Backup directory

3. **Docker Image Loading**
   - Loads all images from tarballs
   - Verifies image integrity

4. **Configuration**
   - Copies configuration templates
   - Generates secure passwords
   - Creates environment file

5. **Certificate Generation**
   - Creates internal CA
   - Generates server certificates
   - Sets up TLS/SSL

6. **Database Initialization**
   - Creates database schema
   - Loads initial data
   - Creates default admin user

7. **Service Startup**
   - Starts all Docker containers
   - Verifies health checks
   - Creates systemd service

---

## Certificate Setup

### Internal CA Generation

The installer can generate certificates automatically, or you can use your organization's PKI.

#### Using Installer-Generated Certificates

```bash
# Certificates are generated during installation
# Located in /opt/vorion/certs/
```

#### Using Organization PKI

1. Generate CSR:
   ```bash
   cd /opt/vorion/certs
   openssl req -new -newkey rsa:2048 -nodes \
     -keyout server.key \
     -out server.csr \
     -subj "/CN=vorion.internal.local"
   ```

2. Submit CSR to your CA

3. Place signed certificate:
   ```bash
   cp /path/to/signed.crt /opt/vorion/certs/server.crt
   cp /path/to/ca-chain.crt /opt/vorion/certs/ca.crt
   ```

4. Restart nginx:
   ```bash
   docker restart vorion-nginx
   ```

### Certificate Distribution

Distribute the CA certificate to all client machines:

**Linux:**
```bash
sudo cp /opt/vorion/certs/ca.crt /usr/local/share/ca-certificates/vorion-ca.crt
sudo update-ca-certificates
```

**macOS:**
```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  /path/to/ca.crt
```

**Windows (PowerShell as Administrator):**
```powershell
Import-Certificate -FilePath C:\path\to\ca.crt `
  -CertStoreLocation Cert:\LocalMachine\Root
```

### Certificate Renewal

```bash
# Renew server certificate (CA remains valid)
cd /opt/vorion/certs
./generate-server-cert.sh vorion.internal.local

# Restart nginx to load new certificate
docker restart vorion-nginx
```

---

## Network Configuration

### DNS Configuration

Add hostname to `/etc/hosts` on all client machines:

```
192.168.1.100    vorion.internal.local
```

Or configure internal DNS server with A record.

### Firewall Rules

**Using firewalld (RHEL/CentOS):**
```bash
# Allow HTTPS
firewall-cmd --permanent --add-port=443/tcp

# Allow HTTP (for redirect)
firewall-cmd --permanent --add-port=80/tcp

# Reload
firewall-cmd --reload
```

**Using ufw (Ubuntu/Debian):**
```bash
ufw allow 443/tcp
ufw allow 80/tcp
ufw reload
```

**Using iptables:**
```bash
iptables -A INPUT -p tcp --dport 443 -j ACCEPT
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables-save > /etc/iptables/rules.v4
```

### Network Isolation

The Docker network is configured as internal by default, preventing container egress:

```yaml
networks:
  vorion-internal:
    internal: true
    ipam:
      config:
        - subnet: 172.28.0.0/16
```

To enforce host-level isolation:

```bash
# Apply network isolation policies
cd /opt/vorion
npx ts-node network-isolation.ts apply

# Verify isolation
npx ts-node network-isolation.ts verify
```

---

## Security Hardening

### Post-Installation Security Steps

1. **Change Default Passwords**
   ```bash
   # Update admin password immediately after first login
   # URL: https://vorion.internal.local
   # Default: admin@localhost / changeme123!
   ```

2. **Review Environment File**
   ```bash
   # Verify all secrets are unique and secure
   cat /opt/vorion/.env

   # Regenerate secrets if needed
   openssl rand -base64 64  # For JWT_SECRET
   openssl rand -base64 32  # For other secrets
   ```

3. **File Permissions**
   ```bash
   chmod 600 /opt/vorion/.env
   chmod 600 /opt/vorion/certs/server.key
   chmod 700 /opt/vorion/certs/ca/ca.key
   ```

4. **Disable Unnecessary Services**
   ```bash
   # In docker-compose.yml, comment out optional services
   # like minio, prometheus, grafana if not needed
   ```

### Audit Logging

Enable comprehensive audit logging:

```bash
# Logs are stored in Docker volumes and rotated automatically
# View API logs
docker logs vorion-api -f

# View authentication logs
docker logs vorion-nginx -f | grep auth
```

### SELinux Configuration (RHEL/CentOS)

```bash
# Set appropriate contexts
semanage fcontext -a -t container_file_t "/opt/vorion(/.*)?"
restorecon -Rv /opt/vorion

# Allow container networking
setsebool -P container_connect_any 1
```

---

## Licensing

### Generating Hardware Fingerprint

On the air-gapped system:

```bash
cd /opt/vorion
npx ts-node deploy/air-gap/license-manager.ts fingerprint
```

Output:
```
Hardware Fingerprint:
  Combined: abc123...def456
  CPU ID: ...
  Platform: linux
  Hostname: vorion-server
```

### Obtaining License

1. Send hardware fingerprint to vendor
2. Receive license file
3. Transfer license to air-gapped system

### Installing License

```bash
# Copy license file
cp license.key /opt/vorion/license.key

# Verify license
npx ts-node deploy/air-gap/license-manager.ts validate

# Restart services
docker compose restart
```

### License Status

```bash
npx ts-node deploy/air-gap/license-manager.ts status
```

---

## Updates

### Preparing Update Bundle

On connected system:

```bash
# Create update package
npx ts-node update-manager.ts create-update \
  --from-version 1.0.0 \
  --to-version 1.1.0 \
  --output update-1.1.0.tar.gz
```

### Applying Updates

On air-gapped system:

```bash
# Import update package
npx ts-node deploy/air-gap/update-manager.ts import ./update-1.1.0.tar.gz

# Check available updates
npx ts-node deploy/air-gap/update-manager.ts check

# Apply update (creates automatic rollback snapshot)
npx ts-node deploy/air-gap/update-manager.ts apply update-1.1.0-*
```

### Rollback

```bash
# List snapshots
npx ts-node deploy/air-gap/update-manager.ts snapshots

# Rollback to previous version
npx ts-node deploy/air-gap/update-manager.ts rollback update-1.1.0-*
```

---

## Backup and Recovery

### Automated Backups

Configure automatic daily backups:

```bash
# Edit environment
echo "AUTO_BACKUP_ENABLED=true" >> /opt/vorion/.env
echo "AUTO_BACKUP_TIME=02:00" >> /opt/vorion/.env

# Create cron job
echo "0 2 * * * /opt/vorion/backup.sh" | crontab -
```

### Manual Backup

```bash
/opt/vorion/backup.sh
```

Backup includes:
- PostgreSQL database dump
- Redis data
- Configuration files
- Uploaded files

### Restore from Backup

```bash
# List available backups
ls -la /var/backups/vorion/

# Restore specific backup
/opt/vorion/restore.sh vorion_backup_20240115_020000
```

### Disaster Recovery

1. Install fresh system with same OS
2. Install Docker
3. Run offline installer
4. Restore from backup:
   ```bash
   /opt/vorion/restore.sh /media/usb/vorion_backup_*
   ```

---

## Monitoring

### Health Checks

```bash
# Run health check
/opt/vorion/health-check.sh

# Output:
# [OK] api: healthy
# [OK] web: healthy
# [OK] postgres: healthy
# [OK] redis: healthy
# [OK] nginx: healthy
```

### Service Logs

```bash
# All services
cd /opt/vorion && docker compose logs -f

# Specific service
docker logs vorion-api -f --tail 100

# Authentication attempts
docker logs vorion-nginx 2>&1 | grep -i auth
```

### Resource Usage

```bash
# Container stats
docker stats --no-stream

# Disk usage
docker system df

# Database size
docker exec vorion-postgres psql -U vorion -c "SELECT pg_database_size('vorion');"
```

---

## Troubleshooting

### Common Issues

#### Services Won't Start

```bash
# Check Docker status
systemctl status docker

# Check compose logs
cd /opt/vorion && docker compose logs

# Verify images are loaded
docker images | grep vorion
```

#### Database Connection Failed

```bash
# Check PostgreSQL status
docker exec vorion-postgres pg_isready

# Check connection parameters
docker exec vorion-api printenv | grep DATABASE

# View PostgreSQL logs
docker logs vorion-postgres
```

#### Certificate Errors

```bash
# Verify certificate
openssl x509 -in /opt/vorion/certs/server.crt -text -noout

# Check certificate chain
openssl verify -CAfile /opt/vorion/certs/ca.crt /opt/vorion/certs/server.crt

# Test HTTPS connection
openssl s_client -connect localhost:443 -CAfile /opt/vorion/certs/ca.crt
```

#### Permission Denied

```bash
# Check file ownership
ls -la /opt/vorion/

# Fix Docker socket permissions
chmod 666 /var/run/docker.sock

# Fix SELinux contexts
restorecon -Rv /opt/vorion
```

### Diagnostic Commands

```bash
# System information
hostnamectl
free -h
df -h

# Docker information
docker info
docker compose version

# Network diagnostics
ss -tlnp
ip addr
```

### Getting Help

1. Check logs: `docker compose logs -f`
2. Verify configuration: `docker compose config`
3. Review documentation in `/opt/vorion/docs/`
4. Contact support with:
   - System information
   - Docker logs
   - Error messages
   - Steps to reproduce

---

## Reference

### File Locations

| Path | Description |
|------|-------------|
| `/opt/vorion/` | Installation directory |
| `/opt/vorion/.env` | Environment configuration |
| `/opt/vorion/docker-compose.yml` | Docker Compose file |
| `/opt/vorion/certs/` | SSL certificates |
| `/opt/vorion/database/` | Database schemas |
| `/var/lib/vorion/` | Application data |
| `/var/log/vorion/` | Log files |
| `/var/backups/vorion/` | Backup files |

### Docker Containers

| Container | Port | Description |
|-----------|------|-------------|
| vorion-nginx | 80, 443 | Reverse proxy |
| vorion-api | 3000 | API server |
| vorion-web | 80 | Web frontend |
| vorion-worker | - | Background worker |
| vorion-scheduler | - | Task scheduler |
| vorion-postgres | 5432 | Database |
| vorion-redis | 6379 | Cache |

### Environment Variables

See `.env.airgap.template` for complete list with descriptions.

### Commands Reference

| Command | Description |
|---------|-------------|
| `systemctl start vorion` | Start all services |
| `systemctl stop vorion` | Stop all services |
| `systemctl status vorion` | Check service status |
| `docker compose logs -f` | View live logs |
| `/opt/vorion/health-check.sh` | Run health check |
| `/opt/vorion/backup.sh` | Create backup |
| `/opt/vorion/restore.sh <name>` | Restore backup |

---

## Appendix

### A. Sample /etc/hosts

```
127.0.0.1       localhost
192.168.1.100   vorion.internal.local vorion api.vorion.internal.local
```

### B. Sample Firewall Rules (iptables)

```bash
#!/bin/bash
# Air-gap firewall rules

# Flush existing rules
iptables -F

# Default policies
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# Allow loopback
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow internal network
iptables -A INPUT -s 192.168.1.0/24 -j ACCEPT
iptables -A OUTPUT -d 192.168.1.0/24 -j ACCEPT

# Allow HTTPS
iptables -A INPUT -p tcp --dport 443 -j ACCEPT
iptables -A INPUT -p tcp --dport 80 -j ACCEPT

# Save rules
iptables-save > /etc/iptables/rules.v4
```

### C. Compliance Considerations

| Framework | Relevant Controls |
|-----------|------------------|
| NIST 800-53 | SC-7, AC-4, AU-2 |
| HIPAA | 164.312(e)(1) |
| PCI DSS | 1.3, 2.2, 10.1 |
| SOC 2 | CC6.1, CC6.6 |

---

**Document Version:** 1.0
**Last Updated:** 2024-01-15
**Maintainer:** Vorion Security Team
