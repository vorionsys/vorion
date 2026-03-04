# Sprint: Foundation Hardening
## "A Gift to the Future" - Phase 1

**Goal:** Make Vorion's CI, tests, and security posture production-grade so any developer evaluating the repo says "all bases covered."

**Duration:** 1 sprint (2 weeks)
**Branch:** `master` (direct commits for CI/infra, PRs for code changes)

---

## Sprint Backlog

### Epic 1: Zero Failing Tests (Priority: CRITICAL)

| # | Story | Status | Estimate | Notes |
|---|-------|--------|----------|-------|
| 1.1 | Fix 8 AgentAnchor tier boundary test failures | TODO | 3h | `tests/lib/services/phase6-service.test.ts` — tier promotion assertions misaligned with 8-tier model (T0-T7). Verify `getTierFromScore()` boundaries match test expectations |
| 1.2 | Fix agentanchor-sdk test failure in CI | TODO | 2h | Failing in CI but may pass locally. Check if it needs built dependencies or env vars |
| 1.3 | Fix cognigate-api test discovery | TODO | 1h | vitest can't find test files — likely wrong test pattern in vitest.config or tests not in expected directory |
| 1.4 | Resolve platform-core drizzle-orm version conflict | TODO | 4h | `packages/contracts/node_modules/drizzle-orm` vs root `node_modules/drizzle-orm` — deduplicate with npm overrides or pin version in contracts |

**Acceptance Criteria:** `npx turbo test` passes across all packages and apps with zero failures.

---

### Epic 2: CI Discipline (Priority: CRITICAL)

| # | Story | Status | Estimate | Notes |
|---|-------|--------|----------|-------|
| 2.1 | Make test-packages blocking in ci-success gate | TODO | 30m | Move `test-packages` from non-blocking warning to required check in ci-success job |
| 2.2 | Make test-apps blocking in ci-success gate | TODO | 30m | Same treatment — tests must pass for CI to be green |
| 2.3 | Remove all platform-core exclusions after Epic 1.4 | TODO | 30m | Remove `--filter="!@vorionsys/platform-core"` from ci.yml, preview.yml |
| 2.4 | Remove agentanchor/cognigate-api test exclusions after 1.1/1.3 | TODO | 30m | Remove `--filter="!@vorion/agentanchor"` and `--filter="!@vorionsys/cognigate-api"` from ci.yml |
| 2.5 | Make Semgrep SAST blocking | TODO | 3h | Triage 144 pre-existing findings: suppress false positives with inline `nosemgrep`, fix real issues, remove `continue-on-error: true` |
| 2.6 | Add Codecov coverage gate | TODO | 1h | Create `codecov.yml` with 70% minimum threshold, no-decrease-on-PR rule |

**Acceptance Criteria:** CI red = cannot merge. No `continue-on-error` in security/test jobs. Coverage gates enforced.

**Dependency:** Epic 1 must complete before Epic 2 stories 2.1-2.4.

---

### Epic 3: Security Posture (Priority: HIGH)

| # | Story | Status | Estimate | Notes |
|---|-------|--------|----------|-------|
| 3.1 | Create SECURITY.md at repo root | TODO | 1h | Standard responsible disclosure policy. Reference existing `security.txt`. Include supported versions, reporting instructions, PGP key |
| 3.2 | Verify SBOM workflow runs and publishes | TODO | 1h | `sbom.yml` exists — confirm it triggers, generates SBOM, and artifacts are downloadable |
| 3.3 | Verify schema-check workflow runs | TODO | 1h | `schema-check.yml` exists — confirm Drizzle schema drift detection is active |
| 3.4 | Delete or fix disabled docker-test workflow | TODO | 30m | `docker-test.yml` is disabled with a comment. Either fix it or remove it — dead workflows give false confidence |

**Acceptance Criteria:** SECURITY.md published, SBOM generated on every release, no disabled workflows in repo.

---

### Epic 4: Tenant Isolation Proof (Priority: HIGH)

| # | Story | Status | Estimate | Notes |
|---|-------|--------|----------|-------|
| 4.1 | Write tenant isolation integration test | TODO | 3h | Create test: register Agent under Tenant A, query as Tenant B, assert zero results. Cover agents, trust scores, attestations, governance decisions |
| 4.2 | Add row-level security assertion to CI | TODO | 1h | Ensure every `SELECT` in platform-core includes `WHERE tenant_id = ?` — can be a static analysis check or grep-based CI step |

**Acceptance Criteria:** Automated proof that tenant data isolation is enforced and tested on every CI run.

---

### Epic 5: Documentation for Evaluators (Priority: MEDIUM)

| # | Story | Status | Estimate | Notes |
|---|-------|--------|----------|-------|
| 5.1 | Write 5 Architecture Decision Records (ADRs) | TODO | 3h | (1) Monorepo + Turborepo, (2) Next.js + React 19, (3) Supabase Auth, (4) Drizzle ORM, (5) Proof Plane dual-hash design |
| 5.2 | Create compliance mapping document | TODO | 4h | Map Vorion features to NIST AI RMF controls (Govern, Map, Measure, Manage). Consolidate existing docs in `docs/basis-docs/` and `docs/constitution/` into single reference |
| 5.3 | Polish root README.md | TODO | 2h | Monorepo setup guide, architecture diagram, package dependency graph, quick start for contributors |

**Acceptance Criteria:** A new developer can understand the architecture, the "why" behind decisions, and the compliance posture within 30 minutes of reading.

---

## Sprint Capacity

| Epic | Stories | Total Estimate |
|------|---------|---------------|
| 1. Zero Failing Tests | 4 | 10h |
| 2. CI Discipline | 6 | 6h |
| 3. Security Posture | 4 | 3.5h |
| 4. Tenant Isolation | 2 | 4h |
| 5. Documentation | 3 | 9h |
| **Total** | **19 stories** | **32.5h** |

---

## Definition of Done

- [ ] All package and app tests pass (zero exclusions except platform-core if drizzle fix deferred)
- [ ] CI Success gate requires all test jobs to pass
- [ ] Semgrep SAST runs blocking with zero un-triaged findings
- [ ] Codecov coverage gate at 70% minimum
- [ ] SECURITY.md published at repo root
- [ ] SBOM generated on releases
- [ ] Tenant isolation tested in CI
- [ ] 5 ADRs written
- [ ] NIST AI RMF compliance mapping document exists
- [ ] Root README updated with architecture overview

---

## Priority Order (Execute in this sequence)

1. **Epic 1.1** — Fix tier boundary tests (unblocks making tests blocking)
2. **Epic 1.2** — Fix agentanchor-sdk CI test failure
3. **Epic 2.1 + 2.2** — Make tests blocking in CI gate
4. **Epic 3.1** — Create SECURITY.md
5. **Epic 1.4** — Resolve drizzle-orm conflict (biggest risk item)
6. **Epic 2.5** — Triage Semgrep findings
7. **Epic 4.1** — Tenant isolation test
8. **Epic 5.2** — Compliance mapping
9. **Epic 5.1** — ADRs
10. Everything else

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Drizzle-orm version fix cascades to schema changes | Test locally with `npm ls drizzle-orm` first, pin version in overrides |
| Semgrep triage takes longer than 3h (144 findings) | Batch suppress obvious false positives (info-level, test files), focus real fixes on critical/high |
| Tier boundary test fix reveals logic bug, not just test bug | If scoring logic changed intentionally, update tests to match; if accidental, revert scoring |
| platform-core fix deferred | Acceptable for this sprint if all other tests pass and are blocking |

---

*Sprint plan generated by BMad Master for Vorion Foundation Hardening.*
*"Every AI agent should be accountable. Every governance decision should be provable."*
