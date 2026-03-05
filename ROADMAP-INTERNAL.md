# Vorion Internal Roadmap

> **INTERNAL ONLY â€” do not publish**
> Last updated: March 5, 2026
> Owner: Vorion Risk, LLC

---

## Canonical Standards (Non-Negotiable)

These decisions are final and must be consistent everywhere:

| Concept | Canonical Value |
|---------|----------------|
| Trust score range | 0-1000 |
| Tier model | 8 tiers: T0-T7 (see table below) |
| Failure penalty multiplier | T0=2x, T1=3x, T2=4x, T3=5x, T4=7x, T5/T6/T7=10x |
| Brand name | vorionsys (org), vorion.org (domain) |
| Framework name | BASIS (not ATSF) |
| License (all packages) | Apache-2.0 except kaizen (TBD) |
| npm scope | @vorionsys |
| Docs brand | basis-docs |

### Canonical Tier Table

| Tier | Label       | Score Range | Failure Mult | Color      |
|------|-------------|-------------|-------------|------------|
| T0   | Sandbox     | 0-199       | 2x          | neutral    |
| T1   | Observed    | 200-349     | 3x          | yellow-600 |
| T2   | Provisional | 350-499     | 4x          | yellow-400 |
| T3   | Monitored   | 500-649     | 5x          | orange-400 |
| T4   | Standard    | 650-799     | 7x          | emerald-400|
| T5   | Trusted     | 800-875     | 10x         | blue-400   |
| T6   | Certified   | 876-950     | 10x         | indigo-400 |
| T7   | Autonomous  | 951-1000    | 10x         | purple-400 |

---

## Repository Map

| Repo | Local Path | Remote | Deploy |
|------|-----------|--------|--------|
| vorion-public | c:\voriongit\vorion-public | github.com/vorionsys/vorion (main) | -- |
| vorion (monorepo) | c:\voriongit\vorion | same remote, push master:main | -- |
| cognigate | c:\voriongit\cognigate | github.com/vorionsys/cognigate (main) | Fly.io |
| vorion-www | c:\voriongit\vorion-public\vorion-www | Vercel | www.vorion.org |

---

## Status Dashboard

### Completed (sprint to date)

- [x] Tier-scaled failure multipliers (2-10x) deployed in cognigate + runtime
- [x] /basis/trust -- Full 8-tier T0-T7 TierCard components + tier-scaled formula
- [x] /basis/trust -- TierCard amber + indigo color variants
- [x] /basis/trust -- Tier Boundaries table with all 7 transitions
- [x] /basis/spec -- Architecture diagram: replaced mojibake pre with Tailwind layer stack
- [x] /basis/spec -- Conformance bullets fixed (9 instances)
- [x] /basis/spec -- Scope em-dashes fixed (5 instances)
- [x] /basis/spec -- Trust tier table: 6-tier -> 8-tier T0-T7 canonical
- [x] /basis/schemas enum updated with all 8 tier names
- [x] Homepage + /demo failure text updated to 2-10x
- [x] Apache-2.0 license: agentanchor-contracts + cognigate-api fixed (were MIT)
- [x] All 3 Vercel sites deployed

### P0 -- Blockers

- [ ] /basis/page.tsx tier table -- still references old 6-tier model (lines ~110-126). Update to T0-T7.
- [ ] cognigate get_trust_tier() -- verify Python function returns exact canonical T0-T7 ranges

### P1 -- High Priority

- [ ] BASIS sub-pages -- /basis/intent, /basis/enforce, /basis/proof, /basis/chain are linked from spec but have no content
- [ ] Cognigate API -- wire /trust/score and /trust/signal through updated tier-aware penalty throughout
- [ ] /basis/spec wire protocol section -- needs actual schema examples (currently placeholder)

### P2 -- Medium Priority

- [ ] Kaizen license decision -- finalize license for apps/kaizen/ (user decision required, currently TBD)
- [ ] n8n-nodes-cognigate -- scaffold exists (package.json, tsconfig, credentials.ts). Deprioritized -- do not start without explicit instruction.
- [ ] Verify all package.json files in apps/kaizen/ once license decided

### P3 -- Backlog

- [ ] Proof-plane blockchain verification (CHAIN layer optional integration)
- [ ] Multi-tenant isolation (BASIS Extended conformance)
- [ ] Federated trust (multi-org scenarios)
- [ ] packages/car-cli + packages/car-client -- need implementation + docs
- [ ] apps/agentanchor -- awaiting specification clarity

---

## License Audit (vorion-public)

Last audited: March 5, 2026

### Confirmed Apache-2.0

package.json (root), packages/platform-core, packages/shared-constants,
packages/runtime, packages/proof-plane, packages/sdk, packages/security,
packages/n8n-nodes-cognigate, packages/council, packages/cognigate,
packages/contracts, packages/infrastructure, packages/a3i,
packages/agent-sdk, packages/agentanchor-sdk, packages/ai-gateway,
packages/atsf-core, packages/basis, packages/car-cli, packages/car-client,
basis-core/lib/typescript, apps/agentanchor/contracts, apps/cognigate-api

### Hold -- License TBD

apps/kaizen/ and all sub-packages -- awaiting user decision

---

## Technical Debt

| Area | Issue | Priority |
|------|-------|----------|
| basis pages | /basis/intent, /basis/enforce, /basis/proof, /basis/chain have no content | P1 |
| trust API | Python get_trust_tier() boundary verification vs canonical T7=951-1000 | P1 |
| /basis/page.tsx | Still shows 6-tier model (Six Trust Tiers heading) | P0 |
| n8n-nodes-cognigate | Only scaffold exists; no main node | P3 |

---

## Deployment Checklist

Before any production deploy to www.vorion.org:

1. cd c:\voriongit\vorion-public
2. Check for mojibake: Select-String -Path "vorion-www/src/**/*.tsx" -Pattern "e2 80|e2 94" -Recurse (none expected)
3. git add -A && git commit -m "..."
4. git push origin main
5. cd vorion-www && npx vercel --prod --yes --archive=tgz
6. Confirm https://www.vorion.org/basis/spec renders correctly