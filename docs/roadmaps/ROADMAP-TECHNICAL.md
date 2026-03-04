# Vorion Technical Roadmap

> **Read time**: 10 minutes | **Audience**: Engineers, Architects, Technical Evaluators

## Architecture Overview

Vorion is a constraint-based AI governance platform built as a Turborepo monorepo. The governance pipeline has four stages, each backed by a dedicated package:

```
Agent Request
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  CAR Registry                                       │
│  Categorical Agentic Registry — unique agent identity │
│  Package: @vorion/car-client, @vorion/car-cli       │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  BASIS Engine                                       │
│  Behavioral constraint specification + evaluation   │
│  Package: @vorionsys/basis                          │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  Cognigate                                          │
│  Real-time governance decision engine               │
│  Package: @vorionsys/cognigate (client)             │
│  App: cognigate-api (Python FastAPI server)         │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  PROOF Plane                                        │
│  Immutable dual-hash audit trail                    │
│  Package: @vorionsys/proof-plane                    │
└─────────────────────────────────────────────────────┘
```

### Trust Model: ATSF (Agentic Trust Scoring Framework)

8-tier model (T0-T7) measuring behavioral reliability:

| Tier | Range | Autonomy Level | Verification |
|------|-------|---------------|--------------|
| T0 | 0-12 | Quarantined | All actions blocked |
| T1 | 13-25 | Supervised | Human approval required |
| T2 | 26-38 | Guided | Most actions need approval |
| T3 | 39-51 | Assisted | Standard actions auto-approved |
| T4 | 52-64 | Autonomous (limited) | Broad auto-approval |
| T5 | 65-77 | Autonomous | Minimal oversight |
| T6 | 78-90 | Trusted | Drift monitoring only |
| T7 | 91-100 | Fully trusted | Audit-only |

Trust scores are computed from 5 dimensions: competence, reliability, integrity, benevolence, and transparency. Each dimension has weighted sub-metrics. The scoring algorithm is in `@vorionsys/atsf-core` with 401 tests.

## Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Monorepo | Turborepo + npm workspaces | Parallel builds, shared deps, no Lerna complexity |
| Language | TypeScript (strict) | Type safety across 25 packages |
| Backend | Node.js, Python (FastAPI) | Node for packages, Python for ML-adjacent governance API |
| Frontend | Next.js 15/16, Astro | Next.js for apps, Astro for static marketing |
| Database | Supabase (PostgreSQL + RLS) | Row-level security for multi-tenant isolation |
| Auth | Supabase Auth | SSO-ready, PKCE flow, social providers |
| Deployment | Vercel, Docker | Vercel for apps, Docker for self-hosted |
| CI/CD | GitHub Actions (15 workflows) | Blocking gates: Semgrep, CodeQL, Trivy, tests |
| Observability | Sentry | Error tracking, performance monitoring |

## Package Dependency Graph

```
                    shared-constants
                    /      |       \
                contracts  basis   atsf-core
                /     \      |        |
           cognigate  sdk  proof-plane
              |        |
         car-client  car-cli
              |
          car-spec

─── Platform (private) ───

         platform-core
         /    |     \
    security council  a3i
              |       |
           runtime   ai-gateway
              |
         infrastructure
```

Public packages (above the line) have no dependency on private packages. Private packages consume public packages via npm.

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Governance decision latency (P99) | <10ms | Not benchmarked |
| Trust score computation | <1ms | Passes in atsf-core tests |
| PROOF chain append | <5ms | Not benchmarked |
| CAR lookup | <2ms | Not benchmarked |
| API cold start | <500ms | Vercel serverless |
| Build time (full monorepo) | <60s | ~45s (turbo cached) |
| Test suite (all packages) | <120s | ~67s |

## Key Technical Decisions (ADRs)

| ADR | Decision | Rationale |
|-----|----------|-----------|
| ADR-001 | Turborepo monorepo | Single source of truth, atomic changes |
| ADR-002 | 8-tier trust model (not 5, not 10) | Granularity vs. complexity balance |
| ADR-003 | Supabase over custom auth | RLS, auth, real-time — all-in-one |
| ADR-004 | Drizzle ORM over Prisma | Lighter, SQL-first, better monorepo support |
| ADR-005 | Dual-hash PROOF chains | SHA-256 content hash + chain hash for tamper detection |
| ADR-006 | Apache-2.0 for public packages | Enterprise-friendly, patent grant |

Full ADR archive: `docs/adr/`

## Security Architecture

### Supply Chain

- **Semgrep SAST**: Blocking in CI, custom rules for governance patterns
- **CodeQL**: GitHub-native static analysis
- **Trivy**: Container vulnerability scanning
- **Gitleaks**: Secret detection in commits
- **License check**: FOSSA-compatible, blocks copyleft in dependencies
- **SBOM**: CycloneDX generation on release
- **npm provenance**: Attestation on publish

### Application Security

- **CSP headers**: X-Frame-Options, X-Content-Type-Options on all apps
- **CORS**: Strict origin policy on APIs
- **Rate limiting**: Per-key rate limits on governance API
- **Input validation**: Zod schemas at all API boundaries (via contracts)
- **RLS**: PostgreSQL row-level security for tenant isolation

### Cryptographic

- **PROOF chain**: SHA-256 dual-hash (content integrity + chain integrity)
- **WebAuthn**: FIDO2/passkey support (scoped to vorion.org RP ID)
- **Future**: DPoP tokens, TEE attestation (Phase 8, Q3 2026)

## Development Setup

```bash
# Prerequisites: Node.js >= 20, npm >= 10
git clone https://github.com/voriongit/vorion.git
cd vorion
npm install

# Build all packages
npx turbo run build

# Run all tests (excluding a3i — known failures)
npx turbo run test --filter='./packages/*' --filter='!@vorion/a3i'

# Typecheck
npx turbo run typecheck

# Lint
npx turbo run lint
```

### Key directories

```
vorion/
├── packages/           # 25 npm packages
├── apps/               # 12 deployable applications
├── docs/               # ADRs, specs, roadmaps
├── .github/workflows/  # 15 CI/CD pipelines
└── examples/           # Integration examples
```

## Release Engineering

### Publishing Pipeline

`publish-packages.yml` handles npm publishing:
- Supports all 18 TypeScript packages
- Dry-run mode for validation
- npm provenance attestation
- Automated changelog generation

### Release Pipeline

`release.yml` handles tagged releases:
- Tag → build → test → GitHub Release → Vercel deploy
- Semver tags trigger corresponding workflows
- SBOM attached to each release

### Docker

```dockerfile
# Multi-stage build defined
# Dockerfile (full) and Dockerfile.lite (minimal)
```

## Wave-by-Wave Technical Focus

| Wave | Date | Technical Work |
|------|------|----------------|
| W1 (Feb 26) | Polish 4 packages, README, tests, `npm publish` |
| W2 (Mar 16) | SDK quickstart, Docker image, API hardening, Python test enforcement |
| W3 (Mar 30) | Fix 34 a3i tests, RBAC persistence, auth implementation, security stubs |
| W4 (Apr 20) | Dashboard data layer, monitoring integrations, admin RBAC |
| W5 (May 4) | Interactive docs, code examples, performance benchmarks, v1.0.0 tag |

## Known Technical Debt

| Item | Severity | Package | Notes |
|------|----------|---------|-------|
| 34 failing tests | High | a3i | Trust, authorization, orchestration modules |
| RBAC TODO stubs | High | platform-core | DB persistence not implemented |
| Auth stubs | High | aurais | signup/login are placeholders |
| Password verification stub | High | security | Line 125 in auth.ts |
| ESLint 8/9 conflict | Low | apps | Next.js bundles ESLint 8, root uses 9 |
| 2,000 lint warnings | Low | all | 1,383 auto-fixable |
| Python tests not enforced | Low | cognigate-api | continue-on-error in CI |
| Go/Python SDKs untested | Low | sdk packages | No CI pipeline |

## One Line

25 packages, 452 tests, 15 CI pipelines, zero critical vulns, shipping in 5 waves through May 4.
