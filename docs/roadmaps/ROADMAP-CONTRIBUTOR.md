# Vorion for Contributors

> **Read time**: 7 minutes | **Audience**: Open-source contributors, developers, security researchers

## What You're Contributing To

Vorion is an AI governance platform — open standards, open source, open community. We believe the infrastructure for governing AI agents should be built in the open, not behind closed doors.

**The core premise**: Every AI agent needs an identity (CAR), behavioral constraints (BASIS), real-time enforcement (Cognigate), and a tamper-proof audit trail (PROOF). We're building all four.

## Current State of the Codebase

Honest numbers as of February 2026:

| Metric | Value |
|--------|-------|
| Total packages | 25 |
| Published npm packages | 3 (@vorionsys scope) |
| Tests passing | 452+ |
| Test files | 50+ |
| CI/CD workflows | 15 |
| ADRs | 18 |
| TypeScript coverage | ~80% of packages |
| Known test failures | 34 (in @vorionsys/a3i) |
| Lint errors | 0 |
| Lint warnings | ~2,000 (1,383 auto-fixable) |
| Critical vulnerabilities | 0 |

### What's Strong

- **atsf-core**: 401 tests, comprehensive trust scoring
- **shared-constants, basis, contracts**: Clean, well-typed, published
- **CI/CD**: Blocking security gates (Semgrep, CodeQL, Trivy, license check)
- **Architecture**: 18 ADRs documenting every major decision

### What Needs Help

- **a3i**: 34 test failures in the agent orchestration layer
- **platform-core**: RBAC service has TODO stubs for DB persistence
- **security**: Password verification is a stub
- **Docs**: Package READMEs are minimal
- **Python SDKs**: No CI enforcement, minimal tests

## High-Impact Contribution Areas

Ranked by impact to the project:

### Tier 1: Critical Path (Blocks Releases)

| Area | Package | What's Needed | Difficulty |
|------|---------|---------------|------------|
| Fix a3i tests | `@vorionsys/a3i` | 34 failing tests in trust, authorization, orchestration | Hard |
| Package READMEs | All packages | Install, usage, API docs for each of 10 public packages | Easy |
| RBAC persistence | `platform-core` | Implement DB queries for user_roles, role_permissions | Medium |

### Tier 2: High Value

| Area | Package | What's Needed | Difficulty |
|------|---------|---------------|------------|
| Lint cleanup | All packages | Run `eslint --fix`, resolve remaining warnings | Easy |
| Python test coverage | `cognigate-api` | Add pytest fixtures, enforce CI | Medium |
| Security hardening | `security` | Implement password verification, review auth flows | Hard |
| Docker optimization | Root | Multi-stage build, minimize image size | Medium |

### Tier 3: Community Building

| Area | What's Needed | Difficulty |
|------|---------------|------------|
| Examples | End-to-end governance flow examples | Easy-Medium |
| Learning content | Tutorials for Kaizen platform | Easy |
| Translations | README + docs in other languages | Easy |
| Benchmarks | Performance benchmarks for governance pipeline | Medium |

## Architecture Quickstart

```
User/Agent ──► SDK ──► Cognigate API ──► BASIS Rules
                            │                  │
                            ▼                  ▼
                       PROOF Chain        Trust Score
                       (immutable)        (ATSF 8-tier)
```

**Key concepts**:
- **CAR ID**: Mission certification — an agent's verified identity, capabilities, and authorized domains
- **BASIS**: Mission standards — the foundational behavioral specifications all governance is built on
- **Cognigate**: Mission gateway — the checkpoint agents pass through for every operation
- **PROOF**: Flight recorder — cryptographic chain of evidence for every governance decision
- **ATSF**: Clearance authority — 8 clearance tiers (T0-T7), from simulation-only to autonomous authority

## Getting Started

### 1. Clone and build

```bash
git clone https://github.com/voriongit/vorion.git
cd vorion
npm install
npx turbo run build
```

### 2. Run tests

```bash
npx turbo run test --filter='./packages/*'
```

### 3. Find something to work on

- Look at [GitHub Issues](https://github.com/voriongit/vorion/issues) tagged `good-first-issue`
- Check the contribution areas table above
- Run `eslint --fix` on any package — guaranteed easy wins

### 4. Submit a PR

- Branch from `master`
- Include tests for new code
- CI must pass (Semgrep, CodeQL, tests, typecheck)
- One reviewer required

## Contribution Guidelines

### Code Standards

- TypeScript strict mode for all packages
- Tests required for new functionality
- No `any` types without justification
- Security-sensitive code gets extra review

### Commit Convention

```
type(scope): description

feat(cognigate): add batch governance endpoint
fix(a3i): resolve trust calculator null check
docs(sdk): add quickstart example
test(atsf): add edge cases for T3-T4 boundary
```

### What We Value

- **Tests over comments** — tests prove it works, comments promise it works
- **Small PRs over big ones** — easier to review, faster to merge
- **Honest code over clever code** — readability wins
- **Security first** — if you find a vulnerability, report it via SECURITY.md

## Bounty Program

$50K bounty pool for Wave 5 (May 4) community launch:

| Category | Bounty Range |
|----------|-------------|
| Critical bug fix | $500 - $2,000 |
| Security vulnerability (responsible disclosure) | $1,000 - $5,000 |
| New SDK language binding | $2,000 - $5,000 |
| Comprehensive test suite for untested package | $500 - $1,500 |
| Documentation overhaul | $250 - $750 |

Details and formal program launch at Wave 5.

## Release Alignment

Your contributions ship in waves:

| Wave | Date | Contribution Focus |
|------|------|-------------------|
| W1 (Feb 26) | README polish, test coverage for 4 foundation packages |
| W2 (Mar 16) | SDK examples, quickstart guide, Docker improvements |
| W3 (Mar 30) | a3i test fixes, RBAC implementation, security hardening |
| W4 (Apr 20) | Dashboard features, monitoring, operational tooling |
| W5 (May 4) | Learning content, tutorials, community infrastructure |

## npm Scope

All packages publish under `@vorionsys` on npm. The scope is globally unique and represents our strongest community identifier.

## One Line

This is governance infrastructure for every AI agent that will ever exist. Help us build it right.
