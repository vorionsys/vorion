# NIST AI RMF Compliance Mapping -- Vorion Platform

| Field | Value |
|-------|-------|
| **Version** | 2.0.0 |
| **Date** | 2026-02-25 |
| **Framework** | NIST AI Risk Management Framework (AI RMF 1.0) |
| **Platform Version** | Vorion v6.x (Phase 6+) |
| **Status** | Living document -- updated with each platform release |

---

## Executive Summary

Vorion is an enterprise AI governance platform built on the BASIS (Baseline Authority for Safe & Interoperable Systems) open specification. The platform enforces a governance-before-execution model through a six-layer stack: INTENT, BASIS, ENFORCE, COGNIGATE, PROOF, and TRUST ENGINE.

This document maps Vorion's architectural components and operational capabilities to each of the four core NIST AI RMF functions -- **GOVERN**, **MAP**, **MEASURE**, and **MANAGE** -- at the subcategory control level. Each mapping references specific Vorion packages, configuration files, or architectural features that implement or support the control.

**Coverage summary:**

| Function | Estimated Coverage | Key Components |
|----------|-------------------|----------------|
| GOVERN | 90% | BASIS, RBAC (R_L0-R_L8), RLS, Proof Plane, ADR process |
| MAP | 85% | Intent system, 8-tier trust model, ceiling enforcement, CAR identity |
| MEASURE | 90% | Trust scores (0-1000), 341+ tests, dual-hash proof chain, 182-day decay |
| MANAGE | 80% | Tier demotion, Cognigate enforcement, webhooks, gaming detection |
| **Overall** | **~86%** | |

---

## GOVERN Function

*"Cultivate a culture of risk management"*

The GOVERN function addresses organizational governance structures, policies, and processes for managing AI risks throughout the AI lifecycle.

| NIST Control ID | Control Name | Vorion Feature | Implementation Details | Status |
|----------------|-------------|----------------|----------------------|--------|
| GV-1.1 | Legal and regulatory requirements are identified | Compliance documentation suite | NIST AI RMF mapping (this document), ISO 42001 gap analysis, EU AI Act alignment, OWASP ASI mapping, NIST COSAiS SP 800-53 overlay in `docs/compliance/`. Governance matrix in `compliance/governance-matrix.yaml` tracks NIST 800-53, SOC 2, GDPR, ISO 27001, FedRAMP, and CMMC frameworks. | Implemented |
| GV-1.2 | Trustworthy AI characteristics are integrated into policies | BASIS rule engine (`packages/basis/`) | BASIS encodes trustworthy AI characteristics (fairness, accountability, transparency) as declarative governance policies. Policy versioning via immutable `policy_versions` table (`packages/contracts/src/db/policy-versions.ts`) ensures full traceability. | Implemented |
| GV-1.3 | Processes for risk management are established | Governance-before-execution architecture | Every agent action passes through INTENT -> BASIS -> ENFORCE -> COGNIGATE -> PROOF pipeline. No execution occurs without governance evaluation. Architecture documented in 18 ADRs (`docs/adr/`). | Implemented |
| GV-2.1 | Roles and responsibilities are defined | RBAC with 8 role levels | `packages/contracts/src/db/rbac.ts` defines R_L0 through R_L8 role levels. Dual-layer role gates (kernel + BASIS) enforce authorization. Organizational governance documented in `docs/constitution/vorion_governance.md`. | Implemented |
| GV-2.2 | Mechanisms for accountability exist | Proof Plane audit chain | `packages/proof-plane/` provides SHA-256 + SHA3-256 dual-hash append-only chain. Every governance decision (trust changes, role grants, policy evaluations) produces a cryptographically chained proof record. Ed25519 digital signatures provide non-repudiation. | Implemented |
| GV-3.1 | Decision-making is informed and documented | Architecture Decision Records | 18 ADRs document key technical decisions with context, alternatives considered, and consequences. Decision authority matrix in governance constitution requires joint approval for trust computation, compliance guarantees, and schema changes. | Implemented |
| GV-3.2 | Diverse perspectives inform AI risk management | Human-in-the-Loop (HITL) gates | Trust tier T5+ (Trusted through Autonomous) requires human gate approval per ADR-002. Kaizen learning platform (`apps/kaizen/`) provides continuous education. Escalation system routes high-risk decisions to qualified reviewers. | Implemented |
| GV-4.1 | Organizational practices reflect a culture of risk management | Sprint-based governance reviews | Progress tracked through Phase 1-9 milestones. Security bootstrap plan, security gameplan, and security task tracking at project root. Semgrep SAST and gitleaks secret scanning enforced on every push via CI. | Implemented |
| GV-5.1 | Ongoing monitoring processes are in place | Trust Engine continuous scoring | Trust scores computed at runtime with 182-day stepped decay half-life. Real-time dashboards in `apps/dashboard/` and `apps/agentanchor/` surface trust state, anomalies, and compliance posture. OpenTelemetry instrumentation (`@opentelemetry/*` dependencies) provides observability. | Implemented |
| GV-6.1 | Policies and procedures are updated | Immutable policy versioning | `policy_versions` table is append-only (RLS enforced, no UPDATE/DELETE). Policy changes create new versions with full traceability. `shared-constants` package (`@vorionsys/shared-constants`) is the canonical source of truth for trust tiers and role mappings. | Implemented |

---

## MAP Function

*"Contextualize risks"*

The MAP function addresses the identification and documentation of AI system context, including intended use, users, and potential impacts.

| NIST Control ID | Control Name | Vorion Feature | Implementation Details | Status |
|----------------|-------------|----------------|----------------------|--------|
| MP-1.1 | Intended purposes and context of use are documented | Intent system | Every agent action begins with an Intent submission containing `action`, `actionType`, `resourceScope`, and contextual metadata. Intents are persisted in `packages/contracts/src/db/intents.ts` and logged to the Proof Plane as `INTENT_RECEIVED` events. | Implemented |
| MP-2.1 | AI systems are categorized based on risk | 8-tier trust model (T0-T7) | `@vorionsys/shared-constants` defines 8 trust tiers from T0_SANDBOX (score 0-199, isolated, no external access) to T7_AUTONOMOUS (score 951-1000, full self-governance). Each tier maps to explicit privileges and operational boundaries per ADR-002. | Implemented |
| MP-2.2 | Specific AI system risks are identified | CAR (Categorical Agentic Registry) | `@vorionsys/car-spec` (v1.1.0, published) provides agent identity and registration. CAR strings encode agent type, capabilities, and risk profile. `packages/car-client/` provides API client; `packages/car-cli/` provides CLI tooling. | Implemented |
| MP-3.1 | Benefits and costs are assessed | Per-agent operation tracking | `packages/contracts/src/db/operations.ts` tracks operations per agent. AgentAnchor ROI dashboards (`apps/agentanchor/`) provide visibility into resource utilization and value delivery per tenant. | Partial |
| MP-4.1 | Risks in deployment setting are identified | Ceiling enforcement | Trust score ceiling caps restrict maximum trust based on regulatory context. EU AI Act ceiling limits high-risk agents to T3 maximum. Ceiling enforcement is kernel-level (1000-point cap system) and cannot be bypassed by application code. | Implemented |
| MP-4.2 | Internal and external risks are mapped | Gaming detection | ATSF Core (`packages/atsf-core/`) detects abuse patterns including RAPID_CHANGE and SCORE_MANIPULATION. Severity classified as LOW, MEDIUM, HIGH, CRITICAL. Alerts route to escalation system. | Implemented |
| MP-5.1 | Likelihood of risks is assessed | Trust score decay model | Stepped decay with 182-day half-life quantifies inactivity risk. Agents that stop operating gradually lose trust, preventing stale high-trust agents from retaining elevated privileges indefinitely. Grace period (0-6 days), early warning (7 days, ~93%), half-life (182 days, 50%). | Implemented |

---

## MEASURE Function

*"Analyze and assess risks"*

The MEASURE function addresses the analysis, assessment, and tracking of AI risks using appropriate metrics and methods.

| NIST Control ID | Control Name | Vorion Feature | Implementation Details | Status |
|----------------|-------------|----------------|----------------------|--------|
| MS-1.1 | Appropriate risk metrics are identified | Trust score system (0-1000) | Continuous numeric trust scores with provenance-based modifiers. ATSF Core (`packages/atsf-core/`) computes scores using hybrid weight presets (ACI spec + Axiom deltas). Creation modifiers applied at agent instantiation time. Ceiling enforcement ratios quantify regulatory constraint frequency. | Implemented |
| MS-1.2 | AI risk metrics are integrated into organizational risk management | Compliance dashboard integration | Trust scores, proof chain integrity, and policy compliance metrics surfaced in `apps/agentanchor/` governance views and `apps/dashboard/` operational views. Metrics exportable via Prometheus (`prom-client` dependency). | Implemented |
| MS-2.1 | AI systems are evaluated against requirements | Automated test suites | 341+ tests across the monorepo via Vitest. Stryker mutation testing (`@stryker-mutator/*` dependencies) validates test effectiveness. CI pipeline includes typecheck, lint, build, test, SAST (Semgrep), and secrets scan (gitleaks) as blocking quality gates. | Implemented |
| MS-2.2 | AI systems are evaluated for trustworthiness | ATSF trust scoring framework | `@vorionsys/atsf-core` (published on npm) provides the Agentic Trust Scoring Framework. Evaluates agents across behavioral, performance, and compliance dimensions. Supports Supabase persistence adapter (`packages/atsf-core/src/persistence/supabase.ts`) and intent repository (`supabase-intent-repository.ts`). | Implemented |
| MS-3.1 | Risks are tracked over time | Proof Plane dual-hash chain | `packages/proof-plane/` maintains tamper-evident records via SHA-256 + SHA3-256 dual hashing with linear chain linking. Every trust score change logged as `TRUST_DELTA` event with `previousScore`, `newScore`, `previousBand`, `newBand`, and `reason`. Merkle tree aggregation (`events/merkle-tree.ts`) enables efficient batch verification. | Implemented |
| MS-3.2 | Feedback is collected on AI system performance | Behavioral trust feedback loop | Trust score decay (182-day half-life) penalizes inactivity. Behavioral milestones reward positive patterns (successful executions, clean audit records). Trust deltas recorded in proof chain create a complete behavioral history per agent. | Implemented |
| MS-4.1 | Measurement approaches are regularly assessed | Continuous integration quality gates | CI/CD pipeline (`.github/workflows/`) runs on every push: lint, typecheck, build, test, SAST, license audit, secrets scan. Test coverage tracked via `@vitest/coverage-v8`. Circular dependency detection via `madge`. | Implemented |

---

## MANAGE Function

*"Prioritize and act on risks"*

The MANAGE function addresses the prioritization and implementation of risk treatment strategies.

| NIST Control ID | Control Name | Vorion Feature | Implementation Details | Status |
|----------------|-------------|----------------|----------------------|--------|
| MG-1.1 | Risks are prioritized based on impact | Severity classification | CVSS-based severity for security findings. Gaming alerts classified across four levels: LOW, MEDIUM, HIGH, CRITICAL. Escalation routing based on severity and trust tier. | Implemented |
| MG-1.2 | Risk treatment plans are developed | Automatic tier demotion | Trust threshold breaches trigger automatic demotion to lower trust tiers with corresponding privilege reduction. Role gate enforcement prevents unauthorized escalation. Ceiling capping constrains scores to regulatory limits. Agent lifecycle state machine manages transitions between active, suspended, and revoked states. | Implemented |
| MG-2.1 | Strategies to address identified risks are implemented | Cognigate enforcement runtime | `packages/cognigate/` (SDK published as `@vorionsys/cognigate`) provides real-time policy enforcement. Constrained execution runtime evaluates every action against current trust score, applicable policies, and ceiling caps before permitting execution. | Implemented |
| MG-2.2 | Mechanisms for third-party risk management exist | Agent SDK and API governance | `packages/agent-sdk/`, `packages/agentanchor-sdk/`, `packages/agentanchor-sdk-go/`, and `packages/agentanchor-sdk-python/` provide governed access for third-party integrations. SDKs enforce governance checks at the SDK boundary. API key management via `packages/contracts/src/db/api-keys.ts` and service accounts via `service-accounts.ts`. | Implemented |
| MG-3.1 | Risk management decisions are documented | ADR process + proof chain | 18 Architecture Decision Records in `docs/adr/` document decisions with context, alternatives, and consequences. Proof Plane captures runtime governance decisions cryptographically. `SECURITY.md` defines vulnerability disclosure. Security whitepaper, STPA implementation guide, and platform operations runbook in `docs/`. | Implemented |
| MG-3.2 | Risk management activities are reviewed | Webhook notifications and monitoring | `packages/contracts/src/db/webhooks.ts` supports event-driven notifications for governance events. OpenTelemetry tracing (`@opentelemetry/*` dependencies) provides distributed observability. Prom-client metrics expose trust scoring, proof chain, and enforcement performance. | Implemented |
| MG-4.1 | Risks are communicated to stakeholders | Cognigate SDK real-time queries | External systems query trust scores and governance state via the Cognigate SDK. AgentAnchor portal provides compliance reporting dashboards. Status page (`apps/status-www/`) communicates platform health. Structured escalation system routes critical issues to appropriate decision-makers with full context. | Partial |
| MG-4.2 | Risk communication is timely and actionable | Escalation system | `packages/contracts/src/db/escalations.ts` defines the escalation schema. Escalations route high-risk decisions to human reviewers with structured context (intent details, trust score, applicable policies, risk assessment). Time-bounded review with automatic safe-default behavior on timeout. | Partial |

---

## Cross-Cutting Controls

Several Vorion capabilities span multiple NIST AI RMF functions:

### Tenant Isolation (GV-2, MP-4, MG-2)

PostgreSQL Row-Level Security (RLS) enforces `tenant_id` scoping at the database engine level. RLS policies prevent cross-tenant data access even in the presence of application bugs. Supabase Auth provides JWT-based authentication; `@supabase/ssr` middleware validates sessions at the edge. See ADR-003 (Supabase Auth with RLS).

### Immutable Audit Trail (GV-2, GV-6, MS-3, MG-3)

The Proof Plane (`packages/proof-plane/`) provides dual-hash (SHA-256 + SHA3-256) append-only audit records. RLS enforces INSERT-only on proof tables and policy version tables. Ed25519 digital signatures provide non-repudiation. Merkle tree aggregation enables efficient batch verification. See ADR-005 (Proof Plane Dual-Hash).

### Type-Safe Governance Contracts (GV-1, MS-2, MG-2)

`@vorionsys/contracts` defines all governance schemas (Drizzle ORM tables, Zod validators, TypeScript types) as the monorepo-wide single source of truth. Changes to governance contracts are atomic across all consumers within a single PR. See ADR-001 (Monorepo with Turborepo) and ADR-004 (Drizzle ORM).

### Continuous Integration Quality Gates (MS-2, MS-4, MG-3)

The CI pipeline enforces: TypeScript strict mode compilation, ESLint static analysis, Vitest test execution (341+ tests), Semgrep SAST scanning (blocking), gitleaks secrets scanning (blocking), npm audit (high/critical blocking), and circular dependency detection. CI configuration in `.github/workflows/`.

---

## Gaps and Remediation Roadmap

| Gap | NIST Controls Affected | Remediation Plan | Target |
|-----|----------------------|-----------------|--------|
| External blockchain anchoring not yet implemented | MS-3, MG-3 | Database schema ready (`packages/contracts/src/db/merkle.ts`). Integration with Ethereum/Polygon or RFC 3161 TSA planned. | Q3 2026 |
| ZK proof system in development | MS-1, MG-4 | Schnorr-based prototype implemented. Production SNARK integration (Circom/Groth16) planned for privacy-preserving trust attestation. | Q2-Q3 2026 |
| TEE integration scaffolded | GV-2, MG-2 | Interfaces defined in security package. SDK integration required for hardware-backed key management and secure enclaves. | Q3 2026 |
| Advanced risk communication features | MG-4 | Expanded webhook event types, Slack/Teams integration, and structured compliance reporting exports. | Q2 2026 |
| Formal third-party audit | GV-6, MS-2 | SOC 2 Type II audit planned. ISO 42001 gap analysis complete. | Q4 2026 |

---

## Evidence Reference Index

| Evidence Category | Location | Description |
|------------------|----------|-------------|
| Architecture Decisions | `docs/adr/` | 18 ADRs documenting key technical decisions |
| Compliance Mappings | `docs/compliance/` | NIST AI RMF, COSAiS, OWASP ASI mappings |
| Governance Constitution | `docs/constitution/` | Organizational governance, audit requirements |
| Security Documentation | `SECURITY.md`, `security.txt` | Vulnerability disclosure, machine-readable policy |
| Trust Model | `packages/shared-constants/` | Canonical trust tiers, role mappings |
| Governance Schemas | `packages/contracts/src/db/` | All Drizzle ORM table definitions |
| Proof System | `packages/proof-plane/src/` | Dual-hash chain, Merkle tree, Ed25519 signatures |
| Trust Scoring | `packages/atsf-core/` | ATSF trust scoring framework |
| Policy Engine | `packages/basis/` | BASIS rule engine |
| Enforcement Runtime | `packages/cognigate/` | Cognigate enforcement SDK |
| Agent Identity | `packages/car-spec/`, `packages/car-client/` | CAR specification and client |
| CI/CD Pipeline | `.github/workflows/` | Automated quality gates |
| Compliance Framework | `compliance/` | Governance matrix, control registry, OSCAL data |
| Test Suites | `tests/`, `packages/*/tests/` | 341+ automated tests |

---

## References

- **NIST AI RMF:** <https://www.nist.gov/artificial-intelligence/risk-management-framework>
- **NIST AI RMF Playbook:** <https://airc.nist.gov/AI_RMF_Playbook>
- **NIST SP 800-53 Rev. 5:** <https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final>
- **EU AI Act:** <https://artificialintelligenceact.eu/>
- **ISO/IEC 42001:** <https://www.iso.org/standard/81230.html>
- **Vorion ADRs:** `docs/adr/`
- **Vorion SECURITY.md:** `SECURITY.md`
- **Vorion Governance Constitution:** `docs/constitution/vorion_governance.md`
- **Existing NIST COSAiS Alignment:** `docs/compliance/NIST-COSAiS-ALIGNMENT.md`
- **OWASP ASI Mapping:** `docs/compliance/OWASP-ASI-MAPPING.md`
