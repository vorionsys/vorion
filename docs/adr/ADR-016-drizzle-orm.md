# ADR-016: Drizzle ORM for Database Access

**Status:** Accepted
**Date:** 2026-02-11
**Deciders:** Vorion Architecture Team

## Context

Vorion requires type-safe database access across 10+ packages and apps, with shared schema definitions centralized in a contracts package (`@vorionsys/contracts`). The platform needs SQL-like expressiveness -- joins, CTEs, aggregations -- without the runtime overhead of a heavy ORM. The database layer must work with PostgreSQL and support both `node-postgres` (long-lived servers) and `@neondatabase/serverless` (edge/serverless functions) drivers.

Key requirements:

- **Type safety** from schema definition through query result
- **Shared schemas** consumed by all packages from a single source of truth
- **SQL-level control** over generated queries (no magic, no abstraction leaks)
- **Minimal bundle footprint** for serverless deployments

## Decision

Adopt **Drizzle ORM v0.44+** as the database access layer across the entire monorepo.

### Capabilities

| Capability | How Drizzle Delivers |
|------------|---------------------|
| Schema definitions | TypeScript-first via `pgTable`, `relations` |
| Query building | SQL-like operators (`eq`, `and`, `gte`, `desc`, `sql`) |
| Runtime overhead | Zero -- compiles directly to raw SQL strings |
| Migrations | `drizzle-kit generate`, `drizzle-kit migrate`, `drizzle-kit push` |
| Driver support | `node-postgres` and `@neondatabase/serverless` via adapter pattern |

### Key Patterns

1. **Schemas in contracts** -- All `pgTable` and `relations` definitions live in `packages/contracts/src/db/` and are imported by every consuming package.
2. **Database injection** -- Services accept `NodePgDatabase` (or the Neon equivalent) as a constructor parameter, keeping database creation out of business logic.
3. **Migration workflow** -- `drizzle-kit generate` produces SQL migration files; `drizzle-kit migrate` applies them in CI/CD; `drizzle-kit push` is used for rapid prototyping only.
4. **Version pinning** -- Root `package.json` uses `overrides` to pin a single `drizzle-orm` version workspace-wide, preventing `[IsDrizzleTable]` symbol conflicts that arise when multiple versions coexist.

## Consequences

### Positive

- **Full type safety** from schema definition to query result -- no `any` leaks
- **SQL-level expressiveness** -- joins, sub-queries, CTEs, and raw SQL escape hatch via `sql` template tag
- **Tiny bundle size** -- no binary engine, no runtime code generation
- **No query builder abstraction leaks** -- generated SQL is predictable and inspectable
- **Schema shared via contracts** -- single source of truth consumed by all packages and apps

### Negative

- **Workspace version alignment required** -- all packages MUST use the same `drizzle-orm` version; symbol conflicts (`[IsDrizzleTable]`) occur if versions diverge
- **Smaller community** than Prisma -- fewer tutorials, Stack Overflow answers, and third-party integrations
- **Migration tooling less mature** than Prisma Migrate -- no built-in shadow database or migration history table by default

### Mitigations

- `overrides` in root `package.json` enforces a single version; Renovate bot updates it monorepo-wide
- Team maintains internal runbooks for common Drizzle patterns
- Migration history tracked via `drizzle-kit migrate` journal files checked into source control

## Alternatives Considered

| Alternative | Reason for Rejection |
|-------------|---------------------|
| **Prisma** | Runtime overhead (binary query engine), less SQL-level control, large bundle size for serverless |
| **Knex** | No built-in TypeScript type safety from schema to query result |
| **Raw pg** | Too much boilerplate; no schema-driven type inference |
| **TypeORM** | Decorator-heavy API, significant runtime overhead, weaker TypeScript inference |

## References

- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [ADR-010: Persistence Strategy](ADR-010-persistence-strategy.md)
- [ADR-013: Monorepo with Turborepo](ADR-013-monorepo-turborepo.md)
