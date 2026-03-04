# Vorion Data Model

This document describes the core entities, database schema, and relationships in the Vorion platform.

## Core Entities

### Intent

Represents a goal or action submitted by an AI agent for governance.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| tenantId | TEXT | Tenant identifier |
| entityId | UUID | Agent/entity making request |
| goal | TEXT | Action description |
| intentType | TEXT | Intent category (optional) |
| priority | INTEGER | Priority level (0-10) |
| status | ENUM | Current lifecycle state |
| context | JSONB | Evaluation context |
| metadata | JSONB | Additional metadata |
| trustSnapshot | JSONB | Trust state at creation |
| trustLevel | INTEGER | Trust tier (0-7) |
| trustScore | INTEGER | Trust score (0-1000) |
| correlationId | UUID | Distributed tracing ID |
| actionType | ENUM | read/write/delete/execute/communicate/transfer |
| resourceScope | TEXT[] | Resources accessed |
| dataSensitivity | ENUM | PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED |
| reversibility | ENUM | REVERSIBLE/PARTIALLY_REVERSIBLE/IRREVERSIBLE |
| expiresAt | TIMESTAMP | Auto-expiry time |
| createdAt | TIMESTAMP | Creation time |
| updatedAt | TIMESTAMP | Last modification |
| deletedAt | TIMESTAMP | Soft delete (GDPR) |

### Trust Record

Stores calculated trust scores for entities.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| entityId | TEXT | Entity identifier |
| score | INTEGER | Aggregate score (0-1000) |
| level | ENUM | Trust tier (0-7) |
| behavioralScore | DECIMAL | Behavioral component |
| complianceScore | DECIMAL | Compliance component |
| identityScore | DECIMAL | Identity component |
| contextScore | DECIMAL | Context component |
| signalCount | INTEGER | Total signals processed |
| lastCalculatedAt | TIMESTAMP | Last calculation time |
| lastActivityAt | TIMESTAMP | Last trust-positive activity |
| metadata | JSONB | Observability metadata |
| createdAt | TIMESTAMP | Record creation |
| updatedAt | TIMESTAMP | Last update |

### Trust Signal

Individual signals that contribute to trust calculation.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| entityId | TEXT | Entity this signal is for |
| type | TEXT | Signal type (e.g., behavioral.success) |
| value | DECIMAL | Signal value impact |
| weight | DECIMAL | Weight multiplier |
| source | TEXT | Source system |
| metadata | JSONB | Additional context |
| timestamp | TIMESTAMP | When recorded |

### Trust History

Historical record of trust score changes.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| entityId | TEXT | Entity identifier |
| score | INTEGER | New score |
| previousScore | INTEGER | Previous score |
| level | ENUM | New tier |
| previousLevel | ENUM | Previous tier |
| reason | TEXT | Change reason |
| signalId | UUID | Triggering signal (optional) |
| timestamp | TIMESTAMP | When changed |

### Escalation

Human-in-the-loop escalation requests.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| intentId | UUID | Related intent |
| tenantId | TEXT | Tenant identifier |
| reason | TEXT | Escalation reason |
| reasonCategory | ENUM | Category (trust_insufficient, high_risk, etc.) |
| escalatedTo | TEXT | Target reviewer/group |
| escalatedBy | TEXT | Who escalated |
| status | ENUM | pending/acknowledged/approved/rejected/timeout |
| resolvedBy | TEXT | Who resolved |
| resolvedAt | TIMESTAMP | Resolution time |
| resolutionNotes | TEXT | Resolution details |
| timeout | TEXT | ISO 8601 duration |
| timeoutAt | TIMESTAMP | When timeout occurs |
| acknowledgedAt | TIMESTAMP | When acknowledged |
| slaBreached | BOOLEAN | SLA violation flag |
| context | JSONB | Escalation context |
| metadata | JSONB | Additional data |

### Session

User session records.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Session identifier |
| userId | TEXT | User identifier |
| tenantId | TEXT | Tenant identifier |
| ipAddress | TEXT | Client IP |
| userAgent | TEXT | Browser/client info |
| deviceFingerprint | TEXT | Device fingerprint hash |
| createdAt | TIMESTAMP | Session start |
| expiresAt | TIMESTAMP | Session expiry |
| lastActivityAt | TIMESTAMP | Last activity |
| revoked | BOOLEAN | Revocation flag |
| revokedAt | TIMESTAMP | Revocation time |
| revokedBy | TEXT | Who revoked |
| revokedReason | TEXT | Revocation reason |
| metadata | JSONB | Session metadata |

### Role

RBAC role definitions.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| tenantId | TEXT | Tenant (null for system) |
| name | TEXT | Role name |
| description | TEXT | Role description |
| parentRoleId | UUID | Parent role for inheritance |
| isSystem | BOOLEAN | System role flag |
| isActive | BOOLEAN | Active status |
| metadata | JSONB | Additional data |
| createdAt | TIMESTAMP | Creation time |
| updatedAt | TIMESTAMP | Last update |

### User Consent

GDPR consent records.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| userId | TEXT | User identifier |
| tenantId | TEXT | Tenant identifier |
| consentType | TEXT | Consent category |
| granted | BOOLEAN | Consent status |
| grantedAt | TIMESTAMP | When granted |
| revokedAt | TIMESTAMP | When revoked |
| version | TEXT | Policy version |
| ipAddress | TEXT | Client IP |
| userAgent | TEXT | Browser info |
| createdAt | TIMESTAMP | Record creation |
| updatedAt | TIMESTAMP | Last update |

## Database Schema Overview

### Entity-Relationship Diagram

```
+------------------+       +------------------+       +------------------+
|     INTENTS      |       |   TRUST_RECORDS  |       |  TRUST_SIGNALS   |
+------------------+       +------------------+       +------------------+
| id          PK   |       | id          PK   |       | id          PK   |
| tenant_id        |       | entity_id   UK   |       | entity_id   FK   |
| entity_id        |       | score            |       | type             |
| goal             |       | level            |       | value            |
| status           |       | behavioral_score |       | weight           |
| context          |       | compliance_score |       | source           |
| ...              |       | identity_score   |       | timestamp        |
+--------+---------+       | context_score    |       +------------------+
         |                 | signal_count     |
         |                 +------------------+
         |
         |         +------------------+       +------------------+
         |         |    ESCALATIONS   |       |  AUDIT_RECORDS   |
         |         +------------------+       +------------------+
         +-------->| id          PK   |       | id          PK   |
                   | intent_id   FK   |       | tenant_id        |
                   | tenant_id        |       | event_type       |
                   | reason           |       | actor_id         |
                   | status           |       | target_id        |
                   | escalated_to     |       | action           |
                   | timeout_at       |       | outcome          |
                   +------------------+       | record_hash      |
                                              +------------------+

+------------------+       +------------------+       +------------------+
|      ROLES       |       | ROLE_PERMISSIONS |       |   USER_ROLES     |
+------------------+       +------------------+       +------------------+
| id          PK   |<------| id          PK   |       | id          PK   |
| tenant_id        |       | role_id     FK   |       | user_id          |
| name             |       | action           |       | role_id     FK   |
| parent_role_id   |       | resource         |       | tenant_id        |
| is_system        |       | conditions       |       | granted_at       |
+------------------+       +------------------+       | expires_at       |
                                                      +------------------+

+------------------+       +------------------+       +------------------+
|  USER_CONSENTS   |       | CONSENT_POLICIES |       |   MFA_RECORDS    |
+------------------+       +------------------+       +------------------+
| id          PK   |       | id          PK   |       | id          PK   |
| user_id          |       | tenant_id        |       | user_id          |
| tenant_id        |       | consent_type     |       | tenant_id        |
| consent_type     |       | version          |       | totp_secret      |
| granted          |       | content          |       | status           |
| version          |       | effective_from   |       | backup_codes     |
+------------------+       +------------------+       +------------------+
```

## Relationships

### Intent Relationships

```typescript
Intent --> IntentEvents (1:many)
Intent --> IntentEvaluations (1:many)
Intent --> Escalations (1:many)
Intent --> AuditRecords (1:many via targetId)
```

### Trust Relationships

```typescript
TrustRecord --> TrustSignals (1:many via entityId)
TrustRecord --> TrustHistory (1:many via entityId)
Entity --> TrustRecord (1:1 via entityId)
```

### RBAC Relationships

```typescript
Role --> RolePermissions (1:many)
Role --> UserRoles (1:many)
Role --> ServiceAccountRoles (1:many)
Role --> Role (self-reference via parentRoleId)
User --> UserRoles (1:many)
```

### Tenant Relationships

```typescript
Tenant --> TenantMemberships (1:many)
Tenant --> GroupMemberships (1:many)
User --> TenantMemberships (1:many)
User --> GroupMemberships (1:many)
```

## Key Indexes

### Performance Indexes

| Table | Index | Columns | Purpose |
|-------|-------|---------|---------|
| intents | tenant_created | (tenant_id, created_at) | List queries |
| intents | tenant_status | (tenant_id, status) | Active count |
| intents | correlation | (correlation_id) | Distributed tracing |
| trust_records | entity | (entity_id) | Score lookup |
| trust_signals | entity_time | (entity_id, timestamp) | Recent signals |
| audit_records | tenant_time | (tenant_id, event_time) | Compliance |
| audit_records | trace | (trace_id) | Tracing |
| escalations | tenant_status | (tenant_id, status, created_at) | Dashboard |
| escalations | timeout_status | (status, timeout_at) | Timeout processing |

### Unique Constraints

| Table | Constraint | Columns |
|-------|-----------|---------|
| intents | tenant_dedupe | (tenant_id, dedupe_hash) |
| roles | tenant_name | (tenant_id, name) |
| user_roles | user_role_tenant | (user_id, role_id, tenant_id) |
| role_permissions | role_action_resource | (role_id, action, resource) |
| user_consents | user_tenant_type | (user_id, tenant_id, consent_type) |
| group_memberships | tenant_user_group | (tenant_id, user_id, group_name) |

## Enums

### Intent Status

```sql
CREATE TYPE intent_status AS ENUM (
  'pending',
  'evaluating',
  'approved',
  'denied',
  'escalated',
  'executing',
  'completed',
  'failed',
  'cancelled'
);
```

### Escalation Status

```sql
CREATE TYPE escalation_status AS ENUM (
  'pending',
  'acknowledged',
  'approved',
  'rejected',
  'timeout',
  'cancelled'
);
```

### Action Type

```sql
CREATE TYPE action_type AS ENUM (
  'read',
  'write',
  'delete',
  'execute',
  'communicate',
  'transfer'
);
```

### Data Sensitivity

```sql
CREATE TYPE data_sensitivity AS ENUM (
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED'
);
```

### Audit Severity

```sql
CREATE TYPE audit_severity AS ENUM (
  'info',
  'warning',
  'error',
  'critical'
);
```

## JSONB Structures

### Intent Context

```json
{
  "type": "financial_transfer",
  "amount": 1000,
  "currency": "USD",
  "destination": "account-xyz",
  "approvalRequired": true,
  "riskFactors": ["high_amount", "new_recipient"]
}
```

### Trust Snapshot

```json
{
  "score": 750,
  "level": 4,
  "components": {
    "behavioral": 0.8,
    "compliance": 0.7,
    "identity": 0.9,
    "context": 0.6
  },
  "calculatedAt": "2026-02-04T10:00:00Z"
}
```

### Audit Metadata

```json
{
  "requestId": "req-123",
  "traceId": "trace-456",
  "spanId": "span-789",
  "tags": ["security", "authentication"],
  "custom": {
    "loginMethod": "sso",
    "mfaUsed": true
  }
}
```

### Role Conditions

```json
{
  "ownerOnly": true,
  "maxAmount": 10000,
  "allowedRegions": ["us-east", "eu-west"],
  "timeRestriction": {
    "start": "09:00",
    "end": "17:00",
    "timezone": "UTC"
  }
}
```

## Data Retention

### GDPR Compliance

| Data Type | Retention | Purge Method |
|-----------|-----------|--------------|
| Intent data | 90 days | Soft delete + hard purge |
| Audit logs | 7 years | Archive to cold storage |
| Sessions | 30 days | Hard delete on expiry |
| Consents | Indefinite | Never delete |
| Trust history | 1 year | Aggregate + purge |

### Soft Delete Pattern

```typescript
// Mark as deleted (preserves for compliance window)
intent.deletedAt = new Date();

// Query excludes soft-deleted
WHERE deleted_at IS NULL

// Hard delete after retention
DELETE FROM intents
WHERE deleted_at < NOW() - INTERVAL '90 days'
```

## Migration Strategy

Vorion uses Drizzle ORM for migrations:

```typescript
// Generate migration
npm run db:generate

// Apply migrations
npm run db:migrate

// Push schema changes (dev only)
npm run db:push
```

### Migration Best Practices

1. **Backward Compatible**: New columns should have defaults
2. **Index Creation**: Use CONCURRENTLY for large tables
3. **Data Migration**: Separate from schema migration
4. **Rollback Plan**: Keep reverse migrations ready
