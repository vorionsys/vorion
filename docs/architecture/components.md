# Vorion Component Details

This document provides detailed documentation of each major component in the Vorion platform.

## Cognigate (Execution Gateway)

Cognigate is the constrained execution runtime that executes approved intents within defined constraints and resource limits.

### Purpose
- Execute approved intents safely within resource boundaries
- Provide resource monitoring and memory tracking
- Support graceful degradation instead of hard termination
- Enable kill switch for immediate termination when needed

### Key Features

#### Resource Limits
```typescript
interface ResourceLimits {
  maxMemoryMb: number;      // Default: 512MB
  maxCpuPercent: number;    // Default: 50%
  timeoutMs: number;        // Default: 300000 (5 min)
  maxNetworkRequests?: number;
  maxFileSystemOps?: number;
}
```

#### Degradation Levels
Cognigate implements progressive degradation instead of immediate termination:

| Level | Name | Description |
|-------|------|-------------|
| NONE | Normal | Full capabilities |
| WARN | Warning | Monitoring increased, no restrictions |
| THROTTLE | Throttled | Resources reduced to 50% |
| RESTRICT | Restricted | Resources reduced to 25%, read-only mode |
| SUSPEND | Suspended | Execution paused, awaiting human review |

#### Memory Monitoring
- Real-time heap usage tracking
- Peak memory recording
- Automatic degradation based on usage thresholds:
  - 75% -> WARN
  - 90% -> THROTTLE
  - 100% -> SUSPEND

### API

```typescript
class CognigateGateway {
  // Register execution handlers
  registerHandler(intentType: string, handler: ExecutionHandler): void;

  // Execute an approved intent
  async execute(context: ExecutionContext): Promise<ExecutionResult>;

  // Terminate an execution (kill switch)
  async terminate(intentId: ID): Promise<boolean>;

  // Manually degrade an execution
  degrade(intentId: ID, level: DegradationLevel, reason: string): boolean;

  // Restore from suspension (after HITL review)
  restore(intentId: ID, newLimits?: Partial<ResourceLimits>): boolean;
}
```

---

## Trust Engine

The Trust Engine calculates and maintains behavioral trust scores for entities based on multiple signal types.

### Purpose
- Calculate trust scores (0-1000 scale)
- Assign trust tiers (T0-T7)
- Process trust signals from various sources
- Apply time-based decay to encourage ongoing trustworthy behavior

### Trust Tiers (T0-T7)

| Tier | Name | Score Range | Description |
|------|------|-------------|-------------|
| T0 | Sandbox | 0-199 | Isolated testing, no external access |
| T1 | Observed | 200-349 | Observation period, human oversight |
| T2 | Provisional | 350-499 | Limited autonomy with constraints |
| T3 | Monitored | 500-649 | Continuous monitoring, expanding autonomy |
| T4 | Standard | 650-799 | Standard operations without approval |
| T5 | Trusted | 800-875 | Expanded capabilities, minimal oversight |
| T6 | Certified | 876-950 | Third-party audit completed |
| T7 | Autonomous | 951-1000 | Full autonomous authority |

### Trust Components

Trust scores are calculated from four weighted components:

| Component | Weight | Description |
|-----------|--------|-------------|
| Behavioral | 40% | Historical behavior patterns |
| Compliance | 25% | Adherence to policies |
| Identity | 20% | Identity verification strength |
| Context | 15% | Environmental/situational factors |

### Decay Milestones

Trust scores decay over time without activity (182-day half-life):

| Days Inactive | Multiplier |
|---------------|------------|
| 0 | 1.00 |
| 7 | 0.92 |
| 14 | 0.83 |
| 28 | 0.75 |
| 56 | 0.67 |
| 112 | 0.58 |
| 182 | 0.50 |

### API

```typescript
class TrustEngine {
  // Calculate trust score
  async calculate(entityId: ID, ctx: TenantContext): Promise<TrustCalculation>;

  // Get current trust record with decay applied
  async getScore(entityId: ID, ctx: TenantContext): Promise<TrustRecord | undefined>;

  // Record a trust signal
  async recordSignal(signal: TrustSignal, ctx: TenantContext): Promise<void>;

  // Initialize trust for new entity
  async initializeEntity(entityId: ID, ctx: TenantContext, level?: TrustLevel): Promise<TrustRecord>;

  // CAR integration
  async getACITrustContext(entityId: ID, carId: string, ctx: TenantContext): Promise<ACITrustContext>;
}
```

---

## Intent Service

The Intent Service manages the lifecycle of goals submitted by AI agents.

### Purpose
- Process intent submissions with validation
- Enforce trust gates and consent requirements
- Manage intent state machine transitions
- Support bulk operations and deduplication

### Intent Lifecycle States

```
pending --> evaluating --> approved --> executing --> completed
    |           |             |            |
    v           v             v            v
cancelled   denied       escalated      failed
```

### Key Features

#### Payload Validation
- Max payload size: 1MB
- Max context size: 64KB
- Max context keys: 100
- Max string length: 10,000 characters

#### Deduplication
- HMAC-SHA256 hash with secret key
- Timestamp bucket for replay protection
- Redis-backed reservation with distributed locking

#### Consent Integration
- GDPR data_processing consent check
- Consent version tracking
- Audit logging of consent validation

### API

```typescript
class IntentService {
  // Submit a new intent
  async submit(payload: IntentSubmission, options: SubmitOptions): Promise<Intent>;

  // Bulk submit intents
  async submitBulk(submissions: IntentSubmission[], options): Promise<BulkIntentResult>;

  // Get intent by ID
  async get(ctx: TenantContext, id: ID): Promise<Intent | null>;

  // Update intent status
  async updateStatus(ctx: TenantContext, id: ID, status: IntentStatus): Promise<Intent | null>;

  // Cancel an intent
  async cancel(id: ID, options: CancelOptions): Promise<Intent | null>;

  // List intents with pagination
  async list(options: ListOptions): Promise<PaginatedResult<Intent>>;
}
```

---

## RBAC Service

Role-Based Access Control for fine-grained authorization.

### Purpose
- Evaluate permissions based on roles
- Support hierarchical role inheritance
- Cache permission lookups for performance
- Integrate with multi-tenant isolation

### System Roles

| Role | Description | Key Permissions |
|------|-------------|-----------------|
| super_admin | Full system access | *:* |
| tenant_admin | Full tenant access | Most permissions within tenant |
| policy_admin | Policy management | Policies, constraints |
| security_admin | Security management | Sessions, MFA, audit |
| escalation_approver | Escalation handling | Escalations approval |
| auditor | Read-only audit | Read all, no write |
| operator | Operations | Intents, monitoring |
| user | Basic access | Own resources |
| service | Service account | Limited API access |

### Permission Format

Permissions follow `action:resource` format:

```
create:intents
read:policies
update:trust
delete:sessions
*:* (all permissions)
```

### API

```typescript
class RBACService {
  // Evaluate a permission request
  async evaluate(request: PermissionEvalRequest): Promise<PermissionEvalResult>;

  // Quick permission check
  async hasPermission(subjectId, subjectType, tenantId, action, resource): Promise<boolean>;

  // Get effective permissions (cached)
  async getEffectivePermissions(subjectId, subjectType, tenantId): Promise<PermissionString[]>;

  // Role management
  async createRole(ctx: TenantContext, options: CreateRoleOptions): Promise<Role>;
  async assignRole(ctx: TenantContext, options: AssignRoleOptions): Promise<UserRole>;
  async revokeRole(ctx: TenantContext, options: RevokeRoleOptions): Promise<boolean>;
}
```

---

## Security Layer

### DPoP (Demonstrating Proof-of-Possession)

Implements RFC 9449 for sender-constrained tokens.

#### Features
- Proof generation with ES256/ES384/ES512
- JTI uniqueness enforcement
- Redis-backed JTI cache for multi-instance
- Graceful fallback to in-memory cache

#### Configuration
```typescript
interface DPoPConfig {
  requiredForTiers: TrustTier[];  // Default: T2+
  maxProofAge: number;            // Default: 60 seconds
  clockSkewTolerance: number;     // Default: 5 seconds
  allowedAlgorithms: string[];    // Default: ['ES256']
}
```

### CSRF Protection

Double-submit cookie pattern with HMAC-signed tokens.

#### Features
- Session-bound token generation
- Timing-safe comparison
- Configurable token TTL
- Path exclusion support

### MFA Service

Multi-factor authentication supporting TOTP and backup codes.

#### Features
- TOTP enrollment with QR code generation
- Encrypted secret storage
- Backup code generation and verification
- Challenge-based verification flow
- Grace period for new enrollments

### Session Manager

Secure session lifecycle management.

#### Features
- Session creation with device tracking
- Fingerprint validation
- Inactivity timeout
- Session regeneration for security events
- Concurrent session detection

---

## Adapters (Redis/Memory)

The adapter system allows Vorion to run with either Redis-backed or in-memory implementations.

### Available Adapters

| Adapter | Redis | Memory | Purpose |
|---------|-------|--------|---------|
| Queue | BullMQ | In-memory | Job processing |
| Cache | Redis | Map | Data caching |
| Lock | Redis | In-memory | Distributed locks |
| Session | Redis | Map | Session storage |
| RateLimit | Redis | In-memory | Request limiting |

### Usage

```typescript
import { getAdapterProvider, getCacheAdapter, getQueueAdapter } from './common/adapters';

// Get provider
const provider = getAdapterProvider();

// Use convenience functions
const cache = getCacheAdapter();
await cache.set('key', 'value', 300);

const queue = getQueueAdapter('my-queue');
await queue.add('job', { data: 'payload' });
```

### Configuration

Adapters are selected based on environment:
- **Production**: Redis-backed adapters (requires Redis connection)
- **Development/Test**: Memory adapters (no external dependencies)

---

## BASIS Engine

The rule engine for evaluating constraints and policies.

### Features
- Expression evaluation with secure parser
- Namespace-based rule organization
- Weighted signal calculation
- Custom function registration

### Rule Structure

```typescript
interface Rule {
  id: string;
  namespace: string;
  name: string;
  when: {
    intentType?: string;
    conditions: Expression[];
  };
  evaluate: {
    condition: string;
    result: ControlAction;
    reason?: string;
  }[];
}
```

---

## Proof Chain

Cryptographic audit trail using Merkle trees.

### Features
- SHA-256 hash chaining
- Merkle tree construction
- Verification of record integrity
- Support for compliance exports

### Record Structure

```typescript
interface Proof {
  id: ID;
  chainPosition: number;
  intentId: ID;
  entityId: ID;
  decision: Decision;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  hash: string;
  previousHash: string;
  signature: string;
  createdAt: Timestamp;
}
```
