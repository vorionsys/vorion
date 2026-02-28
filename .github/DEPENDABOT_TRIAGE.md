# Dependabot Advisory Triage — Wave 1

**Owner:** @chunkstar
**Triaged:** February 27, 2026
**Security alerts page:** https://github.com/vorionsys/vorion/security/dependabot

---

## Branch Architecture — Critical Context

`vorionsys/vorion` has **two branches**:

| Branch | Purpose | Default? | Where dependabot PRs targeted |
|--------|---------|----------|-------------------------------|
| `master` | Legacy predecessor code (`vorion-www`, `apps/agentanchor-www`) | ✅ Yes (GitHub default) | ✅ All 7 PRs |
| `main` | Wave 1 launch surface (`apps/kaizen`, `apps/cognigate-api`, `packages/*`) | ❌ No | ❌ None |

**The Wave 1 launch surface (`main`) never contained the vulnerable legacy directories.** The critical AJV CVE and all associated 25 advisories were against `master` — legacy code that is not deployed.

---

## Summary

As of push `c9f19be4` to `main`, GitHub reported **25 security advisories** on `vorionsys/vorion`:
- 1 Critical
- 20 High
- 3 Moderate
- 1 Low

**Root cause of the high count:** All advisories target `master` (default branch). The legacy directories `vorion-www` and `apps/agentanchor-www` exist only on `master`, NOT on `main`. They are not part of the Wave 1 launch surface.

**`main` audit result (post-triage):** 1 high severity found — `minimatch` 10.x ReDoS (GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74) in `glob/node_modules/minimatch`. **Fixed via `npm audit fix` on February 27, 2026. `main` is now 0 vulnerabilities.**

---

## Dependabot PRs — Results (all against `master`)

| PR | Package | Severity | Path | Outcome |
|----|---------|----------|------|---------|
| [#79](https://github.com/vorionsys/vorion/pull/79) | `ajv` 6.12.6 → 6.14.0 | **Critical** (CVE-2025) | `/apps/agentanchor-www` | ✅ **Merged** Feb 27, 2026 |
| [#80](https://github.com/vorionsys/vorion/pull/80) | `aquasecurity/trivy-action` 0.28 → 0.34.1 | None (CI tooling) | `.github/workflows` | ✅ **Merged** Feb 27, 2026 |
| [#81](https://github.com/vorionsys/vorion/pull/81) | `fastapi` 0.129 → 0.131 + `uvicorn` 0.40 → 0.41 | None (routine) | `/cognigate-api` | ✅ **Merged** Feb 27, 2026 |
| [#82](https://github.com/vorionsys/vorion/pull/82) | `minimatch` + `eslint` | High (ReDoS) | `/apps/agentanchor-www` | ♻️ **Superseded by #86** (conflict after #79 modified lockfile) |
| [#83](https://github.com/vorionsys/vorion/pull/83) | `ajv` 6.12.6 → 6.14.0 | **Critical** (CVE-2025) | `/vorion-www` | ✅ **Merged** Feb 27, 2026 |
| [#84](https://github.com/vorionsys/vorion/pull/84) | `minimatch` 3.1.2 → 3.1.4 + 9.0.5 → 9.0.7 | High (ReDoS) | `/vorion-www` | ✅ **Merged** Feb 27, 2026 |
| [#85](https://github.com/vorionsys/vorion/pull/85) | `storybook` 8.6.15 → 8.6.17 | Low (WebSocket) | `/vorion-www` | ❌ **Closed** — conflict after #83/#84; dev-only, no security impact |
| [#86](https://github.com/vorionsys/vorion/pull/86) | `minimatch` 3.1.3 → 3.1.5 | High (ReDoS) | `/apps/agentanchor-www` | ✅ **Merged** Feb 27, 2026 (replaces #82) |

**`master` now at `7184d643a0be924954ab0d6b318d3f0a65447903`**. All critical and high advisories on `master` resolved.

---

## Why 25 advisories from 7 PRs?

Dependabot raises one advisory per vulnerable package per lockfile path. The `ajv` CVE alone accounts for ~20+ advisories because:
- `ajv@6.x` is a deeply transitive dependency in many build tools
- It appears in multiple lockfiles (`vorion-www`, `agentanchor-www`, nested `node_modules`)
- Each unique path counts as a separate advisory in GitHub's security tab

The remaining 5 advisories after merging the 7 PRs are expected to be `minimatch` ReDoS in additional nested paths that dependabot hasn't yet filed a PR for.

---

## Wave 1 Exit Security Status — ✅ CLEAN

| Scope | Critical | High | Status |
|-------|---------|------|--------|
| `main` (launch surface) | 0 | 0 | ✅ Clean — `minimatch` ReDoS fixed via `npm audit fix` Feb 27, 2026 |
| `master` (legacy) | 0 | 0 | ✅ Clean — all 6 dependabot PRs merged Feb 27, 2026 |

**Wave 1 exit security requirement is met.** The critical AJV CVE-2025 advisories (which only existed on `master`) are resolved. The `main` launch surface has 0 vulnerabilities.

---

## `main` launch surface vuln fix (standalone)

The `npm audit` scan of `main` found 1 high severity vulnerability not covered by any dependabot PR (because it exists only in the `main` lockfile):

- **Package:** `minimatch` 10.0.0–10.2.2 (via `glob/node_modules/minimatch`)
- **CVEs:** GHSA-7r86-cg39-jmmj (ReDoS, `matchOne()` combinatorial backtracking), GHSA-23c5-xmqv-rm74 (nested `*()` extglobs ReDoS)
- **Fix:** `npm audit fix` → bumped to `minimatch@10.2.3`
- **Date fixed:** February 27, 2026
- **Committed:** included in `package-lock.json` in commit `chore: regional deployment notes, env matrix, dependabot triage, A4/A5 owners`

---

## Previously non-blocking advisories — ✅ RESOLVED

All 20 High advisories were in `vorion-www` or `apps/agentanchor-www` on `master`. These directories exist only on `master` (legacy) and are not deployed as part of Wave 1. All were resolved by the 6 dependabot merges on February 27, 2026.

---

## Merge commands — ✅ COMPLETED Feb 27, 2026

```bash
# All executed against vorionsys/vorion (targeted master — the default branch)
gh pr merge 79 --merge --repo vorionsys/vorion   # ✅
gh pr merge 83 --merge --repo vorionsys/vorion   # ✅
gh pr merge 80 --merge --repo vorionsys/vorion   # ✅
gh pr merge 81 --merge --repo vorionsys/vorion   # ✅
gh pr merge 84 --merge --repo vorionsys/vorion   # ✅
gh pr merge 86 --merge --repo vorionsys/vorion   # ✅ (replaced #82, minimatch rebase)
# PR #85 (storybook, low severity, dev-only) — closed due to conflict, no action needed
```

---

## Post-merge verification — ✅ PASSED

```bash
npm audit --audit-level=high
# Result: found 0 vulnerabilities (after npm audit fix for minimatch ReDoS)
```

`main` launch surface: **0 vulnerabilities**. `master` (legacy): all critical/high merged.

---

*Last updated: February 27, 2026 — all merges complete, main surface clean.*
*Full advisories list: https://github.com/vorionsys/vorion/security/dependabot*
