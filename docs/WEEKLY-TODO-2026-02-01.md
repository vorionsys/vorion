# Weekly TODO - Week of February 1, 2026

> Focus: Foundation work that unblocks everything else.

---

## Completed Today (Friday Jan 31)

### Architecture & Documentation ✅
- [x] Created MASTER-ARCHITECTURE.md - Single source of truth
- [x] Locked in domain architecture (6 domains)
- [x] Defined package/layer architecture (L1-L5)
- [x] Defined npm package registry (@vorion scope)
- [x] Defined API endpoints for cognigate.dev
- [x] Created Website ↔ Package ↔ API mapping

### Trust Parity / HITL Certification ✅
- [x] Defined Trust Parity concept (H-levels match T-tiers)
- [x] Created HITL-CURRICULUM.md - Full H1-H5 course outlines
- [x] Defined phased rollout strategy (build offline, badge later)
- [x] Documented enforcement rules

### Session Capture ✅
- [x] Created SESSION-TODO-2026-01-31.md - Full backlog
- [x] Created this weekly todo

### From Previous Session (Also Complete) ✅
- [x] Fixed trust-decay.test.ts (created decay-profiles.ts)
- [x] Fixed langchain.test.ts (installed @fastify/proxy-addr)
- [x] All 159 atsf-core tests passing
- [x] Created ONBOARDING-TASK-BREAKDOWN.md (8-week sprint plan)
- [x] Documented context-aware decay with 3 profiles
- [x] Documented 10:1 asymmetric trust dynamics

---

## This Week's Goals

1. **Lock down infrastructure** - Domains, npm scope
2. **Create @vorion/runtime** - Core orchestration layer
3. **Start H1 curriculum** - First training content
4. **Skeleton cognigate-api** - API foundation

---

## Monday

### Domain & Infrastructure
- [ ] Verify ownership of all 6 domains
  - [ ] vorion.org
  - [ ] agentanchorai.com
  - [ ] aurais.net
  - [ ] cognigate.dev
- [ ] Set up DNS for subdomains
  - [ ] basis.vorion.org
  - [ ] learn.vorion.org
- [ ] Register @vorion npm scope on npmjs.com

### Quick Wins
- [ ] Create placeholder pages for each domain (coming soon)
- [ ] Update package.json files to use @vorion scope naming

---

## Tuesday

### @vorion/runtime Package (Part 1)
- [ ] Create packages/runtime directory structure
- [ ] Set up package.json with @vorion/runtime name
- [ ] Create TrustFacade interface (from MASTER-ARCHITECTURE.md)
- [ ] Implement TrustFacade skeleton
  ```typescript
  interface TrustGate {
    admit(agent: AgentCredentials): Promise<AdmissionResult>;
    authorize(agentId: string, action: Action): Promise<AuthorizationResult>;
    fullCheck(agent: AgentCredentials, action: Action): Promise<FullCheckResult>;
  }
  ```

---

## Wednesday

### @vorion/runtime Package (Part 2)
- [ ] Wire TrustFacade to existing atsf-core TrustEngine
- [ ] Wire TrustFacade to existing a3i TrustDynamicsEngine
- [ ] Add feature flags for gradual migration
- [ ] Write basic tests for TrustFacade
- [ ] Ensure all existing tests still pass

---

## Thursday

### H1 Foundation Curriculum (Course 101)
- [ ] Create sites/learn-portal directory
- [ ] Write Course 101: AI Agent Fundamentals
  - [ ] Module 1: What is an AI Agent? (15 min content)
  - [ ] Module 2: Agents vs Automation vs Scripts (15 min)
  - [ ] Module 3: Autonomy Spectrum (15 min)
  - [ ] Module 4: Quiz questions (10 questions)
- [ ] Create simple markdown-based course structure

---

## Friday

### cognigate-api Skeleton
- [ ] Create apps/cognigate-api directory
- [ ] Set up Fastify server skeleton
- [ ] Implement stub endpoints:
  - [ ] `POST /v1/agents` (stub)
  - [ ] `GET /v1/agents/:id` (stub)
  - [ ] `GET /v1/agents/:id/trust` (stub)
  - [ ] `POST /v1/intents` (stub)
- [ ] Add basic API key authentication middleware
- [ ] Write OpenAPI spec for implemented stubs

### Week Review
- [ ] Run all tests, ensure nothing broken
- [ ] Update SESSION-TODO with progress
- [ ] Plan next week's priorities

---

## Stretch Goals (If Time Permits)

- [ ] Course 102: Trust Tiers Explained (H1 curriculum)
- [ ] ProofCommitter skeleton (zero-latency design)
- [ ] Basic CI/CD for npm publishing

---

## Blockers / Dependencies

| Blocker | Owner | Status |
|---------|-------|--------|
| Domain ownership verification | ? | Pending |
| npm scope registration | ? | Pending |
| Decision: Fastify vs Express vs Hono | ? | **Recommend Fastify** |

---

## Success Criteria

Already Done (Friday):
- [x] Architecture documented and locked in
- [x] Domain strategy finalized
- [x] HITL curriculum outlined
- [x] All existing tests passing (159+)

By End of Week:
- [ ] All domains verified and DNS configured
- [ ] @vorion npm scope registered
- [ ] @vorion/runtime package exists with working TrustFacade
- [ ] Course 101 content written
- [ ] cognigate-api runs locally with stub endpoints

---

## Reference Docs

- [MASTER-ARCHITECTURE.md](MASTER-ARCHITECTURE.md) - Architecture decisions
- [HITL-CURRICULUM.md](HITL-CURRICULUM.md) - Course content guide
- [SESSION-TODO-2026-01-31.md](SESSION-TODO-2026-01-31.md) - Full backlog

---

*Created: January 31, 2026*
