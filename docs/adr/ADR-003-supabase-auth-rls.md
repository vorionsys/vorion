# ADR-003: Supabase Auth with Row-Level Security

## Status: Accepted

## Date: 2026-02-25

## Context

Vorion is a multi-tenant AI governance platform where strict tenant data isolation is a non-negotiable security requirement. Every database query must be scoped to the requesting tenant's `tenant_id`. The platform manages sensitive governance data: trust scores, policy decisions, agent behavioral histories, and cryptographic proof chains. A data leak between tenants would be a catastrophic compliance failure under NIST AI RMF, EU AI Act, and ISO 42001 requirements.

The platform requires:

1. **Authentication** -- User login with email/password, social providers, and eventually enterprise SSO (SAML/OIDC).
2. **Tenant isolation** -- Structural guarantee that application-level bugs cannot leak cross-tenant data. A `WHERE tenant_id = ?` clause in application code is a single point of failure.
3. **Immutable audit records** -- Proof chain records and policy versions must be append-only at the database level, not just enforced by application logic.
4. **Minimal custom auth code** -- Custom auth infrastructure (password hashing, MFA, session management, token refresh) is high-risk and high-maintenance for a small team.

The Supabase integration is present across the codebase:

- **`packages/atsf-core`** provides `supabase.ts` persistence adapter and `supabase-intent-repository.ts` for intent storage.
- **`apps/agentanchor`** uses Supabase Auth via middleware for SSR session management, with migration scripts (`run-all-migrations.js`, `sync-to-supabase.js`), seed data (`supabase/seeds/bai-agents.sql`), and test fixtures.
- **Database schemas** in `packages/contracts/src/db/` define `tenant_id`-bearing tables for agents, proofs, trust records, escalations, intents, operations, webhooks, and RBAC.

## Decision

Use **Supabase Auth** for authentication combined with **PostgreSQL Row-Level Security (RLS)** for tenant isolation at the database engine level.

### Architecture

```
User Request
    |
    v
[Next.js Middleware]         -- @supabase/ssr validates JWT, extracts tenant_id
    |
    v
[SET app.current_tenant_id]  -- Connection-level session context
    |
    v
[Drizzle ORM Query]          -- Application queries are tenant-unaware
    |
    v
[PostgreSQL RLS Policy]      -- Engine enforces: tenant_id = get_current_tenant_id()
    |
    v
[Data (scoped)]              -- Only requesting tenant's rows returned
```

1. **Supabase Auth** handles JWT-based authentication with email/password and social login providers. `@supabase/ssr` integrates with Next.js middleware for server-side session management.
2. **Session context** is set via `SET app.current_tenant_id` before every query, binding the database connection to a specific tenant.
3. **RLS policies** on every tenant-scoped table enforce `tenant_id = get_current_tenant_id()` at the PostgreSQL engine level, making cross-tenant data access structurally impossible.
4. **`get_current_tenant_id()`** is a SQL function that reads `current_setting('app.current_tenant_id')` from the connection context.
5. **Service role** bypasses RLS for system operations: database migrations, background jobs (BullMQ workers), scheduled tasks (node-cron), and batch proof chain verification.

### RLS Policy Design

| Table Category | SELECT | INSERT | UPDATE | DELETE |
|---------------|--------|--------|--------|--------|
| Tenant-scoped data (agents, trust, operations) | `tenant_id = get_current_tenant_id()` | `tenant_id = get_current_tenant_id()` | `tenant_id = get_current_tenant_id()` | `tenant_id = get_current_tenant_id()` |
| Proof records | `tenant_id = get_current_tenant_id()` | `tenant_id = get_current_tenant_id()` | **DENIED** | **DENIED** |
| Policy versions | `tenant_id = get_current_tenant_id()` | `tenant_id = get_current_tenant_id()` | **DENIED** | **DENIED** |
| RBAC assignments | `tenant_id = get_current_tenant_id()` | Admin role required | Admin role required | **DENIED** |

The proof records and policy versions tables enforce **append-only semantics** at the database level. Even if application code contains a bug that issues an UPDATE or DELETE, PostgreSQL will reject it. This is essential for the Proof Plane's tamper-evidence guarantees.

### RBAC Integration

The `packages/contracts/src/db/rbac.ts` schema defines role-based access control with 8 granular role levels (R_L0 through R_L8). RLS policies reference these roles for permission checks on sensitive operations like agent promotion, policy modification, and proof chain export.

## Consequences

### Positive

- **Defense-in-depth for tenant isolation** -- Even if application code has a bug that omits a tenant filter, RLS prevents cross-tenant data access at the database engine level. This is a structural guarantee, not a policy one.
- **Zero custom auth code** -- Supabase manages password hashing (bcrypt), MFA (TOTP/WebAuthn), social login (Google, GitHub), session refresh, and JWT issuance. The platform has 120+ auth-related tests validating integration behavior without maintaining the auth infrastructure itself.
- **Immutable audit records** -- Database-level INSERT-only policies on proof and policy version tables cannot be bypassed by application code, satisfying NIST AI RMF GOVERN and EU AI Act audit trail requirements.
- **Edge auth via middleware** -- `@supabase/ssr` validates JWTs in Next.js middleware before any page renders, preventing unauthenticated access to server components.

### Negative

- **Query overhead** -- RLS adds ~1-2ms per query for policy evaluation. For high-frequency trust score lookups, this overhead is measurable.
- **Debugging complexity** -- RLS policy failures return empty result sets rather than errors, making silent data access failures harder to diagnose than explicit permission errors.
- **Session discipline** -- `SET app.current_tenant_id` must be called on every database connection. If a connection pool serves a request without setting the tenant context, queries silently return no rows.
- **Vendor dependency** -- Supabase Auth is the sole authentication provider. Migration to another provider requires replacing JWT issuance, session management, and all SSR middleware integration.

### Mitigations

- Connection pooling wrapper automatically calls `SET app.current_tenant_id` on every checkout, ensuring tenant context is always set.
- Integration tests verify RLS blocks cross-tenant access by issuing queries with incorrect tenant context and asserting empty results.
- Monitoring alerts on queries returning unexpectedly zero rows from tenant-scoped tables.
- Supabase Auth is used for JWT issuance only; the platform's RBAC layer is independent and portable.

## Alternatives Considered

| Alternative | Reason for Rejection |
|-------------|---------------------|
| **Auth0** | Per-MAU pricing becomes expensive at scale for a multi-tenant platform with many agent service accounts. No database-level isolation. |
| **Clerk** | Developer-friendly but lacks PostgreSQL RLS integration. Tenant isolation would remain application-layer only. |
| **Custom JWT + middleware** | More code, more attack surface, no defense-in-depth. Requires maintaining password hashing, MFA, session refresh, and token rotation. |
| **Application-level `WHERE tenant_id =`** | Single layer of defense. Any application bug that omits or incorrectly sets the tenant filter leaks data. Insufficient for compliance requirements. |

## References

- [Supabase Auth persistence adapter](/packages/atsf-core/src/persistence/supabase.ts)
- [Database schema with RLS-ready tables](/packages/contracts/src/db/)
- [RBAC schema](/packages/contracts/src/db/rbac.ts)
- [AgentAnchor Supabase integration](/apps/agentanchor/supabase/)
- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [PostgreSQL Row-Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
