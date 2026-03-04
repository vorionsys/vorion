# ADR-004: Drizzle ORM for Database Access

## Status: Accepted

## Date: 2026-02-25

## Context

Vorion requires type-safe database access across 25+ packages and 12+ applications, with a centralized schema definition that serves as the single source of truth. The `packages/contracts/src/db/` directory defines all database tables:

| Schema File | Tables |
|-------------|--------|
| `agents.ts` | `tenants`, `agents`, `attestations`, `stateTransitions`, `approvalRequests` |
| `proofs.ts` | `proofs`, `proofChainMeta` |
| `trust.ts` | Trust score records |
| `escalations.ts` | Escalation records |
| `intents.ts` | Intent records |
| `api-keys.ts` | API key management |
| `merkle.ts` | Merkle tree batch records |
| `webhooks.ts` | Webhook registrations |
| `policy-versions.ts` | Immutable policy version records |
| `service-accounts.ts` | Service account credentials |
| `operations.ts` | Operation log records |
| `rbac.ts` | Role-based access control assignments |

These schemas are consumed by `platform-core`, `atsf-core`, `agentanchor`, `cognigate`, `a3i`, and other packages. The ORM must support:

1. **Type safety from schema definition to query result** -- No `any` types leaking through the database layer.
2. **SQL-level expressiveness** -- Joins, CTEs, aggregations, and window functions for trust score analytics, proof chain queries, and compliance reporting.
3. **Shared schema consumption** -- All packages import the same table definitions from `@vorionsys/contracts`.
4. **Multi-driver support** -- `node-postgres` for long-lived server processes (Fastify APIs, background workers) and `@neondatabase/serverless` for edge/serverless functions (Next.js Server Actions).
5. **Minimal bundle size** -- Serverless deployments (Vercel, Cloudflare Workers) are sensitive to bundle size; no binary engines.

## Decision

Adopt **Drizzle ORM v0.44+** as the database access layer across the entire monorepo.

### Schema Definition

All table schemas use Drizzle's TypeScript-first API in `packages/contracts/src/db/`:

```typescript
// packages/contracts/src/db/proofs.ts
export const proofs = pgTable('proofs', {
  id: uuid('id').primaryKey().defaultRandom(),
  chainPosition: integer('chain_position').notNull(),
  intentId: uuid('intent_id').notNull(),
  entityId: uuid('entity_id').notNull(),
  decision: jsonb('decision').notNull().$type<Decision>(),
  inputs: jsonb('inputs').notNull().$type<Record<string, unknown>>(),
  outputs: jsonb('outputs').notNull().$type<Record<string, unknown>>(),
  hash: text('hash').notNull(),
  previousHash: text('previous_hash').notNull(),
  signature: text('signature').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  chainPositionIdx: uniqueIndex('proofs_chain_position_idx').on(table.chainPosition),
  entityIdIdx: index('proofs_entity_id_idx').on(table.entityId),
  hashIdx: index('proofs_hash_idx').on(table.hash),
}));

// Type inference from schema
export type Proof = typeof proofs.$inferSelect;
export type NewProof = typeof proofs.$inferInsert;
```

This produces inferred TypeScript types (`Proof`, `NewProof`) that flow through to query results without manual type declarations.

### Migration Workflow

Two Drizzle Kit configurations exist:

| Config | Path | Schema Source | Output |
|--------|------|--------------|--------|
| Root | `/drizzle.config.ts` | `./src/intent/schema.ts` | `./drizzle/migrations` |
| AgentAnchor | `/apps/agentanchor/drizzle.config.ts` | `./lib/db/schema/index.ts` | `./drizzle` |

Migration commands are wired through Turborepo:

- `npx turbo db:generate` -- Generate SQL migration files from schema changes.
- `npx turbo db:migrate` -- Apply migrations in CI/CD.
- `npx turbo db:push` -- Direct schema push for rapid prototyping (development only).
- `npx turbo db:seed` -- Seed development data.

### Version Pinning

The root `package.json` enforces a single Drizzle ORM version across the entire workspace:

```json
{
  "overrides": {
    "drizzle-orm": "^0.44.7"
  }
}
```

This prevents the `[IsDrizzleTable]` symbol conflict that occurs when multiple Drizzle ORM versions coexist in the dependency tree. Because Drizzle uses JavaScript symbols for internal type checking, version divergence produces runtime errors that are difficult to diagnose.

### Database Injection Pattern

Services accept a database instance as a constructor parameter rather than creating connections internally:

```typescript
// Services receive the database instance, keeping connection management external
class ProofService {
  constructor(private readonly db: NodePgDatabase) {}

  async getProof(id: string): Promise<Proof | undefined> {
    return this.db.query.proofs.findFirst({ where: eq(proofs.id, id) });
  }
}
```

This pattern enables:
- Unit testing with in-memory stores (see `packages/proof-plane/src/events/memory-store.ts`).
- Switching between `node-postgres` and Neon serverless drivers without modifying business logic.
- Connection pool management at the application boundary.

## Consequences

### Positive

- **Full type safety** -- Schema-to-query-result type inference with zero `any` leaks. Drizzle's `$type<T>()` operator on `jsonb` columns provides typed access to JSON data (e.g., `$type<Decision>()` on proof records).
- **SQL-level expressiveness** -- `eq`, `and`, `gte`, `desc`, `sql` template tag provide SQL-like query building. Raw SQL escape hatch available for complex queries (window functions, recursive CTEs).
- **Zero runtime overhead** -- Drizzle compiles to raw SQL strings with no binary engine, no runtime code generation, and no query builder abstraction layer. Generated SQL is predictable and inspectable.
- **Tiny bundle size** -- Critical for serverless deployments on Vercel edge functions. No binary engine or WASM module to download.
- **Schema as code** -- Table definitions in TypeScript are the single source of truth. Migration files are generated deterministically from schema diffs.

### Negative

- **Workspace version alignment mandatory** -- All packages MUST use the same `drizzle-orm` version. Version divergence causes `[IsDrizzleTable]` symbol conflicts at runtime.
- **Smaller community than Prisma** -- Fewer tutorials, Stack Overflow answers, and third-party integrations available.
- **Migration tooling less mature** -- No built-in shadow database for migration validation. No automatic migration history table by default (uses journal files).
- **Two migration configs** -- The root and `agentanchor` app maintain separate Drizzle Kit configs pointing to different schema sources, adding maintenance overhead.

### Mitigations

- `overrides` in root `package.json` enforces a single version workspace-wide. Renovate bot updates it atomically.
- Migration journal files checked into source control for auditability.
- Integration tests validate schema consistency between migration output and runtime schema.
- Team maintains internal runbooks for common Drizzle patterns (joins, subqueries, RLS-compatible queries).

## Alternatives Considered

| Alternative | Reason for Rejection |
|-------------|---------------------|
| **Prisma** | Binary query engine adds ~5MB to serverless bundles. Less SQL-level control; complex queries require `$queryRaw`. Schema language (`.prisma` files) is non-TypeScript, breaking the "schema as code" principle. |
| **Knex** | No built-in TypeScript type inference from schema to query result. Would require manual type declarations for every query. |
| **Raw `pg`** | Too much boilerplate for 12+ schema files. No schema-driven type inference. No migration generation. |
| **TypeORM** | Decorator-heavy API with significant runtime overhead. Weaker TypeScript inference than Drizzle. Active Record pattern conflicts with the dependency injection approach. |

## References

- [Database schemas in contracts](/packages/contracts/src/db/)
- [Root Drizzle config](/drizzle.config.ts)
- [AgentAnchor Drizzle config](/apps/agentanchor/drizzle.config.ts)
- [Database migrations](/drizzle/)
- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [Drizzle Kit Migration Guide](https://orm.drizzle.team/docs/migrations)
