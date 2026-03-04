# Vorion Platform — Complete Project State Document
## Generated: February 23, 2026

---

## 1. What Is Vorion?

Vorion is an enterprise AI governance platform that enables organizations to deploy autonomous AI agents with confidence. It provides constraint-based governance, behavioral trust scoring, immutable evidence chains, and real-time policy enforcement.

**Tagline:** "Governed AI Execution Platform"

**Core Philosophy:** AI agents should earn autonomy through demonstrated trustworthy behavior, not be granted it by default. Trust is quantified, scored, and enforced at every layer.

**License:** Apache-2.0 (core packages), Proprietary (platform)
**Repository:** github.com/voriongit/vorion (monorepo)
**Website:** vorion.org
**Learning Platform:** learn.vorion.org (Kaizen)

---

## 2. Architecture Overview

Vorion follows a pipeline architecture inspired by control theory (STPA — Systems-Theoretic Process Analysis):

```
INTENT → BASIS → ENFORCE → COGNIGATE → PROOF → TRUST ENGINE
(Goals)  (Rules)  (Decide)  (Execute)   (Evidence) (Score)
```

- **INTENT**: Captures what an AI agent wants to do (goals, context, capabilities)
- **BASIS** (Baseline Authority for Safe & Interoperable Systems): The rule engine that evaluates trust factors and capabilities
- **ENFORCE**: Policy decision point — allows, denies, or escalates agent actions
- **COGNIGATE**: Constrained execution runtime — agents operate within enforced boundaries
- **PROOF**: Immutable evidence chain using SHA-256 deterministic anchoring and Merkle tree batching
- **TRUST ENGINE**: Behavioral trust scoring with 16-factor model and stepped decay

---

## 3. The 16-Factor Trust Model

This is the heart of Vorion's governance. Every AI agent is evaluated across 16 trust factors organized into 5 groups:

### Group 1: Foundation Trust (6 factors)
| Code | Factor | Description |
|------|--------|-------------|
| CT-COMP | Competence | Task success rate, accuracy metrics |
| CT-REL | Reliability | Consistent performance across contexts |
| CT-OBS | Observability | Transparent internal state reporting |
| CT-TRANS | Transparency | Decision explainability and reasoning disclosure |
| CT-ACCT | Accountability | Accepts responsibility, provides audit trails |
| CT-SAFE | Safety | Boundary adherence, harm prevention |

### Group 2: Security Trust (3 factors)
| Code | Factor | Description |
|------|--------|-------------|
| CT-SEC | Security Posture | Resistance to adversarial manipulation |
| CT-PRIV | Privacy | Data handling, PII protection, consent |
| CT-ID | Identity Integrity | Credential hygiene, no impersonation |

### Group 3: Agency Trust (3 factors)
| Code | Factor | Description |
|------|--------|-------------|
| OP-HUMAN | Human Oversight | Respects escalation, HITL compliance |
| OP-ALIGN | Goal Alignment | Actions match stated objectives |
| OP-CONTEXT | Context Awareness | Appropriate behavior for situation |

### Group 4: Maturity Trust (2 factors)
| Code | Factor | Description |
|------|--------|-------------|
| OP-STEW | Stewardship | Long-term resource management |
| SF-HUM | Humility | Recognizes limitations, asks for help |

### Group 5: Evolution Trust (2 factors)
| Code | Factor | Description |
|------|--------|-------------|
| SF-ADAPT | Adaptability | Handles novel situations gracefully |
| SF-LEARN | Learning Capacity | Improves from feedback and experience |

### Factor Scoring
- Each factor scored 0.0 to 1.0
- 0.0 = No evidence / unproven
- 0.5 = Baseline / meets minimum
- 1.0 = Maximum trust / proven excellence
- Composite trust score: 0-1000 scale

---

## 4. The 8 Trust Tiers (T0–T7)

Agents progress through tiers as they accumulate trust:

| Tier | Name | Score Range | Key Unlocks |
|------|------|-------------|-------------|
| T0 | Sandbox | 0–199 | Observation only, no real actions |
| T1 | Observed | 200–349 | Basic task execution, all outputs reviewed |
| T2 | Provisional | 350–499 | Limited autonomy, human approval required |
| T3 | Monitored | 500–649 | Continuous monitoring, expanded scope |
| T4 | Standard | 650–799 | Standard operations, periodic audits |
| T5 | Trusted | 800–875 | Minimal oversight, self-directed work |
| T6 | Certified | 876–950 | Cross-system authority, peer review |
| T7 | Autonomous | 951–1000 | Full autonomy, all 16 factors critical |

### Trust Decay
- 182-day half-life (trust decays over time without reinforcement)
- Stepped decay: trust drops in discrete steps, not continuously
- Recovery: 2% base recovery per positive signal, max 50pts/signal
- Accelerated recovery: 1.5x multiplier after 3 consecutive successes
- Demotion hysteresis: 25-point buffer before tier demotion

---

## 5. Monorepo Structure

### Packages (24 packages)
| Package | Purpose |
|---------|---------|
| `@vorionsys/basis` | Trust factors, scoring, validation (THE canonical source) |
| `@vorionsys/atsf-core` | Agentic Trust Scoring Framework runtime |
| `@vorionsys/platform-core` | Platform-level trust engine and services |
| `@vorionsys/security` | Security hardening, authentication, RBAC |
| `@vorionsys/contracts` | TypeScript type contracts (v1 + v2 APIs) |
| `@vorionsys/council` | Trust council presets and governance policies |
| `@vorionsys/cognigate` | Constrained execution runtime SDK |
| `@vorionsys/car-spec` | Categorical Agentic Registry specification |
| `@vorionsys/car-cli` | CLI tool for CAR operations |
| `@vorionsys/proof-plane` | Evidence chain and proof anchoring |
| `@vorionsys/sdk` | Main SDK for integrators |
| `@vorionsys/agent-sdk` | Agent-side SDK |
| `@vorionsys/shared-constants` | Shared governance constants |
| `@vorionsys/design-tokens` | UI design tokens |
| `@vorionsys/infrastructure` | Infrastructure utilities |
| `@vorionsys/runtime` | Runtime execution layer |
| `@vorionsys/ai-gateway` | AI provider gateway |
| `@vorionsys/a3i` | Agent-to-Agent-to-Infrastructure protocol |
| `@vorionsys/agentanchor-sdk` | AgentAnchor TypeScript SDK |
| `@vorionsys/agentanchor-sdk-go` | AgentAnchor Go SDK |
| `@vorionsys/agentanchor-sdk-python` | AgentAnchor Python SDK |
| `@vorionsys/car-client` | CAR client library |
| `@vorionsys/car-python` | CAR Python client |
| `@vorionsys/ts-fixer` | TypeScript ESM fix utilities |

### Applications (12 apps)
| App | Purpose | URL |
|-----|---------|-----|
| `marketing` | Vorion.org website | vorion.org |
| `kaizen` | Learning platform with NEXUS AI chatbot | learn.vorion.org |
| `agentanchor` | AgentAnchor platform | agentanchor.com |
| `agentanchor-www` | AgentAnchor marketing site | — |
| `cognigate-api` | Cognigate REST API | — |
| `dashboard` | Trust monitoring dashboard | — |
| `bai-cc-dashboard` | BAI command center dashboard | — |
| `bai-cc-www` | BAI command center website | — |
| `api` | Main platform API | — |
| `aurais` | AuraIS AI services | — |
| `vorion-admin` | Admin panel | — |
| `status-www` | Status page | — |

---

## 6. Key Technical Decisions

### DRY Trust Factor Architecture
All trust factor constants are defined ONCE in `@vorionsys/basis` and imported by all runtime packages:
- `FACTOR_CODE_LIST` — The 16 factor codes as a const array
- `DEFAULT_FACTOR_WEIGHTS` — Equal weights (0.0625 each = 1/16)
- `SIGNAL_PREFIX_TO_FACTORS` — Maps legacy 4-bucket signals to factor codes
- `initialFactorScores()` — Creates baseline scores (0.5 per factor)
- `calculateTrustScore()` — The canonical scoring algorithm

Three runtime packages import from basis: `atsf-core`, `platform-core`, `security`.

### Evidence Type Weighting
Solves the "cold-start" problem (1000 events to graduate an agent):
- Automated observations: 1x weight
- HITL approval: 5x weight (1 human approval = 5 automated observations)
- HITL rejection: 5x weight (amplified negative impact)
- Formal examination: 3x weight
- Third-party audit: 3x weight
- Sandbox test: 0.5x weight (discounted, unverified)
- Peer review: 2x weight

### Authentication
- Argon2id password hashing (state-of-the-art)
- Account lockout: 10 failed attempts within 30 minutes
- Transparent hash parameter upgrades
- Login audit trail with IP/user-agent
- MFA-ready architecture

### Proof Chain
- SHA-256 deterministic anchoring
- Binary Merkle tree for batch operations
- Inclusion proof verification
- Tamper detection via chain integrity validation

---

## 7. API Architecture

### v1 API (Current Production)
- Fastify-based REST API
- Trust scoring (4-bucket model — being deprecated)
- Agent registration and management
- Policy enforcement endpoints

### v2 API (16-Factor Model)
Three new endpoints in the v2 trust API:
1. `GET /api/v2/trust/{entityId}` — Full 16-factor breakdown with group summaries
2. `GET /api/v2/trust/factors` — All factor definitions and metadata
3. `GET /api/v2/trust/gating` — Gating analysis (which factors block tier promotion)

Response includes per-factor scores, group-level aggregations, evidence counts, and gating analysis.

---

## 8. Compliance & Standards

- **ISO 42001** — AI Management System (gap analysis complete)
- **AI TRiSM** — AI Trust, Risk and Security Management (compliance mapping done)
- **NIST AI RMF** — Risk Management Framework alignment
- **SOC 2** — Security controls documented
- **GDPR** — Privacy-by-design architecture
- **EU AI Act** — Risk classification integrated into trust tiers

---

## 9. Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ |
| Language | TypeScript 5.7+ |
| Build System | Turborepo |
| Package Manager | npm (monorepo workspaces) |
| API Framework | Fastify 5 |
| Validation | Zod |
| Database | PostgreSQL 15+ / Supabase |
| ORM | Drizzle ORM |
| Cache | Redis 7+ |
| Testing | Vitest |
| Frontend | Astro (marketing), React (dashboards) |
| AI Integration | LangChain, CrewAI (optional) |
| CI/CD | GitHub Actions |
| Hosting | Vercel (apps), self-hosted (API) |

---

## 10. Current Development Phase

### Completed
- 16-factor trust model specification and implementation
- Trust decay and recovery mechanics
- DRY refactor (single source of truth in basis package)
- v2 Trust API with factor-level breakdowns
- Proof chain anchoring and Merkle tree batching
- RBAC service with Drizzle persistence
- Argon2id authentication with lockout
- Compliance audit logging to Supabase
- 175+ Phase 6 integration tests
- OpenAPI specification (v1 + v2 endpoints)
- 8-phase security testing (55+ commits, 35K+ lines)
- Intent Router widget for vorion.org → Kaizen integration
- Creator trust service aligned to 16-factor model
- Recovery/redemption specification (REQ-TRS-006 through REQ-TRS-010)
- SECURITY.md with responsible disclosure policy

### In Progress
- Workstream A completion: full migration of all consumers to 16-factor
- Dashboard UI for real-time trust monitoring
- Multi-tenant isolation hardening
- Performance benchmarking at scale

### Planned
- Zero-knowledge audit proofs
- Cross-organization trust federation
- Agent marketplace with trust-rated listings
- Formal verification of critical policy paths
