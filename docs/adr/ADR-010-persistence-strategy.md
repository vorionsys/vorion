# ADR-010: Persistence Strategy

## Status
**Accepted** - January 2025

## Context

The Vorion platform requires a robust persistence strategy supporting:

1. **Multi-tenant isolation** - Each tenant's data must be logically separated
2. **High-frequency trust updates** - Trust scores change frequently via attestations
3. **Immutable audit trails** - Compliance requires tamper-evident records
4. **Agent registry at scale** - Potentially millions of agents across tenants
5. **A2A chain tracking** - Nested call chains need efficient storage/retrieval

Current challenges:
- Trust score computation is latency-sensitive (~10ms budget)
- Attestations arrive in bursts (100s per second during peak)
- Audit queries span long time ranges
- A2A chains are hierarchical with variable depth

## Decision

We implement a **tiered persistence architecture** with three layers:

### 1. Fast Data Layer (A3I Cache)

Redis-based cache for hot data with XFetch cache-stampede prevention:

```typescript
interface A3ICacheConfig {
  redis: Redis;
  ttl: {
    trustScore: number;    // 5 minutes
    agentData: number;     // 10 minutes
    attestationBatch: number; // 30 seconds
  };
  batchSize: number;       // 50 attestations per flush
  syncIntervalMs: number;  // 5 seconds
}
```

**Cached Entities:**
| Entity | TTL | Invalidation Strategy |
|--------|-----|----------------------|
| Trust Scores | 5 min | On attestation, explicit invalidate |
| Agent Metadata | 10 min | On state change |
| Attestation Batches | 30 sec | Auto-flush to DB |
| A2A Endpoints | 1 min | On registration change |

**XFetch Algorithm:**
- Prevents thundering herd on cache expiry
- Probabilistic early refresh: `age > ttl - delta * beta * log(random())`
- TTL jitter (±10%) to prevent synchronized expiration

### 2. Primary Data Layer (PostgreSQL)

Drizzle ORM with tenant-scoped queries:

```typescript
// Schema pattern
export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  aci: text('aci').notNull().unique(),
  state: agentStateEnum('state').notNull().default('provisioned'),
  trustScore: integer('trust_score').notNull().default(0),
  metadata: jsonb('metadata').$type<AgentMetadata>(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, (table) => ({
  tenantAciIdx: uniqueIndex('agents_tenant_aci_idx').on(table.tenantId, table.aci),
  tenantStateIdx: index('agents_tenant_state_idx').on(table.tenantId, table.state),
}));
```

**Key Design Patterns:**

1. **Tenant Scoping** - All queries include `tenantId` filter
2. **Soft Deletes** - `deletedAt` timestamp, filter with `isNull(deletedAt)`
3. **JSONB Metadata** - Flexible extension without schema changes
4. **Statement Timeouts** - 30s default, 5s for health checks

### 3. Audit Layer (Immutable Chain)

Hash-chained records for tamper-evident audit:

```typescript
interface AuditRecord {
  id: string;
  tenantId: string;
  entityType: 'agent' | 'attestation' | 'trust' | 'a2a';
  entityId: string;
  action: string;
  previousHash: string;  // Chain link
  dataHash: string;      // SHA-256 of payload
  payload: Record<string, unknown>;
  timestamp: string;
  signature?: string;    // Ed25519 signature
}
```

**Audit Events:**
- Agent lifecycle (register, activate, suspend, revoke)
- Trust tier transitions (with approval records)
- Attestation submissions
- A2A chain completions

### 4. Queue Layer (BullMQ)

Redis-backed queues for async processing:

| Queue | Purpose | Retention |
|-------|---------|-----------|
| `attestation:batch` | Attestation flush to DB | 1 hour |
| `trust:compute` | Trust score recalculation | 1 hour |
| `audit:record` | Audit chain writes | Indefinite |
| `a2a:chain` | Chain completion processing | 1 hour |

**Queue Features:**
- Exponential backoff with jitter
- Dead letter queue for failed jobs
- Metrics per queue (depth, latency, throughput)

## Data Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  API Layer   │────▶│  A3I Cache   │────▶│  PostgreSQL  │
│  (Fastify)   │     │  (Redis)     │     │  (Drizzle)   │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │
       │                    │                    ▼
       │                    │             ┌──────────────┐
       │                    │             │ Audit Chain  │
       │                    │             │  (Postgres)  │
       │                    │             └──────────────┘
       │                    │
       ▼                    ▼
┌──────────────┐     ┌──────────────┐
│   BullMQ     │────▶│   Workers    │
│   Queues     │     │  (Compute)   │
└──────────────┘     └──────────────┘
```

## Entity-Specific Strategies

### Agents

| Operation | Strategy |
|-----------|----------|
| Read | Cache-first, fallback to DB |
| Create | Write-through (cache + DB) |
| Update | Invalidate cache, write DB |
| Delete | Soft delete, invalidate cache |
| List | DB query with pagination |

### Trust Scores

| Operation | Strategy |
|-----------|----------|
| Get Score | XFetch cache with early refresh |
| Compute | Async job, write-through |
| History | DB only (no cache) |

### Attestations

| Operation | Strategy |
|-----------|----------|
| Submit | Batch in cache, async flush |
| Query | DB with cursor pagination |
| Aggregate | Materialized view refresh |

### A2A Chains

| Operation | Strategy |
|-----------|----------|
| Active Chain | In-memory + cache backup |
| Completed | Write to DB, remove from cache |
| Query | DB with depth-limited recursion |

## Implementation

### Files Created/Modified

- `src/persistence/index.ts` - Module exports
- `src/persistence/cache.ts` - A3I cache service
- `src/persistence/repository.ts` - Base repository pattern
- `src/persistence/audit.ts` - Audit chain service
- `src/persistence/migrations/` - Database migrations

### Repository Pattern

```typescript
abstract class BaseRepository<T, ID> {
  abstract create(entity: T): Promise<T>;
  abstract findById(id: ID): Promise<T | null>;
  abstract findByTenant(tenantId: string, options?: QueryOptions): Promise<T[]>;
  abstract update(id: ID, updates: Partial<T>): Promise<T>;
  abstract softDelete(id: ID): Promise<void>;
}
```

### Cache Integration

```typescript
class CachedRepository<T, ID> extends BaseRepository<T, ID> {
  constructor(
    private inner: BaseRepository<T, ID>,
    private cache: A3ICache,
    private options: CacheOptions
  ) {}

  async findById(id: ID): Promise<T | null> {
    return this.cache.getWithXFetch(
      this.cacheKey(id),
      () => this.inner.findById(id),
      this.options.ttl
    );
  }
}
```

## Consequences

### Positive
- **Low latency reads** - Cache-first with XFetch prevents stampedes
- **High throughput writes** - Batched attestations reduce DB load
- **Audit compliance** - Immutable chain with cryptographic integrity
- **Flexible schema** - JSONB for extension without migrations

### Negative
- **Cache consistency** - Eventual consistency for non-critical data
- **Operational complexity** - Three data stores to manage
- **Storage costs** - Redis memory, audit chain growth

### Mitigations
- Strong consistency for trust tiers (write-through)
- TTL-based cache eviction with monitoring
- Audit chain partitioning by time period
- Regular audit chain archival to cold storage

## Multi-Tenancy

All data operations enforce tenant isolation:

```typescript
// Query scoping
const agents = await db
  .select()
  .from(schema.agents)
  .where(and(
    eq(schema.agents.tenantId, tenantId),
    isNull(schema.agents.deletedAt)
  ));

// Cache key namespacing
const cacheKey = `tenant:${tenantId}:agent:${agentId}`;

// Audit context
const auditRecord = {
  tenantId,
  entityType: 'agent',
  ...
};
```

## Connection Management

```typescript
// Pool configuration
const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.name,
  user: config.db.user,
  password: config.db.password,
  min: 2,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Statement timeouts
await client.query('SET LOCAL statement_timeout = $1', [timeoutMs]);
```

## References

- [ADR-004: Trust Computed at Runtime](ADR-004-trust-computed-at-runtime.md)
- [ADR-009: Observability & Operations](ADR-009-observability-operations.md)
- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [XFetch Paper](https://www.vldb.org/pvldb/vol8/p886-vattani.pdf)
