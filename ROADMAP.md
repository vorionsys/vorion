# Vorion Public Roadmap

> **Status**: Active Development
> Last updated: March 2026

---

## The Stack

BASIS sets the rules. CAR identifies the agent. Cognigate enforces. PROOF keeps the receipts.

| Component | What | Where |
|-----------|------|-------|
| **BASIS** | Open governance standard for AI agents | `@vorionsys/basis` |
| **CAR** | Categorical Agentic Registry -- identity & trust tracking | `@vorionsys/car-cli`, `@vorionsys/car-client` |
| **Cognigate** | Governance enforcement runtime | `cognigate.dev` |
| **PROOF** | Immutable cryptographic audit trail | `@vorionsys/proof-plane` |
| **CHAIN** | Optional blockchain anchoring of proof records | Layer 4 |
| **AgentAnchor** | Commercial SaaS -- full governance fleet management | `agentanchorai.com` |
| **Kaizen** | Education platform for AI governance | `learn.vorion.org` |

---

## Trust Model (8 Tiers, 0-1000)

| Tier | Name | Score | Failure Mult |
|------|------|-------|-------------|
| T0 | Sandbox | 0-199 | 2x |
| T1 | Observed | 200-349 | 3x |
| T2 | Provisional | 350-499 | 4x |
| T3 | Monitored | 500-649 | 5x |
| T4 | Standard | 650-799 | 7x |
| T5 | Trusted | 800-875 | 10x |
| T6 | Certified | 876-950 | 10x |
| T7 | Autonomous | 951-1000 | 10x |

Failure multipliers scale with tier -- lowest at T0 to aid ascension, max at T5-T7 to enforce accountability.

---

## Release Waves

| Wave | Target | Name | Deliverable |
|------|--------|------|-------------|
| 1 | Feb 26 | The Standard | BASIS + contracts + shared-constants + atsf-core on npm |
| 2 | Mar 16 | The Pipeline | SDK + CAR + live API + Docker quickstart |
| 3 | Mar 30 | The Platform | AgentAnchor SaaS invite-only launch |
| 4 | Apr 20 | The Console | Aurais + vorion-admin operators console |
| 5 | May 4 | The Academy | Kaizen courses + contributor guide + community |

---

## Wave 1 (Done) -- The Standard

- [x] `@vorionsys/shared-constants` published
- [x] `@vorionsys/contracts` published
- [x] `@vorionsys/basis` published
- [x] `@vorionsys/atsf-core` published
- [x] 8-tier T0-T7 canonical trust model
- [x] Specification at vorion.org/basis/spec

---

## Wave 2 -- The Pipeline (Mar 16)

- [x] `@vorionsys/sdk` with 5-minute quickstart
- [x] `@vorionsys/car-client` + `@vorionsys/car-cli` published
- [x] `@vorionsys/proof-plane` published
- [x] `@vorionsys/runtime` published
- [x] `docker run vorionsys/vorion` end-to-end
- [x] OpenAPI spec live at cognigate.dev/docs
- [ ] gRPC transport support (Q3 2026)

---

## Wave 3 -- The Platform (Mar 30)

- [ ] AgentAnchor SaaS invite-only launch
- [ ] Agent registration + policy management UI
- [ ] Trust score dashboard
- [ ] Compliance report export
- [ ] Invite/access gate

---

## Wave 4 -- The Console (Apr 20)

- [ ] Aurais: real-time agent fleet monitoring
- [ ] vorion-admin: user management, RBAC, audit log viewer
- [ ] Trust score trend dashboards
- [ ] Alerting on trust degradation

---

## Wave 5 -- The Academy (May 4)

- [ ] Kaizen learning paths (Beginner / Integration Dev / Enterprise Admin)
- [ ] Interactive code examples in docs
- [ ] Contributor guide + architecture walkthrough
- [ ] Discord community
- [ ] v1.0.0 release

---

## Later (Q3-Q4 2026)

- [ ] Federated trust across organizations
- [ ] Multi-tenant isolation (BASIS Extended conformance)
- [ ] SIEM integrations (Splunk, Datadog)
- [ ] ZK proof receipts
- [ ] Merkle batch proof anchoring
- [ ] BASIS formal standards submission

---

## Sites

| Site | URL | Status |
|------|-----|--------|
| Main website | vorion.org | Live |
| Cognigate API | cognigate.dev | Live |
| AgentAnchor SaaS | agentanchorai.com | Live (auth WIP) |
| Aurais console | aurais.net | Live (preview) |
| Kaizen education | learn.vorion.org | Live (content WIP) |
| CAR docs | car.vorion.org | Live |

---

## Get Involved

- Spec: https://github.com/vorionsys/vorion
- Issues: https://github.com/vorionsys/vorion/issues
- Docs: https://www.vorion.org/basis
- License: Apache-2.0 | Apache-2.0 (Specification text)