# ADR-013: Monorepo with Turborepo

**Status:** Accepted
**Date:** 2026-02-11
**Deciders:** Vorion Architecture Team

## Context

Vorion is an AI governance platform comprising 10+ packages (`contracts`, `platform-core`, `car-client`, `cognigate`, etc.) and 8+ apps (`agentanchor`, marketing sites, dashboards). As the codebase grew, several pain points emerged:

- **Cross-package changes** required coordinating releases across multiple repositories
- **Schema drift** between consumers of shared types (e.g., CAR definitions, trust score interfaces)
- **Inconsistent tooling** across repos (different TypeScript configs, lint rules, build scripts)
- **Slow CI** due to redundant builds when dependencies had not changed

The platform needs consistent builds, shared schemas, and the ability to land atomic changes that span multiple packages and apps.

## Decision

Adopt an **npm workspaces monorepo** with **Turborepo** for task orchestration.

### Repository Structure

Root `package.json` defines workspaces:

```json
{
  "workspaces": ["packages/*", "apps/*", "examples"]
}
```

### Turborepo Orchestration

`turbo.json` defines the task pipeline:

- **Parallel builds** respecting the dependency graph
- **Remote caching** via `TURBO_TOKEN` and `TURBO_TEAM` environment variables
- **Content-hash based cache invalidation** -- only rebuild what changed

### Key Design Choices

| Choice | Rationale |
|--------|-----------|
| npm (not pnpm/yarn) | Simplicity; native Node.js support, fewer moving parts |
| `turbo.json` pipeline | `build` -> `test` dependency chain ensures correct ordering |
| Shared configs at root | Single `tsconfig.base.json` and `eslint.config.js` inherited by all packages |
| `contracts` as shared schema layer | Single source of truth for types consumed by all packages and apps |

## Consequences

### Positive

- **Atomic cross-package changes** -- a single PR can update a schema in `contracts` and all its consumers
- **Shared CI pipeline** -- one workflow builds, tests, and lints everything
- **Consistent tooling** -- all packages inherit the same TypeScript, ESLint, and Prettier configs
- **Cache hits reduce CI from ~15min to ~3min** -- content-hash caching skips unchanged packages

### Negative

- **Lockfile conflicts** on parallel PRs modifying dependencies
- **Initial `npm install` slower** (~18s for full dependency tree)
- **Version alignment required** -- all packages must maintain compatible dependency versions (e.g., `drizzle-orm` version must be consistent across consumers)

### Mitigations

- Rebase-and-merge strategy reduces lockfile conflicts
- CI caches `node_modules` to offset install time
- Renovate bot configured for monorepo-wide dependency updates

## Alternatives Considered

1. **Separate repositories** -- Rejected: version drift between packages, difficult atomic changes
2. **Nx** -- Rejected: heavier setup and configuration overhead for current team size
3. **pnpm workspaces** -- Viable alternative with stricter dependency isolation; may migrate later if phantom dependency issues arise

## References

- [Turborepo Documentation](https://turbo.build/repo/docs)
- [npm Workspaces](https://docs.npmjs.com/cli/using-npm/workspaces)
- [ADR-011: Versioning Strategy](ADR-011-versioning-strategy.md)
