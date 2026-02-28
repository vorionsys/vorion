# Risk Register v1 — Wave 1 Launch

**Last updated:** 2026-02-27
**Owner:** Engineering Lead
**Status:** Active — pre-launch

---

## Risk Scoring

| Rating | Likelihood | Impact |
|--------|-----------|--------|
| **5** | Near certain | Critical / launch blocker |
| **4** | Likely | Major / degraded experience |
| **3** | Possible | Moderate / workaround exists |
| **2** | Unlikely | Minor / cosmetic |
| **1** | Rare | Negligible |

**Risk Score** = Likelihood x Impact (max 25)

---

## Active Risks

### R1 — Pre-existing Phase 6 test failures in atsf-core

| Field | Value |
|-------|-------|
| Likelihood | 5 |
| Impact | 2 |
| Score | **10** |
| Owner | Engineering Lead |
| Status | Accepted |

**Description:** 6 tests in `packages/atsf-core/tests/phase6/phase6.test.ts` reference unimplemented features (`validateCreationType`, `CREATION_TYPE_MODIFIERS`, `CANONICAL_TRUST_PRESETS`). These are forward-looking tests for Phase 6 capabilities not yet shipped.

**Mitigation:** Tests are isolated to the Phase 6 test file and do not affect other packages or CI gates. The test file should be marked with `.skip` or moved to a `future/` directory before the public launch so CI is fully green on `main`.

**Action required:** Skip or quarantine the 6 failing tests before launch tag.

---

### R2 — Turbo cache staleness causing false CI failures

| Field | Value |
|-------|-------|
| Likelihood | 3 |
| Impact | 3 |
| Score | **9** |
| Owner | Engineering Lead |
| Status | Mitigated |

**Description:** Turbo's local/remote cache occasionally serves stale results, causing transient test failures in packages like `car-client`, `cognigate-api`, and `shared-constants`. Running with `--force` resolves.

**Mitigation:** CI workflows should use `--force` for release-gate runs. Local developers can use `npx turbo --force` when seeing unexpected failures. Consider disabling Turbo remote caching for release pipelines.

---

### R3 — Firebase/Gemini API key exposure in client-side Kaizen code

| Field | Value |
|-------|-------|
| Likelihood | 2 |
| Impact | 4 |
| Score | **8** |
| Owner | Engineering Lead |

**Description:** The Kaizen Studio page (`apps/kaizen/src/app/studio/page.tsx`) makes client-side calls to the Gemini API using `NEXT_PUBLIC_GEMINI_API_KEY`. Public API keys are visible in browser network traffic.

**Mitigation:** Firebase API keys are designed to be public (security enforced by Firestore rules). The `NEXT_PUBLIC_GEMINI_API_KEY` should be rate-limited via Google Cloud quotas. Consider proxying through a server-side API route for production. Verify Firestore security rules are locked down before launch.

---

### R4 — No rollback playbook formalized

| Field | Value |
|-------|-------|
| Likelihood | 3 |
| Impact | 4 |
| Score | **12** |
| Owner | SRE/Infra Lead |
| Status | Open |

**Description:** The launch plan references a `Rollback Playbook v1` as a Wave 1 deliverable. Individual DEPLOYMENT.md files exist for cognigate-api (Fly.io) and basis (smart contracts), but there is no unified rollback playbook covering all services.

**Mitigation:** Create a unified `ROLLBACK-PLAYBOOK.md` covering:
- Vercel (kaizen/vorion.org): Instant rollback via dashboard or `vercel rollback`
- Fly.io (cognigate-api): `fly releases rollback` or `fly deploy --image <previous>`
- Smart contracts (basis): Immutable — document pause/upgrade pattern
- npm packages: `npm unpublish` within 72h or `npm deprecate`

**Action required:** Draft and review rollback playbook before staging dress rehearsal.

---

### R5 — Coverage gates at minimum thresholds

| Field | Value |
|-------|-------|
| Likelihood | 2 |
| Impact | 2 |
| Score | **4** |
| Owner | Engineering Lead |
| Status | Accepted |

**Description:** Several packages have coverage thresholds set at 30% (lines/branches/statements). While all gates currently pass, the thresholds are low for a production framework. Cognigate was at 20% before Wave 1 fixes brought it to 53%.

**Mitigation:** Accepted for Wave 1. Plan to ratchet thresholds upward in Wave 4 (post-launch optimization). Each PR that adds tests should increase coverage, and thresholds should be bumped quarterly.

---

### R6 — Dependency on external services for Kaizen functionality

| Field | Value |
|-------|-------|
| Likelihood | 3 |
| Impact | 3 |
| Score | **9** |
| Owner | Product Lead |
| Status | Accepted |

**Description:** Kaizen (`learn.vorion.org`) depends on Firebase (auth + Firestore), Google Gemini API, and optionally Supabase. Outages in any of these services degrade the learning platform.

**Mitigation:** Core learning content (paths, modules, quizzes) works offline/without Firebase. The Nexus AI chat feature gracefully degrades when API keys are missing (simulated responses). Studio is explicitly an experimental feature. Monitor upstream service status and document fallback behavior.

---

### R7 — Secret rotation not automated

| Field | Value |
|-------|-------|
| Likelihood | 2 |
| Impact | 3 |
| Score | **6** |
| Owner | SRE/Infra Lead |
| Status | Accepted |

**Description:** The `ENV_SECRETS_MATRIX.md` documents secrets and their rotation cadence, but rotation is manual. No automated rotation or expiry alerting exists.

**Mitigation:** Acceptable for Wave 1 given limited production surface area. Plan automated rotation tooling for Wave 4. Set calendar reminders for 90-day rotation cycle on critical secrets (API keys, JWT secrets, blockchain deployer keys).

---

## Resolved Risks

### R-RESOLVED-1 — Prettier formatting violations (384 files)
**Resolution:** Fixed with `npm run format`. All files now conform. Resolved 2026-02-27.

### R-RESOLVED-2 — Circular dependencies in atsf-core (10 cycles)
**Resolution:** Extracted types into dedicated `types.ts` files for governance, intent, trust-engine, enforce modules. `madge --circular` now returns clean. Resolved 2026-02-27.

### R-RESOLVED-3 — Cognigate coverage below threshold (20% vs 30%)
**Resolution:** Added 39 tests across `proof-bridge.test.ts` and `webhooks.test.ts`. Coverage now at 53.29% (lines). Resolved 2026-02-27.

### R-RESOLVED-4 — ESLint warnings in Kaizen app
**Resolution:** Fixed all `react-hooks/exhaustive-deps` warnings in quiz/page.tsx, studio/page.tsx, and Quiz.tsx. 0 warnings remaining. Resolved 2026-02-27.

### R-RESOLVED-5 — Hardcoded secrets in source code
**Resolution:** Removed `sk-1234` fallback from ai-gateway (replaced with validation + empty string). Removed hardcoded JWT development secret from atsf-core config. Resolved 2026-02-27.

---

## Risk Summary

| Score Range | Count | Action |
|-------------|-------|--------|
| 15–25 (Critical) | 0 | Block launch |
| 10–14 (High) | 2 | Mitigate before launch |
| 5–9 (Medium) | 4 | Monitor, accept with plan |
| 1–4 (Low) | 1 | Accept |

**Launch recommendation:** No critical risks. Two high-priority items (R1: skip Phase 6 tests, R4: rollback playbook) should be resolved before the go/no-go decision. All other risks are accepted with documented mitigation plans.
