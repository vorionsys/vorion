# Backup and Restore Runbook

This runbook covers database backup procedures, Redis persistence, secret rotation, and disaster recovery for Vorion deployments.

## Table of Contents

- [Database Backup Procedures](#database-backup-procedures)
- [Redis Persistence](#redis-persistence)
- [Secret Rotation](#secret-rotation)
- [Disaster Recovery](#disaster-recovery)
- [Data Retention Policies](#data-retention-policies)

---

## Database Backup Procedures

### Backup Strategy Overview

| Backup Type | Frequency | Retention | Use Case |
|-------------|-----------|-----------|----------|
| Full Backup | Daily | 30 days | Complete restoration |
| Incremental | Hourly | 7 days | Point-in-time recovery |
| WAL Archive | Continuous | 7 days | PITR to any point |
| Logical Backup | Weekly | 90 days | Schema migration, audit |

### Full Database Backup

#### Using pg_dump

```bash
#!/bin/bash
# Full database backup script

BACKUP_DIR="/backups/vorion"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/vorion_full_${TIMESTAMP}.sql.gz"

# Create backup directory
mkdir -p "${BACKUP_DIR}"

# Perform backup with compression
pg_dump \
  -h "${VORION_DB_HOST}" \
  -p "${VORION_DB_PORT}" \
  -U "${VORION_DB_USER}" \
  -d "${VORION_DB_NAME}" \
  -F c \
  -Z 9 \
  -f "${BACKUP_FILE}"

# Verify backup
pg_restore --list "${BACKUP_FILE}" > /dev/null 2>&1
if [ $? -eq 0 ]; then
  echo "Backup successful: ${BACKUP_FILE}"
  # Calculate checksum
  sha256sum "${BACKUP_FILE}" > "${BACKUP_FILE}.sha256"
else
  echo "Backup verification failed!"
  exit 1
fi

# Cleanup old backups (keep 30 days)
find "${BACKUP_DIR}" -name "vorion_full_*.sql.gz" -mtime +30 -delete
find "${BACKUP_DIR}" -name "*.sha256" -mtime +30 -delete
```

#### Using pg_basebackup (for PITR)

```bash
#!/bin/bash
# Base backup for point-in-time recovery

BACKUP_DIR="/backups/vorion/base"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

pg_basebackup \
  -h "${VORION_DB_HOST}" \
  -p "${VORION_DB_PORT}" \
  -U replication_user \
  -D "${BACKUP_DIR}/${TIMESTAMP}" \
  -Ft \
  -z \
  -Xs \
  -P

echo "Base backup completed: ${BACKUP_DIR}/${TIMESTAMP}"
```

### Incremental Backup with WAL Archiving

Configure PostgreSQL for continuous archiving:

```ini
# postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'gzip < %p > /backups/vorion/wal/%f.gz'
archive_timeout = 300
```

### Backup-Specific Tables

For faster, targeted backups:

```bash
# Backup critical tables only
pg_dump \
  -h "${VORION_DB_HOST}" \
  -U "${VORION_DB_USER}" \
  -d "${VORION_DB_NAME}" \
  -t intents \
  -t audit_logs \
  -t policies \
  -F c \
  -f "${BACKUP_DIR}/vorion_critical_${TIMESTAMP}.dump"
```

### Database Restore Procedures

#### Full Restore

```bash
#!/bin/bash
# Restore from full backup

BACKUP_FILE="${1:-/backups/vorion/latest.dump}"

# Verify backup integrity
sha256sum -c "${BACKUP_FILE}.sha256" || {
  echo "Checksum verification failed!"
  exit 1
}

# Stop application (optional but recommended)
kubectl scale deployment/vorion --replicas=0

# Restore database
pg_restore \
  -h "${VORION_DB_HOST}" \
  -p "${VORION_DB_PORT}" \
  -U "${VORION_DB_USER}" \
  -d "${VORION_DB_NAME}" \
  -c \
  --if-exists \
  "${BACKUP_FILE}"

# Restart application
kubectl scale deployment/vorion --replicas=3

echo "Restore completed"
```

#### Point-in-Time Recovery (PITR)

```bash
#!/bin/bash
# Restore to specific point in time

TARGET_TIME="${1:-2024-01-15 10:30:00}"
BASE_BACKUP="/backups/vorion/base/20240115_000000"
WAL_ARCHIVE="/backups/vorion/wal"

# Create recovery configuration
cat > /var/lib/postgresql/data/recovery.conf << EOF
restore_command = 'gunzip < ${WAL_ARCHIVE}/%f.gz > %p'
recovery_target_time = '${TARGET_TIME}'
recovery_target_action = 'promote'
EOF

# Start PostgreSQL with recovery
pg_ctl start -D /var/lib/postgresql/data
```

### Kubernetes CronJob for Backups

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: vorion-db-backup
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: postgres:15
            command:
            - /bin/bash
            - -c
            - |
              pg_dump -h $DB_HOST -U $DB_USER -d $DB_NAME -F c -Z 9 \
                -f /backups/vorion_$(date +%Y%m%d).dump
            env:
            - name: DB_HOST
              valueFrom:
                secretKeyRef:
                  name: vorion-db-credentials
                  key: host
            - name: DB_USER
              valueFrom:
                secretKeyRef:
                  name: vorion-db-credentials
                  key: username
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: vorion-db-credentials
                  key: password
            volumeMounts:
            - name: backup-storage
              mountPath: /backups
          volumes:
          - name: backup-storage
            persistentVolumeClaim:
              claimName: vorion-backups
          restartPolicy: OnFailure
```

---

## Redis Persistence

### Redis Persistence Options

| Method | Data Loss Risk | Performance Impact | Use Case |
|--------|----------------|-------------------|----------|
| RDB Snapshots | Up to snapshot interval | Low | General use |
| AOF | Minimal (fsync policy) | Medium | Data critical |
| RDB + AOF | Minimal | Medium | Production |

### RDB Configuration

```conf
# redis.conf - RDB snapshots
save 900 1      # Save after 900 sec if 1 key changed
save 300 10     # Save after 300 sec if 10 keys changed
save 60 10000   # Save after 60 sec if 10000 keys changed

dbfilename dump.rdb
dir /data/redis

# Compression
rdbcompression yes
rdbchecksum yes
```

### AOF Configuration

```conf
# redis.conf - Append Only File
appendonly yes
appendfilename "appendonly.aof"

# Sync policies:
# - always: Every write (safest, slowest)
# - everysec: Every second (recommended)
# - no: Let OS decide (fastest, least safe)
appendfsync everysec

# AOF rewrite triggers
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
```

### Redis Backup Script

```bash
#!/bin/bash
# Redis backup script

BACKUP_DIR="/backups/redis"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p "${BACKUP_DIR}"

# Trigger RDB snapshot
redis-cli -h "${VORION_REDIS_HOST}" -a "${VORION_REDIS_PASSWORD}" BGSAVE

# Wait for save to complete
while [ $(redis-cli -h "${VORION_REDIS_HOST}" -a "${VORION_REDIS_PASSWORD}" LASTSAVE) == $(redis-cli -h "${VORION_REDIS_HOST}" -a "${VORION_REDIS_PASSWORD}" LASTSAVE) ]; do
  sleep 1
done

# Copy RDB file
kubectl cp redis-0:/data/dump.rdb "${BACKUP_DIR}/redis_${TIMESTAMP}.rdb"

# Copy AOF if enabled
kubectl cp redis-0:/data/appendonly.aof "${BACKUP_DIR}/redis_${TIMESTAMP}.aof" 2>/dev/null || true

echo "Redis backup completed: ${BACKUP_DIR}/redis_${TIMESTAMP}.rdb"
```

### Redis Restore Procedure

```bash
#!/bin/bash
# Redis restore script

BACKUP_FILE="${1:-/backups/redis/latest.rdb}"

# Stop Redis
kubectl scale statefulset/redis --replicas=0

# Copy backup to data directory
kubectl cp "${BACKUP_FILE}" redis-0:/data/dump.rdb

# Restart Redis
kubectl scale statefulset/redis --replicas=1

# Verify data
redis-cli -h "${VORION_REDIS_HOST}" -a "${VORION_REDIS_PASSWORD}" DBSIZE
```

### Redis Sentinel Backup Considerations

When using Redis Sentinel:
1. Identify the current master: `SENTINEL get-master-addr-by-name mymaster`
2. Perform backup from master to ensure consistency
3. After restore, reinitialize Sentinel configuration if needed

---

## Secret Rotation

### Secrets Requiring Rotation

| Secret | Rotation Frequency | Impact |
|--------|-------------------|--------|
| `VORION_JWT_SECRET` | 90 days | All JWTs invalidated |
| `VORION_ENCRYPTION_KEY` | Yearly | Requires data re-encryption |
| `VORION_DB_PASSWORD` | 90 days | Database reconnection |
| `VORION_REDIS_PASSWORD` | 90 days | Redis reconnection |
| `VORION_DEDUPE_SECRET` | 90 days | Deduplication window reset |
| `VORION_CSRF_SECRET` | 90 days | CSRF tokens invalidated |

### JWT Secret Rotation

JWT rotation requires a rolling deployment strategy to avoid authentication disruption:

```bash
#!/bin/bash
# JWT secret rotation script

# 1. Generate new secret
NEW_JWT_SECRET=$(openssl rand -base64 64)

# 2. Update Kubernetes secret (create new version)
kubectl create secret generic vorion-secrets-v2 \
  --from-literal=jwt-secret="${NEW_JWT_SECRET}" \
  --from-literal=encryption-key="${VORION_ENCRYPTION_KEY}"

# 3. Update deployment to use new secret
kubectl set env deployment/vorion \
  --from=secret/vorion-secrets-v2

# 4. Rolling restart (maintains availability)
kubectl rollout restart deployment/vorion

# 5. Monitor rollout
kubectl rollout status deployment/vorion

# 6. After successful rollout, remove old secret
kubectl delete secret vorion-secrets-v1

echo "JWT secret rotation completed"
```

### Encryption Key Rotation

**Warning**: Encryption key rotation requires re-encrypting existing data.

```bash
#!/bin/bash
# Encryption key rotation (requires maintenance window)

# 1. Generate new encryption key and salt
NEW_ENCRYPTION_KEY=$(openssl rand -base64 32)
NEW_ENCRYPTION_SALT=$(openssl rand -base64 16)

# 2. Scale down to single instance
kubectl scale deployment/vorion --replicas=1

# 3. Run data migration script (custom application code required)
kubectl exec -it vorion-0 -- npm run migrate:encryption \
  --old-key="${VORION_ENCRYPTION_KEY}" \
  --new-key="${NEW_ENCRYPTION_KEY}" \
  --old-salt="${VORION_ENCRYPTION_SALT}" \
  --new-salt="${NEW_ENCRYPTION_SALT}"

# 4. Update secrets
kubectl create secret generic vorion-encryption-v2 \
  --from-literal=encryption-key="${NEW_ENCRYPTION_KEY}" \
  --from-literal=encryption-salt="${NEW_ENCRYPTION_SALT}"

# 5. Update deployment
kubectl set env deployment/vorion \
  VORION_ENCRYPTION_KEY="${NEW_ENCRYPTION_KEY}" \
  VORION_ENCRYPTION_SALT="${NEW_ENCRYPTION_SALT}"

# 6. Scale back up
kubectl scale deployment/vorion --replicas=3

echo "Encryption key rotation completed"
```

### Database Password Rotation

```bash
#!/bin/bash
# Database password rotation

# 1. Generate new password
NEW_DB_PASSWORD=$(openssl rand -base64 32)

# 2. Update PostgreSQL user password
psql -h "${VORION_DB_HOST}" -U postgres << EOF
ALTER USER ${VORION_DB_USER} WITH PASSWORD '${NEW_DB_PASSWORD}';
EOF

# 3. Update Kubernetes secret
kubectl create secret generic vorion-db-credentials-v2 \
  --from-literal=password="${NEW_DB_PASSWORD}"

# 4. Rolling restart
kubectl set env deployment/vorion \
  VORION_DB_PASSWORD="${NEW_DB_PASSWORD}"

kubectl rollout restart deployment/vorion
kubectl rollout status deployment/vorion

echo "Database password rotation completed"
```

### Redis Password Rotation

```bash
#!/bin/bash
# Redis password rotation

# 1. Generate new password
NEW_REDIS_PASSWORD=$(openssl rand -base64 32)

# 2. Update Redis password (requires restart)
kubectl exec -it redis-0 -- redis-cli CONFIG SET requirepass "${NEW_REDIS_PASSWORD}"

# 3. Update Kubernetes secret and deployment
kubectl set env deployment/vorion \
  VORION_REDIS_PASSWORD="${NEW_REDIS_PASSWORD}"

# 4. Rolling restart
kubectl rollout restart deployment/vorion

echo "Redis password rotation completed"
```

---

## Disaster Recovery

### Recovery Time Objectives (RTO) and Recovery Point Objectives (RPO)

| Scenario | Target RTO | Target RPO | Strategy |
|----------|-----------|-----------|----------|
| Single Pod Failure | < 1 min | 0 | Kubernetes auto-recovery |
| Database Failure | < 15 min | < 1 hour | Restore from backup |
| Redis Failure | < 5 min | < 5 min | Replica promotion or restore |
| Full Zone Outage | < 30 min | < 1 hour | Multi-zone deployment |
| Complete Cluster Loss | < 2 hours | < 1 hour | Cross-region restore |

### Disaster Recovery Checklist

#### Preparation
- [ ] Regular backup verification (weekly)
- [ ] Documented runbooks (this document)
- [ ] Tested restore procedures (quarterly)
- [ ] Multi-zone/region deployment
- [ ] Infrastructure as Code (reproducible setup)
- [ ] Monitoring and alerting configured

#### During Incident
- [ ] Assess scope of failure
- [ ] Communicate to stakeholders
- [ ] Execute appropriate recovery procedure
- [ ] Verify service restoration
- [ ] Document timeline and actions

#### Post-Incident
- [ ] Root cause analysis
- [ ] Update runbooks if needed
- [ ] Address any gaps identified
- [ ] Schedule follow-up review

### Full Cluster Recovery

```bash
#!/bin/bash
# Full cluster disaster recovery

# Prerequisites:
# - Access to backup storage
# - Target Kubernetes cluster ready
# - Terraform/IaC for infrastructure

# 1. Provision infrastructure
terraform apply -var-file=production.tfvars

# 2. Deploy PostgreSQL
helm install postgresql bitnami/postgresql \
  --set auth.postgresPassword="${POSTGRES_ADMIN_PASSWORD}" \
  --set auth.database=vorion \
  --set auth.username=vorion \
  --set auth.password="${VORION_DB_PASSWORD}"

# 3. Wait for PostgreSQL to be ready
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=postgresql --timeout=300s

# 4. Restore database from latest backup
LATEST_BACKUP=$(ls -t /backups/vorion/*.dump | head -1)
pg_restore -h postgresql -U postgres -d vorion "${LATEST_BACKUP}"

# 5. Deploy Redis
helm install redis bitnami/redis \
  --set auth.password="${VORION_REDIS_PASSWORD}"

# 6. Restore Redis data if needed
kubectl cp /backups/redis/latest.rdb redis-master-0:/data/dump.rdb
kubectl exec redis-master-0 -- redis-cli DEBUG RELOAD

# 7. Deploy Vorion application
kubectl apply -f kubernetes/vorion-deployment.yaml

# 8. Verify health
kubectl wait --for=condition=ready pod -l app=vorion --timeout=300s
curl -s http://vorion:3000/health/detailed | jq '.status'

echo "Disaster recovery completed"
```

### Cross-Region Failover

For cross-region deployments:

1. **Primary Region Down**: DNS failover to secondary
2. **Database**: Use read replica promotion or restore from backup
3. **Application**: Deploy from container registry
4. **Configuration**: Use centralized secret management (Vault, AWS Secrets Manager)

---

## Data Retention Policies

### Retention Configuration

```bash
# Intent events (default: 90 days)
VORION_INTENT_EVENT_RETENTION_DAYS=90

# Soft-deleted data (default: 30 days)
VORION_INTENT_SOFT_DELETE_RETENTION_DAYS=30

# Audit logs (default: 365 days, minimum: 30 days)
VORION_AUDIT_RETENTION_DAYS=365

# Archive audit logs before deletion (default: 90 days)
VORION_AUDIT_ARCHIVE_AFTER_DAYS=90

# Proof storage (default: 2555 days / 7 years)
VORION_PROOF_RETENTION_DAYS=2555
```

### Automated Cleanup

Vorion runs automated cleanup jobs:

```bash
# Intent cleanup schedule (default: 2 AM daily)
VORION_INTENT_CLEANUP_CRON="0 2 * * *"

# Timeout check schedule (default: every 5 minutes)
VORION_INTENT_TIMEOUT_CHECK_CRON="*/5 * * * *"

# Audit cleanup batch size
VORION_AUDIT_CLEANUP_BATCH_SIZE=1000
```

### Manual Cleanup (Emergency)

```bash
# Manually trigger cleanup for specific tenant
kubectl exec -it vorion-0 -- npm run cleanup:intents \
  --tenant-id=tenant-123 \
  --older-than=30d

# Cleanup dead letter queue
kubectl exec -it vorion-0 -- npm run cleanup:dead-letter
```

### Compliance Considerations

| Regulation | Minimum Retention | Maximum Retention |
|------------|-------------------|-------------------|
| GDPR | As needed | Minimize |
| SOX | 7 years | - |
| HIPAA | 6 years | - |
| PCI-DSS | 1 year | - |

Adjust retention settings based on your compliance requirements:

```bash
# For financial compliance (7 year retention)
VORION_AUDIT_RETENTION_DAYS=2555
VORION_PROOF_RETENTION_DAYS=2555
VORION_AUDIT_ARCHIVE_ENABLED=true
```
