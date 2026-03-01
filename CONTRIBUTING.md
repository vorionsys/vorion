# Contributing to Vorion

Thank you for your interest in contributing to Vorion. This guide covers everything you need to get started, from local setup through submitting your first pull request.

Vorion is an early-stage project (v0.1) built by a small team. We value every contribution — code, docs, tests, bug reports, and honest feedback all count equally.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Package Guidelines](#package-guidelines)
- [Reporting Issues](#reporting-issues)
- [Security Vulnerabilities](#security-vulnerabilities)
- [License](#license)

---

## Getting Started

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | >= 20 | Required for all packages and apps |
| npm | >= 10 | Workspace package manager |
| Python | >= 3.9 | Only required for `car-python` |
| Git | Latest | Conventional Commits enforced |

### Clone and Install

```bash
git clone https://github.com/vorionsys/vorion.git
cd vorion
npm install
```

### Build

Builds are orchestrated by [Turborepo](https://turbo.build/) and respect the dependency graph (`contracts` builds before packages that depend on it, etc.).

```bash
npm run build
```

### Run Tests

```bash
# Run all tests
npm run test

# Run tests with coverage gates
npm run test:coverage

# Type checking only
npm run typecheck
```

### Other Useful Commands

```bash
# Lint all packages
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Format with Prettier
npm run format

# Check formatting without writing
npm run format:check

# Detect circular dependencies
npm run check:circular
```

---

## Project Structure

The repository is an npm workspaces monorepo with two top-level directories:

```
vorion/
├── packages/        # Publishable libraries and SDKs
├── apps/            # Deployable applications
├── docs/            # Specifications (BASIS, ROADMAP)
├── .github/         # CI workflows, issue templates, PR template
├── turbo.json       # Turborepo task configuration
├── eslint.config.mjs
└── package.json     # Root workspace definition
```

### Foundation Packages

These are the lowest-level packages. Other packages depend on them, so changes here have the widest impact.

| Package | Purpose |
|---------|---------|
| `shared-constants` | Trust tiers (T0-T7), domains, error codes, rate limits |
| `basis` | BASIS standard implementation, trust factors, KYA (Know Your Agent) |
| `contracts` | Zod schemas, API contracts, validators — the canonical type layer |

### Core Service Packages

| Package | Purpose |
|---------|---------|
| `atsf-core` | Agentic Trust Scoring Framework — trust computation engine |
| `cognigate` | Policy enforcement client SDK |
| `runtime` | Orchestration layer (intent pipeline, trust facade, proof committer) |
| `ai-gateway` | Multi-provider AI routing with circuit breakers and SLA tracking |
| `proof-plane` | Immutable audit trail with SHA-256 hash chains |

### CAR (Categorical Agentic Registry)

| Package | Purpose |
|---------|---------|
| `car-spec` | CAR OpenAPI 3.1.0 specification |
| `car-client` | TypeScript client SDK |
| `car-cli` | CLI tool for registry operations |
| `car-python` | Python client SDK (uses pytest, ruff, mypy) |

### SDKs

| Package | Purpose |
|---------|---------|
| `sdk` | Simple governance interface for end users |
| `council` | 16-agent governance orchestrator |

### Applications

| App | Purpose |
|-----|---------|
| `kaizen` | AI learning platform (Next.js) — [learn.vorion.org](https://learn.vorion.org) |
| `cognigate-api` | Cognigate governance API service (Fastify) — [cognigate.dev](https://cognigate.dev) |

### Dependency Flow

Imports must follow this strict direction, enforced by ESLint:

```
contracts ← packages ← apps
```

- `contracts` cannot import from any other package (it is the foundation layer).
- Packages cannot import from apps.
- Apps import from packages freely.

---

## Development Workflow

### 1. Create a Branch

Use one of these naming conventions:

| Prefix | Use Case | Example |
|--------|----------|---------|
| `feature/` | New functionality | `feature/add-trust-decay-hooks` |
| `fix/` | Bug fixes | `fix/circuit-breaker-timeout` |
| `docs/` | Documentation only | `docs/update-basis-spec` |
| `chore/` | Maintenance, deps, CI | `chore/upgrade-vitest` |
| `test/` | Test-only changes | `test/proof-plane-coverage` |

```bash
git checkout -b feature/your-feature-name
```

### 2. Make Your Changes

- Write or update tests for any behavior changes.
- Run `npm run build && npm run test` locally before pushing.
- Run `npm run lint` to catch style issues early.

### 3. Commit with Conventional Commits

All commits must follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add trust decay visualization
fix: resolve race condition in proof committer
docs: update CAR client usage examples
test: add coverage for intent pipeline edge cases
chore: bump vitest to v4
```

Scope is optional but recommended for clarity in a multi-package repo:

```
feat(atsf-core): add custom decay profiles
fix(cognigate): handle null Firebase gracefully
```

### 4. Push and Open a Pull Request

```bash
git push origin feature/your-feature-name
```

Open a PR against `main` using the [pull request template](.github/pull_request_template.md). Your PR should include:

- A description of what changed and why
- A link to the related issue (if any)
- Confirmation that tests are added/updated
- Confirmation that no secrets or sensitive data are included

### 5. CI Checks

All of the following must pass before a PR can be merged:

| Check | What It Does |
|-------|--------------|
| **Build, Typecheck & Test** | Builds all packages, runs `tsc`, executes test suites |
| **Coverage Gates** | Enforces per-package coverage thresholds (see [Coverage Thresholds](#coverage-thresholds)) |
| **Lint & Typecheck** | ESLint + TypeScript compiler checks |
| **Circular Dependency Check** | Runs `madge` to detect circular imports across `packages/` |
| **Gitleaks Scan** | Scans for hardcoded secrets and credentials |

### 6. Review and Merge

- External contributors need one maintainer approval.
- Maintainers can merge after CI passes.
- See [GOVERNANCE.md](GOVERNANCE.md) for decision-making details.

---

## Code Standards

### TypeScript (all packages except `car-python`)

- **Compiler:** TypeScript 5.x with strict mode
- **Linting:** ESLint 9 with `@typescript-eslint` and `eslint-plugin-import`
- **Formatting:** Prettier (run `npm run format` before committing)
- **Testing:** Vitest with `@vitest/coverage-v8`
- **Bundling:** tsup for package builds

### Python (`car-python` only)

- **Version:** Python >= 3.9
- **Linting:** ruff
- **Type checking:** mypy (strict mode)
- **Testing:** pytest with pytest-asyncio
- **Dependencies:** httpx, pydantic

### General Rules

- Prefer `const` over `let`; avoid `var`.
- Prefix unused parameters with `_` (e.g., `_ctx`).
- Minimize use of `any` — use proper types. Unavoidable uses trigger a lint warning.
- Use barrel exports (`index.ts`) for each package's public API.
- Keep imports ordered: builtins, external, `@vorionsys/contracts`, other `@vorionsys/*`, relative. ESLint enforces this automatically.

### Coverage Thresholds

Coverage-gated packages must meet these minimums (enforced in CI):

| Metric | Threshold |
|--------|-----------|
| Lines | 60% |
| Functions | 60% |
| Statements | 60% |
| Branches | 50% |

Coverage is checked per-package. Adding tests is one of the most valuable contributions you can make.

---

## Package Guidelines

### Adding a New Package

1. Create a directory under `packages/your-package-name/`.
2. Add a `package.json` with the `@vorionsys/` scope prefix.
3. Add a `tsconfig.json` extending the root config.
4. Add a `vitest.config.ts` with coverage configuration.
5. Add a `src/index.ts` barrel export.
6. Build with tsup — add a `tsup.config.ts` if needed.
7. The package is automatically included in the workspace via the `packages/*` glob in the root `package.json`.
8. Verify the dependency graph: run `npm run check:circular`.

### Import Restrictions

These are enforced by ESLint and will fail CI if violated:

- **`contracts` is the foundation.** It cannot import from any other `@vorionsys/*` package.
- **Packages cannot import from apps.** The dependency flow is one-directional: `contracts` <- `packages` <- `apps`.
- **No imports from the legacy `/src/` root directory.** Use `@vorionsys/*` package imports instead.

### Barrel Exports

Every package should re-export its public API through `src/index.ts`. Consumers import from the package name, not deep paths:

```typescript
// Correct
import { TrustScore } from '@vorionsys/contracts';

// Avoid
import { TrustScore } from '@vorionsys/contracts/src/canonical/trust-score';
```

---

## Reporting Issues

### Bug Reports

Use the [Bug Report template](https://github.com/vorionsys/vorion/issues/new?template=bug_report.md). Include:

- A clear description of the bug
- Steps to reproduce
- Expected vs. actual behavior
- Environment details (OS, Node/Python version, package versions)
- Relevant logs or error output

### Feature Requests

Use the [Feature Request template](https://github.com/vorionsys/vorion/issues/new?template=feature_request.md). Include:

- The problem your feature would solve
- Your proposed solution
- Alternatives you have considered

### Specification Changes (BASIS, ATSF Tiers, CAR Schema)

Changes to core specifications follow a higher bar. See [GOVERNANCE.md](GOVERNANCE.md) for the full process:

1. Open a GitHub Issue describing the change, motivation, and downstream impact.
2. Allow a minimum 7-day comment period.
3. Both maintainers must approve.
4. Implementation PR must include updated spec docs, migration notes (if breaking), and tests.

---

## Security Vulnerabilities

**Do not open public issues for security vulnerabilities.**

- Email: **security@vorion.org**
- Initial response target: within 48 hours
- Critical remediation target: within 7 days

Include reproduction steps, affected components, and potential impact. See [SECURITY.md](.github/SECURITY.md) for the full policy.

---

## License

This project is licensed under the terms specified in the [LICENSE](LICENSE) file. By submitting a pull request, you agree that your contribution is licensed under the same terms. See [GOVERNANCE.md](GOVERNANCE.md) for additional licensing details.

---

## Questions?

- Open a [GitHub Discussion](https://github.com/vorionsys/vorion/discussions) for questions and ideas.
- Check the [Roadmap](docs/ROADMAP.md) to see what is planned.
- Read the [BASIS Spec](docs/BASIS.md) for the governance standard.

We are a small team and genuinely appreciate every contribution. Thank you for helping build trustworthy AI governance.
