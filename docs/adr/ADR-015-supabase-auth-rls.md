# ADR-015: Supabase Auth with Row-Level Security

**Status:** Accepted
**Date:** 2026-02-11
**Deciders:** Vorion Architecture Team

## Context

Vorion is a multi-tenant AI governance platform where every data query must be scoped by `tenant_id`. The platform requires authentication, authorization, and strict data isolation without building custom auth infrastructure. NIST AI RMF and EU AI Act compliance requirements mandate auditable access control, immutable audit records, and provable tenant isolation.

Building custom auth (password hashing, MFA, session management, social login) is high-risk and high-maintenance. We need a solution that provides defense-in-depth so that even application-level bugs cannot leak cross-tenant data.

## Decision

Use **Supabase Auth** for authentication combined with **PostgreSQL Row-Level Security (RLS)** for data isolation at the database engine level.

### Architecture Pattern

1. **Supabase Auth** handles JWT-based authentication with email/password and social login providers. `@supabase/ssr` integrates with Next.js middleware for server-side session management.
2. **Session context** is set via `SET app.current_tenant_id` before every query, binding the connection to a tenant.
3. **RLS policies** on every tenant-scoped table enforce `tenant_id = get_current_tenant_id()` at the database engine level, making cross-tenant data access structurally impossible.
4. **`get_current_tenant_id()`** is a SQL helper function that reads `current_setting('app.current_tenant_id')` from the session context.
5. **Service role** bypasses RLS for system operations (migrations, background jobs, scheduled tasks).

### Key Patterns

- RLS enabled on **all tables** containing `tenant_id`
- **Append-only policies** on `audit_records` -- no UPDATE or DELETE permitted
- **Immutable `policy_versions`** -- once created, records cannot be modified
- `@supabase/ssr` middleware validates JWT and sets tenant context on every request

## Consequences

### Positive

- **Defense-in-depth** -- even application bugs cannot leak cross-tenant data; RLS is enforced by the database engine
- **Zero custom auth code** -- Supabase manages password hashing, MFA, social login, and session refresh
- **Compliance-ready** -- append-only audit records and immutable policy versions satisfy NIST AI RMF and EU AI Act access control requirements
- **Audit trail immutability** -- database-level policies prevent tampering with audit records

### Negative

- **Query overhead** -- RLS adds ~1-2ms per query for policy evaluation
- **Debugging complexity** -- RLS policy issues are harder to diagnose than application-level WHERE clauses
- **Session discipline** -- `SET app.current_tenant_id` must be called on every connection; missing it silently returns no rows
- **Vendor dependency** -- Supabase Auth is the sole authentication provider; migration requires replacing JWT issuance

### Mitigations

- Connection pooling wrapper that enforces `SET app.current_tenant_id` automatically
- Integration tests that verify RLS blocks cross-tenant access
- Monitoring for queries returning zero rows unexpectedly (missing tenant context)

## Alternatives Considered

| Alternative | Reason Rejected |
|-------------|----------------|
| Auth0 | Expensive at scale, per-MAU pricing unsuitable for multi-tenant platform |
| Custom JWT + middleware | More code, more attack surface, no defense-in-depth |
| Application-level `WHERE tenant_id =` | Single layer of defense; application bugs can leak data |

## References

- [ADR-010: Persistence Strategy](ADR-010-persistence-strategy.md)
- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [PostgreSQL Row-Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
