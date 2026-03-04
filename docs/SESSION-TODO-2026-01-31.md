# Session TODO - January 31, 2026

> Comprehensive capture of all decisions, tasks, and open items from today's session.

---

## Documents Created/Updated Today

| Document | Status | Purpose |
|----------|--------|---------|
| [MASTER-ARCHITECTURE.md](MASTER-ARCHITECTURE.md) | Updated | Single source of truth - domains, packages, layers |
| [HITL-CURRICULUM.md](HITL-CURRICULUM.md) | Created | Offline curriculum build plan for H1-H5 |

---

## Domain Architecture (LOCKED IN)

| Domain | Purpose | Status |
|--------|---------|--------|
| **vorion.org** | Corporate HQ | Needs site |
| **basis.vorion.org** | Trust theory docs | Needs content |
| **learn.vorion.org** | HITL training (Phase 1: "AI Training") | Needs platform + curriculum |
| **agentanchorai.com** | Agent Registration & Certification | Needs portal |
| **aurais.net** | Consumer & B2B apps | Needs apps |
| **cognigate.dev** | Developer platform | Needs API + docs |

### Domain Tasks

- [ ] Verify all domains are registered/owned
- [ ] Set up DNS for subdomains (basis.vorion.org, learn.vorion.org)
- [ ] Create placeholder landing pages for each domain
- [ ] Design information architecture for each site

---

## Product Portfolio Tasks

### Aurais Suite (aurais.net)

- [ ] Define Aurais (consumer) MVP features
- [ ] Define Aurais Pro feature set (multi-agent, teams)
- [ ] Define Aurais Exec feature set (fleet, compliance, audit)
- [ ] Create pricing strategy document
- [ ] Design B2B dashboard mockups

### AgentAnchorAI (agentanchorai.com)

- [ ] Design agent registration flow
- [ ] Design certification badge system
- [ ] Create "Is this agent registered?" public lookup
- [ ] Design trust seal embeddable widget
- [ ] Plan audit trail viewer UI

---

## Package Architecture Tasks

### npm Packages to Create/Publish

| Package | npm Name | Priority | Status |
|---------|----------|----------|--------|
| contracts | `@vorion/contracts` | P0 | Exists, needs publish |
| basis | `@vorion/basis` | P0 | Exists, needs publish |
| atsf-core | `@vorion/atsf` | P0 | Exists, needs publish |
| proof-plane | `@vorion/proof` | P1 | Exists, needs publish |
| runtime | `@vorion/runtime` | P1 | **NEW - needs creation** |
| sdk | `@vorion/sdk` | P1 | **NEW - needs creation** |
| cognigate | `@vorion/cognigate` | P2 | Exists as part of atsf-core |

### Package Tasks

- [ ] Register @vorion scope on npmjs.com
- [ ] Create `@vorion/runtime` package with TrustFacade
- [ ] Create `@vorion/sdk` package (simple developer interface)
- [ ] Extract cognigate to standalone `@vorion/cognigate` package
- [ ] Set up CI/CD for npm publishing
- [ ] Write package READMEs for each

---

## API Development (cognigate.dev)

### Endpoints to Implement

| Endpoint | Priority | Status |
|----------|----------|--------|
| `POST /v1/agents` | P0 | Needs impl |
| `GET /v1/agents/:id` | P0 | Needs impl |
| `GET /v1/agents/:id/trust` | P0 | Needs impl |
| `POST /v1/intents` | P0 | Needs impl |
| `GET /v1/intents/:id` | P1 | Needs impl |
| `POST /v1/intents/:id/refine` | P1 | Needs impl |
| `GET /v1/decisions/:id` | P2 | Needs impl |
| `GET /v1/proofs/:id` | P2 | Needs impl |
| `GET /v1/proofs/:id/verify` | P2 | Needs impl (public) |
| `GET /v1/certify/:id` | P2 | Needs impl (public) |

### API Tasks

- [ ] Create OpenAPI spec (api-spec.yaml)
- [ ] Set up Fastify/Express API server
- [ ] Implement authentication (API keys)
- [ ] Implement rate limiting
- [ ] Create developer dashboard for API key management
- [ ] Write API documentation

---

## Trust Architecture Tasks

### Two Trust Model Implementation

- [ ] Implement TrustFacade to unify atsf-core and a3i
- [ ] Gate Trust ("The Door") - agent registration
- [ ] Dynamic Trust ("The Handshake") - per-action authorization
- [ ] Cache gate trust results (hours/days TTL)
- [ ] Ensure dynamic trust < 50ms latency

### Trust Parity (HITL Certification)

Phase 1 (NOW - Build Offline):
- [ ] Create learn.vorion.org platform (LMS)
- [ ] Write Foundation Track courses (101-104)
- [ ] Write Operator Track courses (201-204)
- [ ] Implement completion tracking (no badges yet)
- [ ] Position as "AI Training & Education"

Phase 2 (LATER - Flip Switch):
- [ ] Add badge/certification UI
- [ ] Run migration to auto-credit completions
- [ ] Rename to "HITL Certification Academy"

Phase 3 (FUTURE - Enforce):
- [ ] Implement TrustParityCheck in authorization flow
- [ ] Require H3+ for T4+ agent deployment
- [ ] Auto-escalation when parity violated

### Curriculum Content Priority

| Track | Courses | Hours | Priority |
|-------|---------|-------|----------|
| Foundation (H1) | 101-104 | 4-6 | **P0** |
| Operator (H2) | 201-204 | 6-8 | **P1** |
| Supervisor (H3) | 301-304 | 8-10 | **P2** |
| Auditor (H4) | 401-404 | 10-12 | **P3** |
| Architect (H5) | 501-503 + Capstone | 15-20 | **P4** |

---

## Zero-Latency Proof System

- [ ] Implement CommitmentBuffer (in-memory hash buffer)
- [ ] Implement ProofAggregator (async batch processing)
- [ ] Build Merkle tree for batch proofs
- [ ] Add Ed25519 batch signing
- [ ] Optional: blockchain anchor (hourly/daily)
- [ ] Verify < 1ms commit latency

### Latency Budget Targets

| Operation | Target | Max |
|-----------|--------|-----|
| Commitment (hash) | 0.1ms | 1ms |
| Authorization check | 10ms | 50ms |
| Full intent processing | 50ms | 200ms |

---

## Cognigate Enhancements

- [ ] Add network isolation (NetworkInterceptor)
- [ ] Implement trust-based network policies
- [ ] T0-T1: No network access
- [ ] T2-T3: Allowlist only, limited bandwidth
- [ ] T4+: Open with logging
- [ ] Add bandwidth tracking

---

## GDPR Compliance

- [ ] Implement per-entity encryption keys
- [ ] Implement crypto-shredding for deletion
- [ ] Add tombstone events to proof chain
- [ ] Create deletion request API
- [ ] Document GDPR compliance process

---

## Repository Structure Tasks

```
vorion/
├── packages/
│   ├── contracts/        ✅ Exists
│   ├── basis/            ✅ Exists
│   ├── atsf-core/        ✅ Exists
│   ├── proof-plane/      ✅ Exists
│   ├── a3i/              ✅ Exists (merging)
│   ├── runtime/          ❌ NEW - Create
│   ├── sdk/              ❌ NEW - Create
│   └── cognigate/        ❌ Extract from atsf-core
│
├── apps/
│   ├── aurais/           ❌ NEW - Create
│   ├── aurais-pro/       ❌ NEW - Create
│   ├── aurais-exec/      ❌ NEW - Create
│   ├── cognigate-api/    ❌ NEW - Create
│   ├── agentanchor-portal/ ❌ NEW - Create
│   └── vorion-web/       ❌ NEW - Create
│
├── sites/
│   ├── basis-docs/       ❌ NEW - Create
│   ├── learn-portal/     ❌ NEW - Create
│   └── cognigate-docs/   ❌ NEW - Create
```

---

## Open Questions / Decisions Needed

1. **LMS Platform**: Build custom or use existing (e.g., Teachable, Thinkific)?
2. **API Gateway**: Fastify vs Express vs Hono?
3. **Hosting**: Vercel, AWS, GCP, or self-hosted?
4. **Database**: PostgreSQL + Redis? Managed or self-hosted?
5. **Blockchain Anchor**: Which chain? Polygon, Ethereum L2, or none initially?

---

## Carried Over from Previous Session

### Completed ✅
- [x] Fixed trust-decay.test.ts (created decay-profiles.ts)
- [x] Fixed langchain.test.ts (installed @fastify/proxy-addr)
- [x] All 159 atsf-core tests passing
- [x] Created MASTER-ARCHITECTURE.md
- [x] Created ONBOARDING-TASK-BREAKDOWN.md

### Still Pending
- [ ] Update trust tier names (T0=Sandbox, T1=Observed) in all docs
- [ ] Implement TrustFacade unification
- [ ] Create @vorion/runtime package
- [ ] Sprint A/B: Complete Safety Foundation tasks

---

## Priority Order (Recommended)

### Immediate (This Week)
1. Verify domain ownership
2. Create @vorion/runtime with TrustFacade
3. Start Foundation Track (H1) curriculum content
4. Set up cognigate-api skeleton

### Short-term (Next 2 Weeks)
5. Implement zero-latency proof system
6. Create @vorion/sdk
7. Build learn.vorion.org platform
8. Complete Operator Track (H2) curriculum

### Medium-term (Next Month)
9. Launch cognigate.dev with API + docs
10. Build agentanchorai.com portal
11. Complete Supervisor Track (H3) curriculum
12. Network isolation in Cognigate

### Long-term (Quarter)
13. Launch aurais.net apps
14. HITL certification badge launch (Phase 2)
15. Trust parity enforcement (Phase 3)
16. Blockchain proof anchoring

---

## Session Summary

**Key Decisions Made:**
1. Domain architecture locked in (6 domains, clear purposes)
2. HITL certification = phased rollout (build offline, badge later)
3. Trust Parity = critical concept (H-levels must match T-tiers)
4. Zero-latency proof = async batching with sync hash commits
5. Package scope = @vorion on npm

**Documents to Reference:**
- [MASTER-ARCHITECTURE.md](MASTER-ARCHITECTURE.md) - Single source of truth
- [HITL-CURRICULUM.md](HITL-CURRICULUM.md) - Curriculum build plan

---

*Captured: January 31, 2026*
