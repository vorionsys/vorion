# Disaster Recovery Policy

**Document ID:** P0-005
**Version:** 1.0
**Last Updated:** 2026-02-04
**Classification:** Internal
**Owner:** Platform Engineering Team

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Recovery Objectives](#recovery-objectives)
3. [Architecture Overview](#architecture-overview)
4. [DR Runbook](#dr-runbook)
   - [Database Failover](#database-failover)
   - [Application Failover](#application-failover)
   - [Full Site Recovery](#full-site-recovery)
5. [Component Failover Procedures](#component-failover-procedures)
6. [Communication Plan](#communication-plan)
7. [Testing Schedule](#testing-schedule)
8. [Appendices](#appendices)

---

## Executive Summary

This document defines the Disaster Recovery (DR) policy for the Vorion platform. It establishes recovery objectives, documents failover procedures for all critical components, and outlines the testing schedule to ensure business continuity.

### Scope

This policy covers:
- Vorion API services (Kubernetes deployments)
- PostgreSQL database (RDS Multi-AZ / self-hosted)
- Redis cache (ElastiCache / self-hosted)
- Supporting infrastructure (VPC, EKS, S3)
- Backup and restore procedures

### Key Contacts

| Role | Name | Contact | Escalation Time |
|------|------|---------|-----------------|
| DR Coordinator | On-Call Lead | pagerduty://vorion-dr | Immediate |
| Database Admin | DBA Team | #dba-oncall | 5 minutes |
| Platform Lead | SRE Team | #sre-oncall | 10 minutes |
| Security Lead | Security Team | #security-oncall | 15 minutes |
| Executive Sponsor | VP Engineering | direct-escalation | 30 minutes |

---

## Recovery Objectives

### Recovery Time Objective (RTO)

**Target: < 4 hours**

| Scenario | Target RTO | Maximum RTO |
|----------|-----------|-------------|
| Single Pod Failure | < 1 minute | 2 minutes |
| Node Failure | < 5 minutes | 10 minutes |
| Availability Zone Failure | < 15 minutes | 30 minutes |
| Database Primary Failure | < 15 minutes | 30 minutes |
| Redis Primary Failure | < 5 minutes | 10 minutes |
| Full Region Failure | < 2 hours | 4 hours |
| Complete Infrastructure Loss | < 4 hours | 8 hours |

### Recovery Point Objective (RPO)

**Target: < 1 hour**

| Data Type | Target RPO | Maximum RPO | Backup Method |
|-----------|-----------|-------------|---------------|
| Database Transactions | < 5 minutes | 15 minutes | WAL Archiving + PITR |
| Database Full Backup | < 1 hour | 4 hours | Hourly pg_dump |
| Redis Session Data | < 5 minutes | 15 minutes | AOF + RDB |
| Application Logs | < 15 minutes | 1 hour | Streaming to S3 |
| Audit Trail | 0 (synchronous) | 0 | Synchronous replication |
| Proof Chain | 0 (synchronous) | 0 | Cryptographic verification |
| Configuration Files | < 1 hour | 4 hours | Git + Backup |

### Service Level Objectives During DR

| Metric | Normal SLO | DR SLO | Notes |
|--------|-----------|--------|-------|
| Availability | 99.9% | 99.0% | Reduced during failover |
| P95 Latency | < 500ms | < 2000ms | Temporary degradation acceptable |
| Error Rate | < 0.1% | < 5% | Higher errors during transition |

---

## Architecture Overview

### Production Architecture

```
                                    ┌─────────────────────────────────────────────────┐
                                    │              AWS Region (us-east-1)              │
                                    │                                                  │
┌─────────────┐                     │  ┌─────────────────────────────────────────┐    │
│   Users     │──────────────────────▶│            Route 53 / CloudFront        │    │
└─────────────┘                     │  └─────────────────────────────────────────┘    │
                                    │                      │                          │
                                    │  ┌───────────────────┼───────────────────┐      │
                                    │  │    AZ-A           │         AZ-B      │      │
                                    │  │                   ▼                   │      │
                                    │  │  ┌───────────────────────────────┐    │      │
                                    │  │  │   Application Load Balancer   │    │      │
                                    │  │  └───────────────────────────────┘    │      │
                                    │  │           │               │           │      │
                                    │  │           ▼               ▼           │      │
                                    │  │  ┌─────────────┐ ┌─────────────┐      │      │
                                    │  │  │ Vorion API  │ │ Vorion API  │      │      │
                                    │  │  │ (Replica 1) │ │ (Replica 2) │      │      │
                                    │  │  └─────────────┘ └─────────────┘      │      │
                                    │  │           │               │           │      │
                                    │  │           ▼               ▼           │      │
                                    │  │  ┌─────────────┐ ┌─────────────┐      │      │
                                    │  │  │  PostgreSQL │ │  PostgreSQL │      │      │
                                    │  │  │  (Primary)  │ │  (Standby)  │      │      │
                                    │  │  └─────────────┘ └─────────────┘      │      │
                                    │  │           │               │           │      │
                                    │  │           ▼               ▼           │      │
                                    │  │  ┌─────────────┐ ┌─────────────┐      │      │
                                    │  │  │   Redis     │ │   Redis     │      │      │
                                    │  │  │  (Primary)  │ │  (Replica)  │      │      │
                                    │  │  └─────────────┘ └─────────────┘      │      │
                                    │  │                                       │      │
                                    │  └───────────────────────────────────────┘      │
                                    │                                                  │
                                    │  ┌───────────────────────────────────────┐      │
                                    │  │              Backup Storage            │      │
                                    │  │         S3 (Cross-Region Replication)  │      │
                                    │  └───────────────────────────────────────┘      │
                                    └─────────────────────────────────────────────────┘
```

### Component Inventory

| Component | Deployment | HA Configuration | Failover Mechanism |
|-----------|-----------|-----------------|-------------------|
| Vorion API | Kubernetes (EKS) | 5 replicas across AZs | Pod auto-restart, HPA |
| PostgreSQL | RDS Multi-AZ | Synchronous standby | Automatic failover |
| Redis | ElastiCache | 2-node replication group | Automatic failover |
| Load Balancer | ALB | Multi-AZ | AWS managed |
| DNS | Route 53 | Active-passive | Health check failover |
| Backups | S3 | Cross-region replication | Manual restore |

---

## DR Runbook

### Pre-Incident Preparation

Before any DR event, ensure the following are in place:

- [ ] Access to AWS Console and kubectl configured
- [ ] DR runbook accessible (offline copy available)
- [ ] Backup verification completed within last 7 days
- [ ] Communication channels established
- [ ] On-call personnel identified and available

### Database Failover

#### Scenario 1: RDS Primary Failure (Automatic)

AWS RDS Multi-AZ handles automatic failover. Monitor and verify:

```bash
# 1. Check RDS event logs
aws rds describe-events \
  --source-identifier atsf-db \
  --source-type db-instance \
  --duration 60

# 2. Verify new primary endpoint (should be same DNS)
aws rds describe-db-instances \
  --db-instance-identifier atsf-db \
  --query 'DBInstances[0].Endpoint'

# 3. Verify application connectivity
kubectl exec -it $(kubectl get pod -l app=vorion -o jsonpath='{.items[0].metadata.name}') \
  -- npm run db:check

# 4. Check application health
curl -s https://api.vorion.com/health/ready | jq '.database'
```

**Expected Duration:** 1-2 minutes (automatic)

#### Scenario 2: Database Corruption / Manual Failover

```bash
#!/bin/bash
# Database manual failover procedure
set -euo pipefail

echo "=== Database Failover Procedure ==="
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="/var/log/vorion/dr-failover-${TIMESTAMP}.log"

# Step 1: Assess the situation
echo "Step 1: Assessing database status..."
aws rds describe-db-instances --db-instance-identifier atsf-db

# Step 2: Scale down application (prevent writes to corrupted DB)
echo "Step 2: Scaling down application to prevent further damage..."
kubectl scale deployment vorion-api --replicas=0 -n vorion

# Step 3: Determine recovery point
echo "Step 3: Listing available recovery points..."
aws rds describe-db-snapshots \
  --db-instance-identifier atsf-db \
  --query 'DBSnapshots[*].[DBSnapshotIdentifier,SnapshotCreateTime]' \
  --output table

# List PITR recovery window
aws rds describe-db-instances \
  --db-instance-identifier atsf-db \
  --query 'DBInstances[0].[LatestRestorableTime,EarliestRestorableTime]'

# Step 4: Restore from snapshot or PITR
echo "Step 4: Initiating restore..."
# Option A: Restore from snapshot
# aws rds restore-db-instance-from-db-snapshot \
#   --db-instance-identifier atsf-db-restored \
#   --db-snapshot-identifier <snapshot-id> \
#   --db-subnet-group-name atsf-db-subnet \
#   --vpc-security-group-ids <security-group-id>

# Option B: Point-in-time recovery
# aws rds restore-db-instance-to-point-in-time \
#   --source-db-instance-identifier atsf-db \
#   --target-db-instance-identifier atsf-db-restored \
#   --restore-time "2026-02-04T10:30:00Z" \
#   --db-subnet-group-name atsf-db-subnet

# Step 5: Wait for restore completion
echo "Step 5: Waiting for restore to complete..."
aws rds wait db-instance-available --db-instance-identifier atsf-db-restored

# Step 6: Update application configuration
echo "Step 6: Updating application to use restored database..."
# Update Kubernetes secret with new endpoint
kubectl create secret generic vorion-db-credentials \
  --from-literal=host=atsf-db-restored.xxx.us-east-1.rds.amazonaws.com \
  --from-literal=password="${DB_PASSWORD}" \
  --dry-run=client -o yaml | kubectl apply -f -

# Step 7: Scale up application
echo "Step 7: Scaling up application..."
kubectl scale deployment vorion-api --replicas=5 -n vorion

# Step 8: Verify health
echo "Step 8: Verifying application health..."
kubectl wait --for=condition=ready pod -l app=vorion -n vorion --timeout=300s
curl -s https://api.vorion.com/health/detailed | jq

echo "=== Database failover complete ==="
```

**Expected Duration:** 15-30 minutes

#### Scenario 3: Full Database Restore from Backup

```bash
#!/bin/bash
# Full database restore from backup file
set -euo pipefail

BACKUP_FILE="${1:-}"
if [[ -z "$BACKUP_FILE" ]]; then
  # Find latest backup
  BACKUP_FILE=$(aws s3 ls s3://atsf-backups-production/database/ \
    --recursive | sort | tail -1 | awk '{print $4}')
fi

echo "Restoring from backup: ${BACKUP_FILE}"

# 1. Download backup
echo "Downloading backup..."
aws s3 cp "s3://atsf-backups-production/${BACKUP_FILE}" /tmp/restore.dump

# 2. Verify backup integrity
echo "Verifying backup integrity..."
sha256sum /tmp/restore.dump
pg_restore --list /tmp/restore.dump > /dev/null

# 3. Scale down application
kubectl scale deployment vorion-api --replicas=0 -n vorion

# 4. Create new database (if needed)
psql -h "${DB_HOST}" -U postgres -c "CREATE DATABASE vorion_restored;"

# 5. Restore database
pg_restore \
  -h "${DB_HOST}" \
  -p 5432 \
  -U "${DB_USER}" \
  -d vorion_restored \
  -c \
  --if-exists \
  -j 4 \
  /tmp/restore.dump

# 6. Swap databases
psql -h "${DB_HOST}" -U postgres << EOF
ALTER DATABASE vorion RENAME TO vorion_old;
ALTER DATABASE vorion_restored RENAME TO vorion;
EOF

# 7. Scale up application
kubectl scale deployment vorion-api --replicas=5 -n vorion

# 8. Cleanup
rm /tmp/restore.dump

echo "Database restore complete"
```

**Expected Duration:** 30-60 minutes depending on backup size

---

### Application Failover

#### Scenario 1: Single Pod Failure

Kubernetes handles this automatically via:
- Liveness probe failures trigger pod restart
- Readiness probe failures remove pod from service

**No manual intervention required.**

Monitor with:
```bash
# Watch pod status
kubectl get pods -l app=vorion -n vorion -w

# Check recent events
kubectl get events -n vorion --sort-by='.lastTimestamp' | tail -20

# View pod restart count
kubectl get pods -l app=vorion -n vorion \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.containerStatuses[0].restartCount}{"\n"}{end}'
```

#### Scenario 2: Node Failure

Kubernetes reschedules pods to healthy nodes automatically.

**Manual intervention if pods stuck:**
```bash
# 1. Identify affected node
kubectl get nodes
kubectl describe node <failing-node>

# 2. Cordon node to prevent new scheduling
kubectl cordon <failing-node>

# 3. Drain node (gracefully evict pods)
kubectl drain <failing-node> --ignore-daemonsets --delete-emptydir-data

# 4. If pods stuck in Terminating state
kubectl get pods -n vorion -o wide | grep <failing-node>
kubectl delete pod <pod-name> -n vorion --force --grace-period=0

# 5. Once node is replaced, uncordon
kubectl uncordon <new-node>
```

#### Scenario 3: Full Deployment Failure

```bash
#!/bin/bash
# Application deployment recovery
set -euo pipefail

echo "=== Application Recovery Procedure ==="

# 1. Check deployment status
echo "Checking deployment status..."
kubectl get deployment vorion-api -n vorion
kubectl describe deployment vorion-api -n vorion

# 2. Check for image pull issues
kubectl get events -n vorion --field-selector reason=Failed

# 3. Rollback to last known good version (if bad deployment)
echo "Rolling back to previous version..."
kubectl rollout undo deployment/vorion-api -n vorion

# 4. Wait for rollout
kubectl rollout status deployment/vorion-api -n vorion --timeout=300s

# 5. If rollback fails, deploy from scratch
if [[ $? -ne 0 ]]; then
  echo "Rollback failed, deploying from manifest..."

  # Apply baseline manifests
  kubectl apply -k deploy/kubernetes/overlays/production/

  # Or use Helm
  # helm upgrade --install vorion ./deploy/kubernetes/helm/vorion \
  #   -f values.yaml -f values-production.yaml \
  #   --namespace vorion
fi

# 6. Verify health
echo "Verifying application health..."
kubectl wait --for=condition=ready pod -l app=vorion -n vorion --timeout=300s

# 7. Run smoke tests
echo "Running smoke tests..."
curl -f https://api.vorion.com/health/live || exit 1
curl -f https://api.vorion.com/health/ready || exit 1

echo "=== Application recovery complete ==="
```

**Expected Duration:** 5-15 minutes

---

### Full Site Recovery

#### Scenario: Complete Region/Cluster Loss

This procedure recovers the entire Vorion platform from scratch.

```bash
#!/bin/bash
# Full site disaster recovery procedure
set -euo pipefail

REGION="${1:-us-west-2}"  # DR region
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "=============================================="
echo "VORION FULL SITE RECOVERY"
echo "Target Region: ${REGION}"
echo "Timestamp: ${TIMESTAMP}"
echo "=============================================="

# Phase 1: Infrastructure Provisioning (30-60 minutes)
echo ""
echo "=== PHASE 1: Infrastructure Provisioning ==="
echo ""

# 1.1 Initialize Terraform for DR region
cd /path/to/terraform/dr-region
terraform init

# 1.2 Apply infrastructure
terraform apply -var="region=${REGION}" -auto-approve

# 1.3 Configure kubectl
aws eks update-kubeconfig --name atsf-cluster --region ${REGION}

# 1.4 Verify cluster
kubectl cluster-info
kubectl get nodes

echo "Infrastructure provisioning complete."

# Phase 2: Database Recovery (30-45 minutes)
echo ""
echo "=== PHASE 2: Database Recovery ==="
echo ""

# 2.1 Find latest backup
LATEST_DB_BACKUP=$(aws s3 ls s3://atsf-backups-production/database/ \
  --region us-east-1 --recursive | sort | tail -1 | awk '{print $4}')
echo "Latest backup: ${LATEST_DB_BACKUP}"

# 2.2 Download backup to DR region
aws s3 cp "s3://atsf-backups-production/${LATEST_DB_BACKUP}" \
  "s3://atsf-backups-dr/database/${LATEST_DB_BACKUP}" \
  --source-region us-east-1 \
  --region ${REGION}

# 2.3 Deploy PostgreSQL in DR region
helm install postgresql bitnami/postgresql \
  --namespace vorion \
  --create-namespace \
  --set auth.database=vorion \
  --set auth.username=vorion \
  --set auth.password="${DB_PASSWORD}" \
  --set primary.persistence.size=100Gi

# 2.4 Wait for PostgreSQL
kubectl wait --for=condition=ready pod \
  -l app.kubernetes.io/name=postgresql \
  -n vorion --timeout=300s

# 2.5 Restore database
kubectl run pg-restore --rm -it --restart=Never \
  --namespace vorion \
  --image=postgres:15 \
  --env="PGPASSWORD=${DB_PASSWORD}" \
  -- bash -c "
    aws s3 cp s3://atsf-backups-dr/database/${LATEST_DB_BACKUP} /tmp/backup.dump
    pg_restore -h postgresql -U vorion -d vorion -c --if-exists /tmp/backup.dump
  "

echo "Database recovery complete."

# Phase 3: Redis Recovery (10-15 minutes)
echo ""
echo "=== PHASE 3: Redis Recovery ==="
echo ""

# 3.1 Deploy Redis
helm install redis bitnami/redis \
  --namespace vorion \
  --set auth.password="${REDIS_PASSWORD}" \
  --set replica.replicaCount=2

# 3.2 Wait for Redis
kubectl wait --for=condition=ready pod \
  -l app.kubernetes.io/name=redis \
  -n vorion --timeout=300s

# 3.3 Restore Redis data (if available)
LATEST_REDIS_BACKUP=$(aws s3 ls s3://atsf-backups-production/redis/ \
  --region us-east-1 --recursive | sort | tail -1 | awk '{print $4}')

if [[ -n "${LATEST_REDIS_BACKUP}" ]]; then
  kubectl cp "/tmp/redis_backup.rdb" redis-master-0:/data/dump.rdb -n vorion
  kubectl exec redis-master-0 -n vorion -- redis-cli DEBUG RELOAD
fi

echo "Redis recovery complete."

# Phase 4: Application Deployment (15-20 minutes)
echo ""
echo "=== PHASE 4: Application Deployment ==="
echo ""

# 4.1 Create namespace and secrets
kubectl create namespace vorion --dry-run=client -o yaml | kubectl apply -f -

# 4.2 Create secrets
kubectl create secret generic vorion-secrets \
  --namespace vorion \
  --from-literal=DB_PASSWORD="${DB_PASSWORD}" \
  --from-literal=REDIS_PASSWORD="${REDIS_PASSWORD}" \
  --from-literal=JWT_SECRET="${JWT_SECRET}" \
  --from-literal=ENCRYPTION_KEY="${ENCRYPTION_KEY}"

# 4.3 Deploy application
kubectl apply -k deploy/kubernetes/overlays/production/ -n vorion

# Or use Helm
# helm install vorion ./deploy/kubernetes/helm/vorion \
#   -f values.yaml -f values-production.yaml \
#   --namespace vorion

# 4.4 Wait for deployment
kubectl rollout status deployment/vorion-api -n vorion --timeout=600s

echo "Application deployment complete."

# Phase 5: DNS Cutover (5-10 minutes)
echo ""
echo "=== PHASE 5: DNS Cutover ==="
echo ""

# 5.1 Get new load balancer endpoint
NEW_ALB=$(kubectl get ingress vorion-api -n vorion \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo "New ALB endpoint: ${NEW_ALB}"

# 5.2 Update Route 53 (or notify DNS team)
echo "Update DNS record for api.vorion.com to point to: ${NEW_ALB}"
echo "Manual step required or use:"
echo ""
echo "aws route53 change-resource-record-sets \\"
echo "  --hosted-zone-id <ZONE_ID> \\"
echo "  --change-batch '{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"api.vorion.com\",\"Type\":\"CNAME\",\"TTL\":60,\"ResourceRecords\":[{\"Value\":\"${NEW_ALB}\"}]}}]}'"

# Phase 6: Verification (10-15 minutes)
echo ""
echo "=== PHASE 6: Verification ==="
echo ""

# 6.1 Health checks
echo "Running health checks..."
sleep 60  # Wait for DNS propagation

curl -f https://api.vorion.com/health/live || echo "WARN: Live check failed"
curl -f https://api.vorion.com/health/ready || echo "WARN: Ready check failed"

# 6.2 Detailed health
curl -s https://api.vorion.com/health/detailed | jq

# 6.3 Database connectivity
kubectl exec -it $(kubectl get pod -l app=vorion -o jsonpath='{.items[0].metadata.name}' -n vorion) \
  -n vorion -- npm run db:check

# 6.4 Run integration tests
# npm run test:integration:smoke

echo ""
echo "=============================================="
echo "FULL SITE RECOVERY COMPLETE"
echo "Total estimated time: 2-4 hours"
echo "=============================================="
```

**Expected Duration:** 2-4 hours

---

## Component Failover Procedures

### Redis Failover

#### Automatic Failover (ElastiCache)

ElastiCache with Multi-AZ handles automatic failover. Monitor:

```bash
# Check replication group status
aws elasticache describe-replication-groups \
  --replication-group-id atsf-redis

# Check failover events
aws elasticache describe-events \
  --source-type replication-group \
  --duration 60
```

#### Manual Redis Failover

```bash
#!/bin/bash
# Manual Redis failover procedure

# 1. Check current master
redis-cli -h ${REDIS_HOST} -a ${REDIS_PASSWORD} INFO replication

# 2. For ElastiCache, initiate failover
aws elasticache modify-replication-group \
  --replication-group-id atsf-redis \
  --primary-cluster-id atsf-redis-002 \
  --apply-immediately

# 3. For self-hosted Redis Sentinel
redis-cli -h ${SENTINEL_HOST} -p 26379 SENTINEL failover mymaster

# 4. Verify new master
redis-cli -h ${REDIS_HOST} -a ${REDIS_PASSWORD} INFO replication

# 5. Verify application connectivity
kubectl exec -it $(kubectl get pod -l app=vorion -o jsonpath='{.items[0].metadata.name}') \
  -- npm run redis:check
```

### Load Balancer Failover

For ALB issues:

```bash
# 1. Check ALB health
aws elbv2 describe-load-balancers --names vorion-alb

# 2. Check target group health
aws elbv2 describe-target-health \
  --target-group-arn <target-group-arn>

# 3. If ALB is unhealthy, create replacement
aws elbv2 create-load-balancer \
  --name vorion-alb-dr \
  --subnets <subnet-ids> \
  --security-groups <security-group-ids>

# 4. Register targets
aws elbv2 register-targets \
  --target-group-arn <new-target-group-arn> \
  --targets <instance-ids>

# 5. Update DNS to new ALB
```

### Certificate/TLS Failover

```bash
# 1. Check certificate status
kubectl get certificate -n vorion

# 2. If certificate expired, force renewal
kubectl delete secret vorion-api-tls -n vorion
kubectl annotate certificate vorion-api-tls \
  cert-manager.io/issuer-name=letsencrypt-prod --overwrite

# 3. Verify new certificate
kubectl describe certificate vorion-api-tls -n vorion
```

---

## Communication Plan

### Incident Severity Levels

| Severity | Description | Response Time | Communication |
|----------|-------------|---------------|---------------|
| SEV1 | Complete service outage | < 15 minutes | All stakeholders |
| SEV2 | Major feature degradation | < 30 minutes | Affected teams |
| SEV3 | Minor service impact | < 2 hours | Operations team |
| SEV4 | No user impact | < 24 hours | Engineering team |

### Communication Channels

| Channel | Purpose | Audience |
|---------|---------|----------|
| PagerDuty | On-call alerting | Engineering |
| Slack #incidents | Real-time coordination | All responders |
| Slack #status | Status updates | All employees |
| StatusPage | External communication | Customers |
| Email | Formal notifications | Executives, legal |

### Communication Templates

#### Initial Notification (SEV1/SEV2)

```
INCIDENT DECLARED: [Brief description]
Severity: [SEV1/SEV2]
Time: [UTC timestamp]
Impact: [User-facing impact description]
Current Status: [Investigating/Identified/Mitigating]
Incident Commander: [Name]
Next Update: [Time]
```

#### Ongoing Updates

```
INCIDENT UPDATE: [Brief description]
Time: [UTC timestamp]
Status Change: [Previous status] -> [Current status]
Actions Taken: [List of actions]
Current Impact: [Updated impact assessment]
ETA to Resolution: [Estimate or Unknown]
Next Update: [Time]
```

#### Resolution Notification

```
INCIDENT RESOLVED: [Brief description]
Resolution Time: [UTC timestamp]
Duration: [Total duration]
Root Cause: [Brief description]
Resolution: [What fixed it]
Follow-up: [Post-incident review scheduled for DATE]
```

### Escalation Matrix

| Time Elapsed | Action | Contacts |
|--------------|--------|----------|
| 0 minutes | Alert on-call engineer | Primary on-call |
| 15 minutes | Escalate to backup | Secondary on-call |
| 30 minutes | Notify engineering lead | Team lead |
| 1 hour | Executive notification | VP Engineering |
| 2 hours | C-level briefing | CTO, CEO |

---

## Testing Schedule

### DR Test Types

| Test Type | Frequency | Duration | Participants |
|-----------|-----------|----------|--------------|
| Tabletop Exercise | Monthly | 2 hours | Core team |
| Component Failover | Quarterly | 4 hours | SRE + DBA |
| Full DR Test | Semi-annually | 8 hours | All engineering |
| Backup Restore | Weekly | 1 hour | Automated |
| Chaos Engineering | Weekly | Continuous | Automated |

### Quarterly DR Test Procedure

#### Pre-Test Checklist

- [ ] Schedule maintenance window
- [ ] Notify stakeholders
- [ ] Prepare test environment
- [ ] Document current baseline metrics
- [ ] Verify backup availability
- [ ] Confirm rollback procedures
- [ ] Identify test participants and roles

#### Test Scenarios

1. **Database Failover Test**
   - Simulate primary database failure
   - Verify automatic/manual failover
   - Measure actual RTO/RPO
   - Test application reconnection

2. **Application Failover Test**
   - Kill 50% of application pods
   - Verify auto-scaling response
   - Measure recovery time
   - Test load balancer behavior

3. **AZ Failure Simulation**
   - Cordon all nodes in one AZ
   - Verify pod rescheduling
   - Test cross-AZ database failover
   - Measure service impact

4. **Full Recovery Test**
   - Simulate complete cluster loss
   - Execute full site recovery procedure
   - Measure total recovery time
   - Verify data integrity

#### Post-Test Checklist

- [ ] Document actual RTO/RPO achieved
- [ ] Note any procedure gaps
- [ ] Update runbooks as needed
- [ ] Report findings to stakeholders
- [ ] Schedule remediation for issues found

### Weekly Automated Tests

```yaml
# Kubernetes CronJob for automated DR testing
apiVersion: batch/v1
kind: CronJob
metadata:
  name: vorion-dr-test
  namespace: vorion
spec:
  schedule: "0 3 * * 0"  # Sunday 3 AM UTC
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: dr-test
            image: vorion/dr-test:latest
            env:
            - name: TEST_TYPE
              value: "backup-restore-verification"
            - name: SLACK_WEBHOOK
              valueFrom:
                secretKeyRef:
                  name: vorion-secrets
                  key: SLACK_WEBHOOK
          restartPolicy: OnFailure
```

### Backup Verification Schedule

| Backup Type | Verification Frequency | Method |
|-------------|----------------------|--------|
| Database | Daily | Checksum + restore test |
| Redis | Daily | RDB validation |
| Configuration | Weekly | Git diff + apply test |
| Full System | Monthly | Complete restore to staging |

---

## Appendices

### Appendix A: Contact Information

| Role | Primary | Backup | Phone |
|------|---------|--------|-------|
| On-Call Engineer | pagerduty://vorion | N/A | Auto-routed |
| DBA | dba@vorion.com | dba-backup@vorion.com | +1-XXX-XXX-XXXX |
| SRE Lead | sre-lead@vorion.com | N/A | +1-XXX-XXX-XXXX |
| AWS Support | aws-support | N/A | Enterprise Support |

### Appendix B: Useful Commands

```bash
# Quick health check
kubectl get pods -n vorion
kubectl top pods -n vorion

# Database connection test
kubectl exec -it deploy/vorion-api -n vorion -- npm run db:check

# Redis connection test
kubectl exec -it deploy/vorion-api -n vorion -- npm run redis:check

# View recent logs
kubectl logs -l app=vorion -n vorion --tail=100 -f

# View events
kubectl get events -n vorion --sort-by='.lastTimestamp' | tail -30

# Force pod restart
kubectl rollout restart deployment/vorion-api -n vorion

# Scale deployment
kubectl scale deployment/vorion-api --replicas=N -n vorion
```

### Appendix C: Environment Variables

| Variable | Description | DR Considerations |
|----------|-------------|-------------------|
| `VORION_DB_HOST` | Database hostname | Update for failover |
| `VORION_REDIS_HOST` | Redis hostname | Update for failover |
| `VORION_JWT_SECRET` | JWT signing key | Must match across regions |
| `VORION_ENCRYPTION_KEY` | Data encryption key | Must match across regions |

### Appendix D: Related Documents

- [Backup and Restore Runbook](/docs/runbooks/backup-restore.md)
- [Incident Response Procedures](/docs/runbooks/incident-response.md)
- [Security Incident Response](/docs/security/incident-response.md)
- [Architecture Documentation](/docs/architecture/)

### Appendix E: Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-04 | Platform Team | Initial version |

---

## Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Author | Platform Team | | |
| Reviewer | SRE Lead | | |
| Approver | VP Engineering | | |
