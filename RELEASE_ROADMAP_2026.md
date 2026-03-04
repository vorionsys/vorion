# Vorion Release Roadmap H1 2026

> **Version**: 2.0 | **Updated**: 2026-02-16 | **Status**: Active

## Mission

Build the governance infrastructure that AI needs before the world needs it.

BASIS sets the rules. CAR identifies the agent. Cognigate enforces. PROOF keeps the receipts.

---

## Release Strategy: Five Waves, One Audience Each

Each wave has a **primary audience** and a **clear deliverable**. No mixed messages.

| Wave | Date | Name | Audience | Deliverable |
|------|------|------|----------|-------------|
| 1 | **Feb 26** | The Standard | Community | 4 foundation packages on npm |
| 2 | **Mar 16** | The Pipeline | Developers | SDK + CAR + live API + Docker |
| 3 | **Mar 30** | The Platform | Enterprise | AgentAnchor SaaS (invite-only) |
| 4 | **Apr 20** | The Console | Operators | Aurais + dashboards + admin |
| 5 | **May 4** | The Academy | Everyone | Kaizen + docs + community |

---

## Wave 1: The Standard (Feb 26)

**Audience**: Open-source community, standards bodies, early adopters
**Message**: "The governance standard is here. Use it."

### Ships

| Package | npm | Status | Work Remaining |
|---------|-----|--------|----------------|
| `@vorionsys/shared-constants` | v1.0.1 | Published | README polish |
| `@vorionsys/contracts` | v1.0.0 | Ready | Add README, verify exports |
| `@vorionsys/basis` | v1.0.1 | Published | README polish |
| `@vorionsys/atsf-core` | v0.2.1 | Published | README, changelog |

### Checklist

- [ ] README with install/usage/API for each package
- [ ] CHANGELOG.md for each package
- [ ] LICENSE (Apache-2.0) verified in each
- [ ] `npm publish` dry-run passes for all 4
- [ ] GitHub Release with tag `v0.2.0-wave1`
- [ ] Announcement blog post on vorion.org
- [ ] npm provenance attestation enabled

### Wave 1 Definition of Done

All 4 packages installable via `npm install @vorionsys/<pkg>`, with docs, tests passing, and provenance attestation.

---

## Wave 2: The Pipeline (Mar 16)

**Audience**: Integration developers, AI platform builders
**Message**: "Register an agent. Make a governance call. Five minutes."

### Ships

| Package/App | Type | Status | Work Remaining |
|-------------|------|--------|----------------|
| `@vorionsys/sdk` | npm | Ready | README, quickstart |
| `@vorionsys/cognigate` | npm (client) | v1.0.1 | Test coverage |
| `@vorionsys/proof-plane` | npm | Ready | README, examples |
| `@vorionsys/runtime` | npm | Ready | Test coverage, README |
| `@vorion/car-client` | npm | Ready | README |
| `@vorion/car-cli` | npm | Ready | README, man page |
| `car-spec` | npm | Ready | Spec doc polish |
| `cognigate-api` | Live API | Deployed | Python test enforcement |
| `api` | Live API | Deployed | Health checks |
| Docker image | ghcr.io | Defined | Build + push pipeline |

### Checklist

- [ ] 5-minute quickstart guide (register agent -> governance call -> proof receipt)
- [ ] `docker run vorionsys/vorion` works end-to-end
- [ ] cognigate-api Python tests passing (remove `continue-on-error`)
- [ ] All SDK packages have README with code examples
- [ ] OpenAPI spec published at docs endpoint
- [ ] GitHub Release `v0.3.0-wave2`

### Wave 2 Definition of Done

A developer can `npm install @vorionsys/sdk`, register a test agent, submit a governance request to the live API, and receive a verifiable proof receipt — all within 5 minutes using the quickstart guide.

---

## Wave 3: The Platform (Mar 30)

**Audience**: Enterprise early adopters, compliance teams, AI governance leads
**Message**: "See your agents. Set your policies. Prove your compliance."

### Ships

| Component | Type | Status | Work Remaining |
|-----------|------|--------|----------------|
| AgentAnchor Portal | Web app | Live | Auth flows, RBAC persistence |
| `platform-core` | Internal | Builds | TODO stubs in RBAC service |
| `security` | Internal | Builds | Password verification stub |
| `council` | Internal | Builds | Integration tests |
| `a3i` | Internal | Builds | 34 failing tests |

### Checklist

- [ ] Fix 34 a3i test failures (orchestration is core)
- [ ] Complete RBAC persistence in platform-core (DB queries)
- [ ] Implement auth flows in aurais (signup/login)
- [ ] Wire password verification in security package
- [ ] Cognigate governance feedback loop connected
- [ ] Invite-only access gate (email allowlist or invite codes)
- [ ] Onboarding flow for enterprise users
- [ ] GitHub Release `v0.4.0-wave3`

### Wave 3 Definition of Done

An invited enterprise user can sign up, create a policy, register agents under it, view trust scores on a dashboard, and export a compliance report.

---

## Wave 4: The Console (Apr 20)

**Audience**: Platform operators, DevOps, SREs, compliance officers
**Message**: "Run your governance fleet. Monitor everything."

### Ships

| Component | Type | Status | Work Remaining |
|-----------|------|--------|----------------|
| Aurais (aurais.net) | Mission control | Live (200) | Feature completion |
| Dashboard | Internal app | Exists | Connect to live data |
| Vorion Admin | Internal app | Exists | RBAC, user management |
| Monitoring | Observability | Partial | Sentry wired, needs dashboards |

### Checklist

- [ ] Aurais: real-time agent monitoring dashboard
- [ ] Dashboard: governance metrics, trust score trends
- [ ] Admin: user management, role assignment, audit log viewer
- [ ] Alerting: trust score degradation notifications
- [ ] Runbook: operational procedures for governance fleet
- [ ] GitHub Release `v0.5.0-wave4`

### Wave 4 Definition of Done

An operator can view all agents, their trust scores, recent governance decisions, and active alerts in a single pane. Admin can manage users and roles.

---

## Wave 5: The Academy (May 4)

**Audience**: Everyone — developers learning, community contributing, ecosystem growing
**Message**: "Learn it. Teach it. Build on it."

### Ships

| Component | Type | Status | Work Remaining |
|-----------|------|--------|----------------|
| Kaizen (learn.vorion.org) | Education | Live (200) | Course content |
| CAR docs (car.vorion.org) | Spec docs | Live (200) | Polish |
| ATSF docs (atsf.vorion.org) | Framework docs | Live | Polish |
| Contributor guide | Documentation | Partial | Complete |
| Community channels | Infrastructure | GitHub Discussions | Discord setup |

### Checklist

- [ ] 3 learning paths: Beginner, Integration Developer, Enterprise Admin
- [ ] Interactive code examples in docs
- [ ] Contributor guide with architecture walkthrough
- [ ] Public roadmap board (GitHub Projects)
- [ ] Discord or community forum launched
- [ ] GitHub Release `v1.0.0`

### Wave 5 Definition of Done

A new developer can go from zero to "I understand AI governance and can integrate Vorion" using only the learning platform, docs, and community resources.

---

## Parallel Workstreams

Five named workstreams overlap across waves. Never more than 2 active simultaneously.

```
         Feb 26    Mar 16    Mar 30    Apr 20    May 4
            |         |         |         |        |
WS-A Pkgs:  ████████►W1        |         |        |
WS-B SDK:   ░░░░░████████████►W2        |        |
WS-C Plat:       ░░░░░░░░████████████►W3        |
WS-D Ops:              ░░░░░░░░░░████████████►W4 |
WS-E Edu:                    ░░░░░░░░░░░░████████►W5
```

| Workstream | Lead Focus | Active Period | Waves |
|------------|-----------|---------------|-------|
| WS-A: Core Packages | README, tests, publish | Feb 16 – Feb 26 | W1 |
| WS-B: SDK + API | Quickstart, Docker, API hardening | Feb 20 – Mar 16 | W2 |
| WS-C: Platform | Auth, RBAC, a3i fixes, governance | Mar 2 – Mar 30 | W3 |
| WS-D: Operations | Dashboards, monitoring, admin | Mar 16 – Apr 20 | W4 |
| WS-E: Education | Courses, docs, community | Apr 1 – May 4 | W5 |

### Workstream Constraints

- **Max 2 active at once** — small team, focused execution
- **Each workstream has a clear "done" gate** — the wave ship date
- **Design work starts 2 weeks before active dev** — no cold starts
- **WS-B design begins during WS-A active** — SDK architecture while publishing packages
- **WS-C design begins during WS-B active** — platform auth design while shipping SDK

---

## Repo Strategy

### Two Repos, npm as the Boundary

**vorion** (public, Apache-2.0) — everything a developer USES:

```
vorion/
├── packages/
│   ├── shared-constants    ← Wave 1
│   ├── contracts           ← Wave 1
│   ├── basis               ← Wave 1
│   ├── atsf-core           ← Wave 1
│   ├── proof-plane         ← Wave 2
│   ├── cognigate           ← Wave 2 (client SDK)
│   ├── sdk                 ← Wave 2
│   ├── car-client          ← Wave 2
│   ├── car-cli             ← Wave 2
│   └── car-spec            ← Wave 2
├── examples/
└── docs/
```

**vorion-platform** (private) — everything we RUN:

```
vorion-platform/
├── packages/
│   ├── platform-core       ← Wave 3
│   ├── security            ← Wave 3
│   ├── council             ← Wave 3
│   ├── a3i                 ← Wave 3
│   ├── runtime             ← Wave 2 (competitive IP)
│   ├── ai-gateway          ← private
│   ├── agent-sdk           ← private
│   ├── agentanchor-sdk     ← private
│   └── infrastructure      ← private
├── apps/                   ← all apps
├── deploy/
└── compliance/
```

### Dependency Direction

```
vorion (public)                    vorion-platform (private)
┌──────────────────┐              ┌──────────────────────┐
│ shared-constants │              │                      │
│ contracts        │◄─────────────│ platform-core        │
│ basis            │  npm install │ security             │
│ atsf-core        │              │ council              │
│ proof-plane      │              │ a3i                  │
│ cognigate        │◄─────────────│ cognigate-api        │
│ sdk              │              │ agentanchor          │
│ car-client       │◄─────────────│ all apps/            │
│ car-cli          │              │                      │
│ car-spec         │              │                      │
└──────────────────┘              └──────────────────────┘
     publishes to npm ──────────────── consumes from npm
```

**Private depends on public. Never the reverse. No git submodules. npm is the contract.**

### Split Timeline

| When | Action |
|------|--------|
| Before Wave 1 (Feb 24) | Create public `vorion` repo with 4 foundation packages |
| Before Wave 2 (Mar 14) | Add SDK, CAR, proof-plane, cognigate to public repo |
| Wave 3+ | Everything stays in `vorion-platform` (private) |

---

## Site Strategy

All sites are live. They receive incremental updates per-wave, not monolithic launches.

| Site | Domain | Decision | Wave Updates |
|------|--------|----------|-------------|
| Marketing | *.vorion.org | Keep | Blog posts per wave |
| AgentAnchor WWW | agentanchorai.com | Keep | Pricing + invite CTA at W3 |
| Kaizen | learn.vorion.org | Keep, move to public repo | Course content at W5 |
| BAI-CC WWW | bai-cc.com | Merge into agentanchorai.com | W3 |
| Status WWW | status-www | Replace with hosted solution | W4 |

**Net: 3 sites instead of 5. None gate a wave.**

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| a3i 34 test failures block Wave 3 | High | Start triage in WS-B period (Mar 2) |
| RBAC stubs too deep to complete by Mar 30 | Medium | Scope W3 to read-only dashboard, write RBAC in W4 |
| Repo split causes CI breakage | Medium | Split packages first, validate npm install, then split apps |
| Python cognigate-api flaky in CI | Low | Add pytest fixtures, pin deps, remove continue-on-error |
| ESLint 8/9 conflict blocks app linting | Low | Pin ESLint 8 as workspace override for Next.js apps |
| Enterprise onboarding too complex for W3 | Medium | Ship CLI-first onboarding, web onboarding in W4 |

---

## Metrics to Track

| Metric | Current | Wave 1 Target | Wave 5 Target |
|--------|---------|---------------|---------------|
| npm packages published | 3 | 4 | 10 |
| Tests passing | 452+ | 500+ | 1000+ |
| Test coverage (avg) | ~60% | 70% | 85% |
| Live sites | 13 | 13 | 13 |
| GitHub stars | 0 (private) | 50 | 500 |
| Docker pulls | 0 | — | 1000 |
| Enterprise beta users | 0 | — | 10 |

---

## Out of Scope (H2 2026+)

| Item | Reason |
|------|--------|
| Go SDK (`agentanchor-sdk-go`) | Insufficient test coverage, no CI |
| Python SDK (`agentanchor-sdk-python`, `car-python`) | Same — needs dedicated sprint |
| Helm charts | Requires Kubernetes testing infrastructure |
| Federated governance nodes | Phase 9 (Q4 2026) |
| Design tokens | No consumer apps ready |
| Formal verification (TLA+/Alloy) | Research track, not product |
| Multi-region deployment | Phase 9 |

---

## Summary

```
Feb 26   Mar 16   Mar 30   Apr 20   May 4
  |        |        |        |       |
  W1       W2       W3       W4      W5
  |        |        |        |       |
  4 pkgs   SDK+API  SaaS     Ops     v1.0
  npm      Docker   Invite   Admin   Docs
  OSS      DevExp   Entprse  Montr   Learn
  |        |        |        |       |
  Community Devs    Enterprise Ops   Everyone
```

Five waves. Five audiences. One story: governed AI, built in the open, shipped before the crisis.
