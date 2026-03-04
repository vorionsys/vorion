# Vorion Master Architecture
## Source: docs/MASTER-ARCHITECTURE.md (Business & Governance Reference)

**Version:** 1.1.0 | **Last Updated:** February 3, 2026

---

## Websites & Domains (Canonical)

| Domain | Purpose | Audience | Content |
|--------|---------|----------|---------|
| **vorion.org** | Corporate HQ & Foundation | Investors, partners, public | Company info, vision, team, investor relations |
| **basis.vorion.org** | Trust Foundation Docs | Technical architects | BASIS spec, trust theory, whitepapers |
| **learn.vorion.org** | HITL Certification Academy | Operators, supervisors | Human certification for AI oversight |
| **agentanchorai.com** | Agent Registration & Certification | Agents, developers | Agent onboarding, trust badges, verification |
| **aurais.net** | Consumer & B2B Applications | End users, businesses | DTC apps (Aurais/Pro/Exec), B2B dashboards |
| **cognigate.dev** | Developer Platform | Developers, builders | SDK, API docs, playground, npm packages |

### Audience Routing

| If you are a... | Go to... |
|-----------------|----------|
| Consumer wanting an AI assistant | aurais.net |
| Business wanting AI for your team | aurais.net/business |
| Developer building on our platform | cognigate.dev |
| Investor/partner evaluating us | vorion.org |
| Learning about trust architecture | basis.vorion.org |
| Human getting HITL certification | learn.vorion.org |
| Registering/certifying an AI agent | agentanchorai.com |

---

## Product Portfolio

| Product | Audience | Description | Monetization |
|---------|----------|-------------|--------------|
| **Aurais** | Consumers | Personal AI assistant with trust guardrails | Freemium |
| **Aurais Pro** | Professionals/SMB | Multi-agent workflows, team features | Subscription |
| **Aurais Exec** | Enterprise | Fleet management, compliance, audit | Custom pricing |
| **AgentAnchorAI** | Developers/B2B | Trust-as-a-Service backend API | Usage-based |

### Revenue Architecture

Consumer products (Aurais, Aurais Pro, Aurais Exec) live on aurais.net and are powered by AgentAnchorAI (agentanchorai.com), the Trust-as-a-Service infrastructure. AgentAnchorAI is also sold directly to:
- Developers building AI agents (SDK + API)
- Enterprises needing trust infrastructure (white-label)
- AI platform companies (OEM licensing)

---

## The Two Trust Model

### "The Door" (Gate Trust) vs "The Handshake" (Dynamic Trust)

**Gate Trust (The Door):** One-time evaluation at agent registration.
- Checks: Identity, credentials, capabilities, observation tier
- Speed: Can be slow (100-500ms), cacheable for hours/days
- Package: `@vorionsys/basis`
- Result: Initial T0-T7 tier assignment

**Dynamic Trust (The Handshake):** Continuous evaluation on every action.
- Checks: Behavior, performance, compliance, decay
- Speed: Must be fast (<50ms), limited caching (seconds)
- Package: `@vorionsys/a3i` + `atsf-core`
- Result: Score 0-1000 (fluctuates)

### How They Work Together

1. Agent presents credentials at "The Door" (Gate Trust)
2. BASIS validates manifest, assigns initial trust tier
3. Agent begins operating -- every action evaluated by "The Handshake" (Dynamic Trust)
4. Trust score rises/falls based on behavior, subject to decay
5. Tier transitions trigger capability grants/revocations

---

## Architecture Pipeline

```
INTENT -> BASIS -> ENFORCE -> COGNIGATE -> PROOF -> TRUST ENGINE
(Goals)   (Rules)  (Decide)   (Execute)    (Evidence)  (Score)
```

### Component Responsibilities

**INTENT** -- Goal and context processing
- Captures what the agent wants to do
- Validates against declared capabilities
- Passes to BASIS for rule evaluation

**BASIS** -- Baseline Authority for Safe & Interoperable Systems
- Trust factor definitions (16 factors, 5 groups)
- Validation gate (PASS/REJECT/ESCALATE decisions)
- Trust scoring algorithms
- Capability-tier mappings

**ENFORCE** -- Policy decision point
- Evaluates policy rules
- Applies ceiling enforcement (regulatory + organizational)
- Executes role gate checks (Kernel -> Policy -> BASIS 3-layer)

**COGNIGATE** -- Constrained execution runtime
- Agents operate within enforced boundaries
- Real-time constraint monitoring
- Sub-millisecond policy evaluation

**PROOF** -- Immutable evidence chain
- SHA-256 + SHA3-256 dual-hash anchoring
- Merkle tree batching for high throughput
- Tamper detection and inclusion proofs

**TRUST ENGINE** -- Behavioral trust scoring
- 16-factor evaluation with tier-specific weights
- Trust decay (182-day half-life, 9-step milestone)
- Recovery mechanics (asymmetric, accelerated, hysteresis)
- Signal recording and processing

---

## Platform Services

### AgentAnchor (agentanchorai.com)

Agent Registration & Certification platform:
- Agent onboarding and identity verification
- Trust score lookup and verification
- Certification badges and trust seals
- Audit trail viewer
- Public API: "Is this agent registered?"
- Creator trust service (16-factor aligned)

### Kaizen (learn.vorion.org)

HITL Certification Academy:
- Human-in-the-loop training and certification
- NEXUS/OMNI.AI chatbot (Triad AI: Claude + Gemini + Grok)
- 50+ term governance lexicon
- Learning paths by audience type
- Intent-based routing from vorion.org

### Cognigate API

REST API for governance operations:
- Phase 6 dashboard statistics
- Context hierarchy management
- Role gate evaluation
- Ceiling enforcement
- Gaming detection alerts
- Federated weight presets
- Provenance tracking
- v2 Trust API (16-factor)

---

## Technology Stack Summary

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ |
| Language | TypeScript 5.7+ (ESM) |
| Build | Turborepo monorepo |
| Package Manager | npm (workspaces) |
| API | Fastify 5 |
| Validation | Zod |
| Database | PostgreSQL 15+ / Supabase |
| ORM | Drizzle |
| Cache | Redis 7+ |
| Testing | Vitest |
| Frontend | Astro (marketing), React (dashboards) |
| CI/CD | GitHub Actions |
| Hosting | Vercel (apps), self-hosted (API) |
| AI | LangChain, CrewAI (optional integrations) |
