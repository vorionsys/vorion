# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the Vorion platform.

## Index

### Platform Infrastructure (Evaluator Series)

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-001](ADR-001-monorepo-turborepo.md) | Monorepo with Turborepo | Accepted | 2026-02-25 |
| [ADR-002](ADR-002-nextjs-react-19.md) | Next.js with React 19 | Accepted | 2026-02-25 |
| [ADR-003](ADR-003-supabase-auth-rls.md) | Supabase Auth with Row-Level Security | Accepted | 2026-02-25 |
| [ADR-004](ADR-004-drizzle-orm.md) | Drizzle ORM for Database Access | Accepted | 2026-02-25 |
| [ADR-005](ADR-005-proof-plane-dual-hash.md) | Proof Plane Dual-Hash Audit Chain | Accepted | 2026-02-25 |

### Governance Architecture

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-001](ADR-001-a3i-fast-data-layer.md) | A3I as Fast Data Layer | Accepted | 2026-01-31 |
| [ADR-002](ADR-002-8-tier-trust-model.md) | 8-Tier Trust Model with Human Gates | Accepted | 2026-01-31 |
| [ADR-003](ADR-003-three-separate-sdks.md) | Three Separate SDKs | Accepted | 2026-01-31 |
| [ADR-004](ADR-004-trust-computed-at-runtime.md) | Trust Computed at Runtime | Accepted | 2026-01-31 |
| [ADR-005](ADR-005-agent-lifecycle-state-machine.md) | Agent Lifecycle State Machine | Accepted | 2026-01-31 |
| [ADR-006](ADR-006-user-decides-risk.md) | User Decides Risk, System Enforces Caps | Accepted | 2026-01-31 |
| [ADR-007](ADR-007-tier-based-sandbox-isolation.md) | Tier-Based Sandbox Isolation | Accepted | 2026-01-31 |
| [ADR-008](ADR-008-a2a-communication-protocol.md) | A2A Communication Protocol | Accepted | 2026-01-31 |
| [ADR-009](ADR-009-observability-operations.md) | Observability & Operations | Accepted | 2026-01-31 |
| [ADR-010](ADR-010-persistence-strategy.md) | Persistence Strategy | Accepted | 2026-01-31 |
| [ADR-011](ADR-011-versioning-strategy.md) | Versioning Strategy | Accepted | 2026-01-31 |
| [ADR-012](ADR-012-sdk-language-support.md) | SDK Language Support | Accepted | 2026-01-31 |
| [ADR-013](ADR-013-monorepo-turborepo.md) | Monorepo with Turborepo | Accepted | 2026-02-11 |
| [ADR-014](ADR-014-nextjs-react-19.md) | Next.js 15 with React 19 | Accepted | 2026-02-11 |
| [ADR-015](ADR-015-supabase-auth-rls.md) | Supabase Auth with Row-Level Security | Accepted | 2026-02-11 |
| [ADR-016](ADR-016-drizzle-orm.md) | Drizzle ORM for Database Access | Accepted | 2026-02-11 |
| [ADR-017](ADR-017-proof-plane-dual-hash.md) | Proof Plane with Dual-Hash Audit Chain | Accepted | 2026-02-11 |
| [ADR-018](ADR-018-car-string-semantics.md) | CAR String Semantics | Accepted | 2026-02-11 |

## Template

When adding new ADRs, use this template:

```markdown
# ADR-XXX: Title

**Status:** Proposed | Accepted | Deprecated | Superseded
**Date:** YYYY-MM-DD
**Deciders:** Team/Individuals

## Context

What is the issue that we're seeing that is motivating this decision?

## Decision

What is the change that we're proposing and/or doing?

## Consequences

### Positive
- ...

### Negative
- ...

### Mitigations
- ...

## Alternatives Considered

1. **Alternative 1** - Rejected because...

## References

- Links to related docs
```

## Status Definitions

| Status | Meaning |
|--------|---------|
| **Proposed** | Under discussion |
| **Accepted** | Decision made, implementation planned or in progress |
| **Deprecated** | No longer recommended but still valid |
| **Superseded** | Replaced by a newer ADR |
