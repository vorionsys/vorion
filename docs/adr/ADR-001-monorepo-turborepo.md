# ADR-001: Monorepo with Turborepo

## Status: Accepted

## Date: 2026-02-25

## Context

Vorion is an AI governance platform comprising 25+ packages (`contracts`, `shared-constants`, `basis`, `atsf-core`, `cognigate`, `proof-plane`, `platform-core`, `car-client`, `car-cli`, `a3i`, `runtime`, `security`, `sdk`, `agent-sdk`, `council`, etc.) and 12+ deployable applications (`agentanchor`, `cognigate-api`, `kaizen`, `marketing`, `dashboard`, `aurais`, etc.). As the platform grew from a single service into a multi-component governance system, the team faced compounding challenges:

1. **Schema drift** -- The `contracts` package defines Drizzle ORM table schemas, Zod validators, and TypeScript types consumed by every other package. In a polyrepo model, consumers would diverge from the canonical schema between release cycles, producing runtime type mismatches.
2. **Atomic change impossibility** -- A change to trust tier thresholds in `shared-constants` must simultaneously update `atsf-core` scoring logic, `platform-core` enforcement rules, and `agentanchor` dashboard displays. Polyrepo requires coordinated multi-repo PRs.
3. **Tooling fragmentation** -- Each repo would maintain its own TypeScript configuration, ESLint rules, Vitest setup, and CI workflows, multiplying maintenance overhead and divergence risk.
4. **Slow CI** -- Without dependency-aware caching, every change triggers full builds across all components.

The platform needs shared schemas, atomic cross-package changes, and efficient builds to maintain the tight coupling required by a governance system where contracts, enforcement, and proof must always agree.

## Decision

Adopt an **npm workspaces monorepo** with **Turborepo** for task orchestration.

### Repository Layout

The root `package.json` defines three workspace globs:

```json
{
  "workspaces": ["packages/*", "apps/*", "examples"]
}
```

- **`packages/*`** -- Shared libraries, many published to npm under `@vorionsys/` scope (e.g., `@vorionsys/contracts`, `@vorionsys/shared-constants`, `@vorionsys/basis`, `@vorionsys/cognigate`).
- **`apps/*`** -- Deployable applications (Next.js web apps, FastAPI services, Astro marketing sites).
- **`examples`** -- Example implementations for SDK consumers.

### Turborepo Pipeline

`turbo.json` defines a dependency-aware task graph:

| Task | Depends On | Outputs | Cache |
|------|-----------|---------|-------|
| `build` | `^build` (topological) | `dist/**`, `.next/**`, `build/**` | Content-hash |
| `test` | `^build` | `coverage/**` | Content-hash on `src/**`, `tests/**`, `vitest.config.*` |
| `typecheck` | `^build` | None | Content-hash |
| `lint` | None | None | Content-hash on `src/**`, `*.config.*` |
| `dev` | None | None | Disabled (persistent) |
| `db:generate`, `db:migrate`, `db:push`, `db:seed` | None | None | Disabled |

Key design choices:

- **`^build` topological dependency** ensures packages are built in correct order (e.g., `contracts` before `platform-core` before `agentanchor`).
- **Content-hash caching** with `TURBO_TOKEN` and `TURBO_TEAM` enables remote caching, reducing CI from full-rebuild to incremental.
- **Global dependencies** include `.env.*local`, `.env`, and `tsconfig.base.json` -- changes to these invalidate all caches.
- **Global environment variables** (`NODE_ENV`, `VERCEL_ENV`, `CI`, `DATABASE_URL`, `XAI_API_KEY`) are tracked so that environment changes trigger appropriate rebuilds.

### Shared Configuration

| Configuration | Location | Inherited By |
|--------------|----------|-------------|
| TypeScript | `tsconfig.base.json` | All packages and apps |
| ESLint | `eslint.config.mjs` (flat config, ESLint 9) | All packages |
| Prettier | Root config | All packages |
| Vitest | `vitest.config.ts` | All test suites |
| Drizzle | `drizzle.config.ts` + `packages/contracts/src/db/` | All DB consumers |

### Package Manager: npm

The project uses npm 10.8.2 (`"packageManager": "npm@10.8.2"`) with Node.js >= 20. The `overrides` field in the root `package.json` enforces workspace-wide version alignment for critical dependencies:

```json
{
  "overrides": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "drizzle-orm": "^0.44.7"
  }
}
```

This prevents the `[IsDrizzleTable]` symbol conflict that occurs when multiple Drizzle ORM versions coexist in the dependency tree.

## Consequences

### Positive

- **Atomic cross-package changes** -- A single PR can update a Zod schema in `contracts`, the enforcement logic in `platform-core`, the API in `cognigate`, and the dashboard display in `agentanchor`, all verified by a single CI run.
- **Single source of truth for types** -- The `contracts` package exports all Drizzle table definitions, Zod validators, and TypeScript types. Every consumer imports from `@vorionsys/contracts`.
- **Consistent tooling** -- All 25+ packages inherit the same TypeScript strict mode, ESLint rules, and test configuration, eliminating config drift.
- **Cache-accelerated CI** -- Content-hash caching skips unchanged packages. Remote caching via Turborepo further reduces build times for shared CI runners.
- **Simplified dependency management** -- A single `package-lock.json` ensures all packages resolve to the same dependency versions.

### Negative

- **Lockfile merge conflicts** -- Parallel PRs that modify dependencies produce conflicting `package-lock.json` changes, requiring manual resolution.
- **Initial install time** -- `npm install` must resolve the full dependency tree for all workspaces (~18s).
- **Workspace coupling** -- All packages must maintain compatible dependency versions. A React 19 override affects every app, even those that might prefer React 18.
- **Repository size** -- The monorepo is larger than any individual component repo would be, increasing clone time for new contributors.

### Mitigations

- Rebase-and-merge strategy reduces lockfile conflicts.
- CI caches `node_modules` between runs.
- Renovate bot configured for monorepo-wide dependency updates.
- `--filter` flag allows building and testing individual packages: `npx turbo build --filter="@vorionsys/contracts"`.
- Circular dependency detection via `madge --circular --extensions ts,tsx packages/`.

## Alternatives Considered

| Alternative | Reason for Rejection |
|-------------|---------------------|
| **Separate repositories** | Version drift between `contracts` and its 10+ consumers; impossible to land atomic governance changes. |
| **Nx** | Heavier configuration overhead with project.json per package; Turborepo's simpler convention-based approach better suited for current team size. |
| **pnpm workspaces** | Viable alternative with stricter dependency isolation via symlink structure. May migrate if phantom dependency issues become problematic. |
| **Yarn workspaces** | No significant advantage over npm workspaces; adds tool-switching overhead. |

## References

- [turbo.json configuration](/turbo.json)
- [Root package.json workspace definition](/package.json)
- [tsconfig.base.json shared TypeScript config](/tsconfig.base.json)
- [Turborepo Documentation](https://turbo.build/repo/docs)
- [npm Workspaces](https://docs.npmjs.com/cli/using-npm/workspaces)
