# Vorion Ecosystem — Agent Reference

_Last updated: March 2026. Update this file when infrastructure changes._

---

## Repositories

| Repo | Local Path | Default Branch | Purpose |
|------|-----------|----------------|---------|
| vorion | `C:\voriongit\vorion` | `main` (push as `master:main`) | Private monorepo — full platform source |
| vorion-public | `C:\voriongit\vorion-public` | `main` | Public-safe subset — docs, RFI, public content |
| cognigate | `C:\voriongit\cognigate` | `main` | Cognigate enforcement engine (Python/FastAPI) |

**Git push pattern for vorion:** `git push origin master:main` (local branch is `master`, remote is `main`)

**Divergence pattern:** When vorion pushes to shared remote, vorion-public may need rebase:
```powershell
git -C C:\voriongit\vorion-public fetch origin
git -C C:\voriongit\vorion-public rebase origin/main
git -C C:\voriongit\vorion-public push origin main
```

---

## Live Websites — Vercel Project Map

| Domain | Vercel Project | Source Path | Notes |
|--------|---------------|-------------|-------|
| vorion.org / www.vorion.org | `vorion-www` | `vorion-www/` | Main corporate site |
| basis.vorion.org | `basis-docs` | `vorion-public/docs/basis-docs/` | BASIS standard docs |
| cognigate.dev / www.cognigate.dev | `cognigate` | `cognigate/` | Cognigate engine + playground |
| learn.vorion.org | `kaizen` | `apps/kaizen/` | Kaizen learning platform |
| car.vorion.org | `car-docs` | `docs/car-docs/` | CAR (registry) docs |
| atsf.vorion.org | `atsf-docs` | `docs/atsf-docs/` | Legacy ATSF docs (may need rebrand to BASIS) |
| app.agentanchorai.com | `agentanchor` | `apps/agentanchor/` | AgentAnchor B2B app |
| www.agentanchorai.com | `agentanchor-www` | `apps/agentanchor-www/` | AgentAnchor marketing |
| www.aurais.net | `aurais` | `apps/aurais/` | Aurais demo platform |
| bai-cc.com | `bai-cc-www` | `apps/dashboard/` | BAI command center |
| carid.vorion.org | `marketing` | `apps/marketing/` | ⚠️ Domain looks wrong — check intended domain |
| kaizen-docs.vercel.app | `kaizen-docs` | `kaizen-docs/` | ⚠️ No custom domain wired — Docusaurus content site |
| status-www.vercel.app | `status-www` | `apps/status-www/` | Status page |

**Vercel scope:** `vorionsys`
**Check deployments:** `npx vercel projects ls --scope vorionsys`

---

## Ecosystem Overview

### Products
- **BASIS Standard** — Open specification for AI agent governance pipeline (CC BY 4.0 for the spec document, Apache 2.0 for code). 5 stages: CAR → INTENT → ENFORCE → PROOF → CHAIN. Canonical URL: https://basis.vorion.org
- **Cognigate** — Open-source stateless enforcement engine implementing BASIS (Apache 2.0). Interactive playground + API docs at https://cognigate.dev. v0.2.0.
- **AgentAnchor** — B2B marketplace for governed AI agents. https://agentanchorai.com
- **Kaizen** — AI governance learning platform. https://learn.vorion.org
- **Aurais** — Governance demonstration / consumer platform. https://www.aurais.net

### Trust Model (Canonical)
- **Scale:** 0–1000 integer score
- **Tiers:** T0 Sandbox (0–199) / T1 Observed (200–349) / T2 Provisional (350–499) / T3 Monitored (500–649) / T4 Standard (650–799) / T5 Trusted (800–875) / T6 Certified (876–950) / T7 Autonomous (951–1000)
- **Starting score:** 1 (zero-trust default)
- **Gains:** logarithmic curve with observability ceiling
- **Losses:** tier-scaled penalty ratio: T0 = 7×, T7 = 10×, linear interpolation. Formula: `lossRate = gainRate × penaltyRatio(tier)`. No stacking (no double jeopardy).
- **Decay milestones:** 7 / 14 / 28 / 42 / 56 / 84 / 112 / 140 / 182 days — 50% score at day 182
- **Source of truth:** `packages/contracts/src/trust-dynamics.ts`, `packages/contracts/src/trust-profile.ts`

### Licensing
| Asset | License |
|-------|---------|
| BASIS Standard specification | CC BY 4.0 |
| All code packages (vorion, cognigate) | Apache 2.0 |
| kaizen-docs content | CC BY 4.0 (LICENSE file added March 2026) |

### Test Counts (as of March 2026)
- TypeScript: 9,976+
- Python (cognigate): 692
- Combined: 10,668+
- NIST SP 800-53: 52 controls, 20 automated tests
- SOC 2: 13 automated tests
- PCI DSS: 32 automated tests
- FedRAMP: 35 automated tests

### Contact
- **Primary:** hello@vorion.org
- **GitHub:** github.com/vorionsys
- **npm:** npmjs.com/org/vorionsys (11+ packages)

---

## Key Documents

| Document | Path | Status |
|----------|------|--------|
| NIST CAISI RFI Response | `vorion-public/docs/nist-caisi-rfi-response-2026-02.md` | v3.0 — submit to regulations.gov Docket NIST-2025-0035 by March 9, 2026 |
| NIST RFI (vorion copy) | `vorion/docs/nist-caisi-rfi-response-2026-02.md` | Synced from vorion-public |
| Project Context | `vorion/project-context.md` | Detailed monorepo rules for AI agents |
| Architecture | `vorion/_bmad-output/planning-artifacts/architecture.md` | Source of truth for architecture |

---

## Git Workflow (CRITICAL)

1. **Always commit AND push in the same call** — never leave uncommitted work
2. **vorion push pattern:** `git push origin master:main`
3. **Pre-commit hook:** `.husky/pre-commit` runs lint-staged + gitleaks. Use `--no-verify` only if explicitly authorized.

## Monorepo Quick Reference

- **Structure:** Turborepo + npm workspaces
- **Default branch:** `master` locally, pushes to `main` on remote
- **Test runner:** Vitest (TS), pytest (Python/cognigate)
- **Build:** `npx turbo build`
- **Test:** `npx turbo test --filter="./packages/*"`
- **Node:** v20
- **Package manager:** npm with `--legacy-peer-deps`
