# Vorion Master Roadmap

> **Shared reference for all Claude agents and contributors.**  
> Last updated: 2026-02  
> Owner: Vorion Risk, LLC

---

## Canonical Standards (Non-Negotiable)

These decisions are final and must be consistent everywhere:

| Concept | Canonical Value |
|---------|----------------|
| Trust score range | 0–1000 |
| Tier model | **8 tiers: T0–T7** (see table below) |
| Failure penalty multiplier | T0=2×, T1=3×, T2=4×, T3=5×, T4=7×, T5/T6/T7=10× |
| Brand name | **vorionsys** (org), **vorion.org** (domain) |
| Framework name | **BASIS** (not ATSF) |
| License (all packages) | **Apache-2.0** except `kaizen` (TBD) |
| npm scope | `@vorionsys` |
| Docs brand | `basis-docs` |

### Canonical Tier Table

| Tier | Label      | Score Range | Failure Mult | Color  |
|------|------------|-------------|-------------|--------|
| T0   | Sandbox    | 0–199       | 2×          | neutral |
| T1   | Observed   | 200–349     | 3×          | yellow-600 |
| T2   | Provisional| 350–499     | 4×          | yellow-400 |
| T3   | Monitored  | 500–649     | 5×          | orange-400 |
| T4   | Standard   | 650–799     | 7×          | emerald-400 |
| T5   | Trusted    | 800–875     | 10×         | blue-400 |
| T6   | Certified  | 876–950     | 10×         | indigo-400 |
| T7   | Autonomous | 951–1000    | 10×         | purple-400 |

---

## Repository Map

| Repo | Local Path | Remote | Deploy |
|------|-----------|--------|--------|
| vorion-public | `c:\voriongit\vorion-public` | `github.com/vorionsys/vorion` (main) | — |
| vorion (monorepo) | `c:\voriongit\vorion` | same remote, push `master:main` | — |
| cognigate | `c:\voriongit\cognigate` | `github.com/vorionsys/cognigate` (main) | Fly.io |
| vorion-www | `c:\voriongit\vorion-public\vorion-www` | Vercel | `www.vorion.org` |

---

## Status Dashboard

### ✅ Completed (this sprint)

- [x] Tier-scaled failure multipliers deployed (T0=2× … T7=10×) in cognigate + runtime
- [x] `/basis/trust` — Full 8-tier T0-T7 TierCard components + tier-scaled formula
- [x] `/basis/trust` — TierCard gains `amber` + `indigo` color variants
- [x] `/basis/trust` — Tier Boundaries table with all 7 transitions (T0→T1...T6→T7)
- [x] `/basis/spec` — Architecture diagram: replaced mojibake `<pre>` with Tailwind layer stack
- [x] `/basis/spec` — Conformance bullets: `â€¢` → `&#8226;` (9 fixes)
- [x] `/basis/spec` — Scope em-dashes: `â€"` → `&mdash;` (5 fixes)
- [x] `/basis/spec` — Trust tier table: 6-tier (Sandbox 0-99...) → 8-tier T0-T7 canonical
- [x] `/basis/schemas` enum updated with all 8 tier names
- [x] Homepage + `/demo` failure text updated to "2–10×"
- [x] `/basis/page.tsx` — failure description updated
- [x] all 3 Vercel sites deployed
- [x] `cognigate/app/routers/trust.py` — `TIER_FAILURE_MULTIPLIERS` dict
- [x] `vorion/packages/runtime/src/trust-facade/index.ts` — `TIER_FAILURE_MULTS`

### 🔄 In Progress / Next

#### P0 — Blocker

- [ ] **Apache-2.0 license fixes** — All packages except `kaizen` must have `"license": "Apache-2.0"` in `package.json`. See license audit below.

#### P1 — High Priority

- [ ] **`/basis/page.tsx` tier table** — Still references old 6-tier model (lines ~110-126: "Six Trust Tiers" heading + 6 TrustRow entries). Update to T0-T7.
- [ ] **`cognigate/app/routers/trust.py` tier boundaries** — Verify `get_trust_tier()` returns T0-T7 with exact canonical ranges (0-199, 200-349, 350-499, 500-649, 650-799, 800-875, 876-950, 951-1000).
- [ ] **`/basis/spec` wire protocol section** — Needs actual schema examples (currently placeholder text).

#### P2 — Medium Priority

- [ ] **Kaizen license decision** — Determine final license for `apps/kaizen/` (TBD).
- [ ] **`packages/n8n-nodes-cognigate`** — Scaffold exists (package.json, tsconfig, credentials.ts). Main integration node not built. Deprioritized — do not start without explicit instruction.
- [ ] **Basis page — `/basis/intent`, `/basis/enforce`, `/basis/proof`, `/basis/chain`** — These linked pages need content (currently stub or 404).
- [ ] **Cognigate API trust endpoint** — Wire /trust/score and /trust/signal to use updated tier-aware penalty throughout.

#### P3 — Low Priority / Backlog

- [ ] **Proof-plane blockchain verification** — Phase 7 scope. CHAIN layer optional integration.
- [ ] **Multi-tenant isolation** — BASIS Extended conformance.
- [ ] **Federated trust** — Needed for multi-org scenarios.
- [ ] **`packages/car-cli` and `packages/car-client`** — Need content + documentation.
- [ ] **`apps/agentanchor`** — AgentAnchor SDK + contracts. Awaiting specification clarity.

---

## License Audit

Run from `c:\voriongit\vorion-public` excluding `node_modules`.

### Confirmed Apache-2.0 ✅

```
package.json (root)
packages/platform-core/package.json
packages/shared-constants/package.json
packages/runtime/package.json
packages/proof-plane/package.json
packages/sdk/package.json
packages/security/package.json
packages/n8n-nodes-cognigate/package.json
packages/council/package.json
packages/cognigate/package.json
packages/contracts/package.json
packages/infrastructure/package.json
packages/a3i/package.json
```

### Needs Apache-2.0 Added/Fixed ❌ (except kaizen)

```
apps/agentanchor/contracts/package.json         — add "license": "Apache-2.0"
apps/cognigate-api/package.json                 — add "license": "Apache-2.0"
packages/agent-sdk/package.json                 — add "license": "Apache-2.0"
packages/agentanchor-sdk/package.json           — add "license": "Apache-2.0"
packages/ai-gateway/package.json                — add "license": "Apache-2.0"
packages/atsf-core/package.json                 — add "license": "Apache-2.0"
packages/basis/package.json                     — add "license": "Apache-2.0"
packages/car-cli/package.json                   — add "license": "Apache-2.0"
packages/car-client/package.json                — add "license": "Apache-2.0"
basis-core/lib/typescript/package.json          — add "license": "Apache-2.0"
```

### Hold — License TBD 🔶

```
apps/kaizen/                                    — TBD (user decision required)
apps/kaizen/content/sdk/agentanchor-sdk/        — TBD
apps/kaizen/content/sdk/basis-core/             — TBD
```

---

## Architecture Quick Reference

```
vorion-public/
├── vorion-www/          Next.js website → www.vorion.org
│   └── src/app/basis/   BASIS docs (spec, trust, schemas, intent, enforce, proof, chain)
├── apps/
│   ├── cognigate-api/   Trust scoring REST API (also at c:\voriongit\cognigate)
│   ├── agentanchor/     Agent identity + credential contracts
│   └── kaizen/          (license TBD)
├── packages/
│   ├── runtime/         Core trust facade + signal recording
│   ├── basis/           BASIS spec package
│   ├── platform-core/   Platform primitives
│   ├── council/         Governance council
│   ├── proof-plane/     Cryptographic proof / audit trail
│   ├── security/        Security utilities
│   ├── agent-sdk/       Agent SDK
│   ├── ai-gateway/      AI model gateway
│   └── sdk/             Public SDK
└── basis-core/
    └── lib/typescript/  TypeScript types for BASIS spec
```

---

## Deployment Checklist

Before any production deploy:

1. `cd c:\voriongit\vorion-public`
2. Verify no mojibake: `Select-String -Path "vorion-www/src/**/*.tsx" -Pattern "â" -Recurse`
3. `git add -A && git commit -m "..."`
4. `git push origin main`
5. `cd vorion-www && npx vercel --prod --yes --archive=tgz`
6. Confirm: `https://www.vorion.org/basis/spec` renders correctly

---

## Known Technical Debt

| Area | Issue | Priority |
|------|-------|----------|
| spec/page.tsx | Was corrupted by PowerShell script with wrong WriteAllLines logic — now fixed, add file write tests | P2 |
| Terminal sessions | `Get-ChildItem -Recurse` into node_modules left lingering output flooding all PS sessions — reboot PS to clear | P2 |
| basis pages | `/basis/intent`, `/basis/enforce`, `/basis/proof`, `/basis/chain` linked from spec but no content | P1 |
| Trust API | Python `get_trust_tier()` boundary at 900+ needs verification against canonical T7=951-1000 | P1 |
| n8n-nodes-cognigate | Only scaffold exists; no main node implemented | P3 |
