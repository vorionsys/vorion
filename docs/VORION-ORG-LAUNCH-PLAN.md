# Vorion.org Launch Plan (Four Waves)

**Objective:** Launch `vorion.org` as a high-confidence, production-ready public platform that clearly drives users to BASIS docs, Kaizen (`learn.vorion.org`), and Cognigate (`cognigate.dev`) while maintaining reliability and trust.

**Launch window target:** March–April 2026

## CARID Narrative Strategy (Mission Control)

**Positioning statement:** CARID is Vorion's **Mission Control for agent identity and governance operations** -- the control plane where teams observe identity state, orchestrate policy context, and coordinate trust-aware actions.

### Messaging Guardrails

- Always describe CARID as **Mission Control**, **control plane**, or **operations layer**
- Emphasize outcomes: visibility, orchestration, provenance, trust-aware coordination
- Connect CARID to BASIS + ATSF/Cognigate as one operational system
- **Do not** use DMV metaphors or any "DMV for AI" comparison in launch copy, docs, or announcements

### Canonical Copy Blocks

- **Short form:** "CARID is Mission Control for AI agent identity, policy context, and operational trust coordination."
- **Long form:** "CARID provides the operational control layer for agent identity -- pairing immutable identity and provenance with runtime governance signals so teams can observe, direct, and audit agent systems with confidence."

## Success Criteria

- **Reliability:** 99.9% availability during first 30 days
- **Performance:** Core pages under 2.5s LCP (p75)
- **Quality:** CI green + coverage gates passing before each promotion
- **Readiness:** Health endpoints (`/health/ready`) return healthy in staging and production
- **Adoption:** Measurable flow from `vorion.org` to `learn.vorion.org` and developer docs

---

## Wave 1 — Foundation Lock (Week 1)

**Goal:** Freeze core launch scope, remove unknowns, and establish non-negotiable quality gates.

### Wave 1 Product Scope

- **CARID** (Mission Control identity and provenance control plane)
- **BASIS** (policy and governance specification layer)
- **ATSF** (trust scoring and runtime evaluation engine)
- **Cognigate** (policy enforcement and constrained execution gateway)

### Wave 1 OSS Contributor Policy

- No cash bounty program for Wave 1
- First **50 accepted edits** across Vorion OSS repos receive **author credit**

### Scope

- Finalize launch IA/content hierarchy: Platform, BASIS, Developers, Learn, Pricing, Community
- Finalize CARID narrative and copy system using Mission Control framing across all launch surfaces
- Execute ATSF hardening adjustments required for Wave 1 launch readiness
- Confirm canonical links and nav consistency with current public surfaces
- Finalize environment variable matrix for all deploy targets
- Complete security baseline pass and dependency audit verification
- Confirm CI/CD release gates and rollback commands

### Exit Criteria

- All required repositories/services have named owners and on-call rotation
- CI pipelines green on `main` with no blocking warnings
- ATSF adjustment checklist completed and signed off by engineering owner
- Staging deployment reproducible from clean checkout
- Go/no-go checklist approved by product + engineering leads

### Deliverables

- `Launch Scope Freeze` document
- `CARID Messaging Pack` (homepage copy, docs snippets, announcement language, FAQ)
- `ATSF Wave 1 Adjustment Plan` with status tracking and owners
- `Contributor Credit Ledger` (tracks first 50 accepted OSS edits)
- `Env & Secrets Matrix`
- `Rollback Playbook v1`
- `Risk Register v1`

---

## Wave 2 — Staging Dress Rehearsal (Week 2)

**Goal:** Validate full launch flow end-to-end under realistic conditions.

### Scope

- Deploy complete stack to staging (web + APIs + any contract dependencies)
- Execute smoke tests for all critical user journeys:
  - Landing page navigation
  - Learn/Kaizen handoff
  - Developer documentation path
  - Contact/community actions
- Validate monitoring/alerting and error visibility
- Run synthetic traffic and rate-limit sanity checks
- Perform incident drill + rollback drill

### Exit Criteria

- Zero P0/P1 defects open
- All smoke tests pass twice consecutively
- Incident response drill completed with < 15 min time-to-mitigate
- Rollback drill completed successfully in staging

### Deliverables

- `Staging Validation Report`
- `Incident Drill Report`
- `Rollback Drill Evidence`

---

## Wave 3 — Controlled Public Ramp (Week 3)

**Goal:** Launch safely with progressive exposure and real-time observability.

### Scope

- Launch with phased traffic ramp:
  - Phase A: Internal + invited community
  - Phase B: Partial public traffic
  - Phase C: Full public release
- Enforce live release checklist before each phase increment
- Monitor SLO dashboards and error budgets continuously
- Triage and resolve launch-day defects in a dedicated war room

### Exit Criteria

- No unresolved P0/P1 incidents after 48h of full public traffic
- SLOs remain within target for 2 consecutive days
- User journey conversion from `vorion.org` to key destinations is measurable and stable

### Deliverables

- `Launch Day Log`
- `Traffic Ramp Decisions`
- `Issue Triage Register`

---

## Wave 4 — Post-Launch Scale & Optimization (Week 4)

**Goal:** Stabilize operations, improve conversion, and harden long-term reliability.

### Scope

- Prioritize top 10 post-launch improvements by impact
- Optimize page speed, navigation clarity, and CTA conversion
- Expand automated test coverage for critical UI flows
- Validate cost/performance footprint and right-size infrastructure
- Publish public changelog + roadmap update

### Exit Criteria

- 30-day reliability and performance targets met
- Launch retrospective complete with action owners and dates
- Next-quarter roadmap approved

### Deliverables

- `30-Day Launch Report`
- `Performance Optimization Plan`
- `Q2 Roadmap Hand-off`

---

## Cross-Wave Governance

## Roles

- **Launch Commander:** owns go/no-go decisions
- **Engineering Lead:** owns code readiness, rollback execution
- **SRE/Infra Lead:** owns uptime, monitoring, incident operations
- **Product Lead:** owns messaging, launch scope, success metrics
- **Comms Lead:** owns announcement timing + external narrative

## Narrative QA Checklist (All Waves)

- CARID references use Mission Control framing (0 DMV analogies)
- Homepage, docs, and social announcement copy use consistent CARID language
- Developer docs align CARID identity context with ATSF/Cognigate trust signals
- Final release notes include one clear CARID Mission Control explainer paragraph

## Daily Cadence (Waves 2–4)

- 15-min launch standup (risks, blockers, decisions)
- 2x daily metrics review (performance, errors, conversion)
- End-of-day checkpoint with explicit next actions

## Core Metrics Dashboard

- Availability, error rate, latency (p50/p95)
- LCP/CLS/INP by key landing pages
- Navigation click-through rates to:
  - BASIS
  - Learn/Kaizen
  - Developers/Cognigate
- Incident count and MTTR

---

## Launch-Day Runbook (Condensed)

1. Confirm `main` green + release tag cut
2. Confirm environment/secret parity with staging
3. Deploy to production with rollback window open
4. Run smoke checklist and readiness checks
5. Start traffic ramp (A -> B -> C)
6. Record decisions/events in launch log
7. Publish public release announcement

---

## Immediate Actions (Start This Week)

1. Create `WaveOne Launch` tracking issue with owner + due date per item
2. Assign named owner for each wave and each exit criterion
3. Build first version of launch dashboard and incident channel
4. Schedule staging dress rehearsal date + rollback drill date
5. Freeze scope for Wave 1 within 48 hours
