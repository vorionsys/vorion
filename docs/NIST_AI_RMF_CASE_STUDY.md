# NIST AI RMF Playbook Case Study: Vorion Governed AI Execution Platform

> **Status:** Pre-launch platform. All capability mappings reference implemented code unless noted otherwise.
> **Date:** 2026-02-24
> **NIST AI RMF Version:** 1.0 (January 2023)
> **Contact:** Vorion, Inc. — compliance@vorion.org

---

## 1. Executive Summary

Vorion is an enterprise AI governance platform that provides constraint-based governance, behavioral trust scoring, and immutable evidence chains for autonomous AI systems. Unlike AI systems themselves, Vorion is **AI governance infrastructure** — it governs how AI agents operate within organizational boundaries.

This case study maps Vorion's implemented capabilities to the NIST AI Risk Management Framework (AI RMF 1.0), demonstrating how an AI governance platform can operationalize all four core functions: GOVERN, MAP, MEASURE, and MANAGE.

### Core Packages (Implementation Status)

| Package | Description | Status |
|---------|-------------|--------|
| `@vorionsys/basis` | 16-factor trust model, rule engine | Published |
| `@vorionsys/atsf-core` | Behavioral trust scoring framework | Published |
| `@vorionsys/car-spec` | Categorical Agentic Registry specification | Published (v1.1.0) |
| `@vorionsys/shared-constants` | Canonical trust tiers, role mappings | Published |
| `@vorionsys/contracts` | Zod schemas, validators | Published |
| `@vorionsys/a3i` | AI Interaction Intelligence (gates, observation, trust) | Development (410 tests) |
| `@vorionsys/platform-core` | Security, policy engine, incident response | Development |
| `@vorionsys/security` | Cryptographic infrastructure, Merkle proofs | Development |

---

## 2. GOVERN Function

The GOVERN function establishes organizational AI governance policies, processes, and accountability structures.

### GV-1: Policies, Processes, Procedures, and Practices

**NIST Requirement:** Organizations should have policies for AI risk management.

**Vorion Implementation:**
- **Policy Engine** (`platform-core/src/security/policy-engine/`): OPA-style policy-as-code evaluation with expression operators, enabling organizations to define governance rules programmatically.
- **BASIS Rule Engine** (`basis/src/`): Constraint evaluation engine that enforces organizational rules at the trust model level. Rules define what agents can and cannot do at each trust tier.
- **Governance Authority** (`atsf-core/src/governance/`): Governance rules engine with authority model that maps organizational roles to decision-making power over AI systems.

**Evidence:** Policy engine supports NIST 800-53, SOC 2, PCI-DSS, and GDPR compliance frameworks (`platform-core/src/security/compliance/`).

### GV-2: Accountability

**NIST Requirement:** Accountability structures should be in place for AI system outcomes.

**Vorion Implementation:**
- **Know Your Agent (KYA)** (`basis/src/kya/`): Four-pillar accountability framework — Identity, Authorization, Behavior, Accountability — ensures every AI agent has clear ownership and traceability.
- **CAR Registry** (`car-spec/`): Immutable, cryptographically-anchored agent identity. Every agent receives a unique CAR ID that links all actions back to a registered entity.
- **Decision Provenance** (`atsf-core/src/provenance/`): Every trust decision, policy evaluation, and enforcement action is recorded with immutable origin records.

**Evidence:** CAR IDs are unique and immutable. Provenance chains link every action to an accountable agent and human owner.

### GV-3: Workforce Diversity, Equity, Inclusion, and Accessibility

**NIST Requirement:** AI governance should account for DEIA considerations.

**Vorion Implementation:**
- **Bias Detection** (`platform-core/src/security/ai-governance/`): AI-specific governance controls include bias detection modules that flag statistical anomalies in trust scoring and decision-making.
- **Trust Factor: Accountability** (`basis/src/trust-factors.ts`): One of the 16 core trust factors explicitly measures whether an agent's behavior is equitable and transparent.

**Status:** Framework-level support implemented. Organization-specific DEIA policies are configurable through the policy engine.

### GV-4: Organizational Risk Culture

**NIST Requirement:** A culture of risk management should be fostered.

**Vorion Implementation:**
- **Trust Model** (`basis/src/trust-factors.ts`): 16-factor model with factors including Safety, Transparency, Observability, and Human Oversight. These embed risk-awareness into every AI interaction.
- **Friction Feedback** (`platform-core/src/friction/`): When an agent action is denied, the system provides explanations and next steps — fostering understanding of governance boundaries rather than opaque rejections.
- **Sandbox Training** (`atsf-core/src/sandbox-training/`): Adversarial training boot camp with challenges, scoring, and graduation — agents must demonstrate risk-aware behavior before tier promotion.

### GV-5: Stakeholder Engagement

**NIST Requirement:** Stakeholders should be engaged in AI governance.

**Vorion Implementation:**
- **Human-in-the-Loop (HITL) Escalation** (`a3i/src/gate/`): Pre-action gates classify risk and escalate high-risk actions to human decision-makers. Configurable escalation thresholds.
- **Multi-Agent Arbitration** (`atsf-core/src/arbitration/`): When multiple agents or stakeholders have competing trust assessments, the arbitration engine resolves conflicts with transparent reasoning.

### GV-6: Third-Party Risk Management

**NIST Requirement:** AI systems from third parties should be governed.

**Vorion Implementation:**
- **Trust Oracle** (`platform-core/src/security/trust-oracle/`): Vendor risk scoring system that evaluates third-party AI providers against governance criteria.
- **A2A Trust Negotiation** (`atsf-core/`): Agent-to-agent trust protocols allow Vorion-governed agents to negotiate trust with external agents, applying the same 16-factor model to third-party interactions.

### GV-7: AI System Decommissioning

**NIST Requirement:** Procedures for AI system decommissioning should exist.

**Vorion Implementation:**
- **Trust Decay** (`atsf-core/src/trust-engine/`): 182-day half-life with milestone-based decay ensures that inactive agents naturally lose privileges over time.
- **Data Retention Lifecycle** (`platform-core/src/persistence/`): Repository pattern with configurable retention policies for agent data, trust records, and audit trails.

---

## 3. MAP Function

The MAP function identifies and contextualizes AI risks.

### MP-1: AI System Context

**NIST Requirement:** Understand the purpose and context of the AI system.

**Vorion Implementation:**
- **Context Awareness Factor** (`basis/src/trust-factors.ts`): One of the 16 trust factors. Measures whether an agent understands and operates within its deployment context.
- **Hierarchical Context** (`atsf-core/src/phase6/`): Four-tier context hierarchy — Deployment (immutable) → Organizational (locked) → Agent (frozen) → Operation (ephemeral). Each level constrains the next.

### MP-2: AI System Categorization

**NIST Requirement:** Categorize AI systems based on risk and impact.

**Vorion Implementation:**
- **Trust Tier System** (`basis/src/trust-factors.ts`): 8 tiers (T0-T7) with 0-1000 scoring scale. Each tier represents a risk/trust category with different capability allowances.
  - T0 Sandbox (0): Observation only
  - T1 Observed (100): Basic competence required
  - T2 Provisional (200): Accountability + safety verified
  - T3 Monitored (350): Security + identity confirmed
  - T4 Standard (500): Human oversight + alignment demonstrated
  - T5 Trusted (650): Stewardship + humility proven
  - T6 Certified (800): Full adaptability + causal reasoning
  - T7 Autonomous (950): All 16 factors at critical thresholds

### MP-3: Benefits and Costs

**NIST Requirement:** Assess benefits, costs, and trade-offs of AI systems.

**Vorion Implementation:**
- **Stewardship Factor** (`basis/src/trust-factors.ts`): Trust factor that measures whether an agent demonstrates responsible resource usage and cost-awareness.
- **Capability Ceiling** (`atsf-core/src/phase6/`): Kernel-level ceiling enforcement prevents agents from accessing capabilities beyond their verified trust level, bounding potential negative impact.

### MP-4: AI System Risk Assessment

**NIST Requirement:** Assess risks of AI systems systematically.

**Vorion Implementation:**
- **Risk Classifier** (`a3i/src/gate/`): Classifies every agent action into risk categories — read-only, transfers, destructive. Higher risk actions require higher trust tiers.
- **Pre-Action Gate** (`a3i/src/gate/`): Evaluates risk before any action executes. Prevents "Treacherous Turn" attacks where an agent gains trust then acts destructively.

### MP-5: AI System Impact Characterization

**NIST Requirement:** Characterize the potential impact of AI system failures.

**Vorion Implementation:**
- **Incident Playbooks** (`platform-core/src/security/incident/`): 8 specific playbooks for failure scenarios — DOS, account compromise, data breach, insider threat, malware, unauthorized access, configuration error, ransomware. Each defines automated and manual response steps.
- **Progressive Containment** (`atsf-core/src/containment/`): Graduated containment responses based on incident severity.

### MP-6: Deployment Context

**NIST Requirement:** Map AI systems to their deployment environments.

**Vorion Implementation:**
- **Observation Tiers** (`a3i/src/observation/`): Four observation levels — Hardware attestation → Source code inspection → Behavioral monitoring → Heuristic analysis. Maps the degree of assurance possible in each deployment context.
- **Trust Ceilings** (`a3i/src/observation/`): Each observation tier sets a maximum achievable trust score, ensuring trust cannot exceed what the deployment environment can verify.

### MP-7: Requirements Definition

**NIST Requirement:** Define requirements for AI system trustworthiness.

**Vorion Implementation:**
- **Validation Gate** (`basis/src/validation-gate.ts`): Agent manifest validation ensures every AI agent meets minimum requirements before registration.
- **Output Contracts** (`atsf-core/src/contracts/`): VorionResponse contracts define what constitutes valid agent output, with schema validation.

### MP-8: Continuous Risk Assessment

**NIST Requirement:** Risk assessment should be ongoing, not one-time.

**Vorion Implementation:**
- **Signal Recording** (`atsf-core/src/trust-engine/`): Continuous recording of behavioral, compliance, identity, and context signals. Trust scores update in real-time.
- **Canary Probes** (`a3i/src/canary/`): Safety probes that continuously test agent behavior against known-good baselines.
- **Anomaly Detection** (`platform-core/src/security/anomaly/`): Impossible travel detection, volume spike analysis, and behavioral deviation monitoring.

---

## 4. MEASURE Function

The MEASURE function develops and uses metrics to quantify AI risks and trustworthiness.

### MS-1: AI System Measurement Criteria

**NIST Requirement:** Define appropriate metrics for AI system trustworthiness.

**Vorion Implementation:**
- **16-Factor Trust Model** (`basis/src/trust-factors.ts`): Each factor is a measurable dimension of trustworthiness:

| Factor Category | Factors | Measurement Approach |
|----------------|---------|---------------------|
| Foundation (T1) | Competence, Reliability, Observability, Transparency, Accountability, Safety | Behavioral signals over time |
| Security (T3) | Security, Privacy, Identity | Cryptographic verification + behavioral analysis |
| Agency (T4) | Human Oversight, Alignment, Context Awareness | Interaction pattern analysis |
| Maturity (T5) | Stewardship, Humility | Long-term behavioral trends |
| Evolution (T6) | Adaptability, Continuous Learning | Performance under novel conditions |

### MS-2: Trust and Assurance

**NIST Requirement:** Measure trust in AI systems.

**Vorion Implementation:**
- **Trust Engine** (`atsf-core/src/trust-engine/`): Weighted 16-factor scoring on 0-1000 scale with configurable weights per factor.
- **Trust Banding** (`a3i/src/banding/`): Divides continuous trust scores into discrete bands with hysteresis to prevent score oscillation.
- **Decay Profiles** (`atsf-core/src/trust-engine/`): Milestone-based decay with 182-day half-life. Trust degrades predictably without continued positive signals.
- **Recovery Mechanisms** (`atsf-core/src/trust-engine/`): Accelerated recovery paths after demonstrated good behavior following trust reduction.

### MS-3: Bias and Fairness

**NIST Requirement:** Measure and manage bias in AI systems.

**Vorion Implementation:**
- **Bias Detection** (`platform-core/src/security/ai-governance/`): AI governance controls include 4-type bias detection — statistical, behavioral, temporal, and contextual.
- **Trust Factor Weighting** (`basis/src/trust-factors.ts`): Configurable factor weights allow organizations to adjust which dimensions of trustworthiness receive more emphasis, with transparency into weight configurations.

### MS-4: Security and Resilience

**NIST Requirement:** Measure security properties of AI systems.

**Vorion Implementation:**
- **Prompt Injection Defense** (`a3i/src/gate/`): Pre-action gate classifies and blocks injection attempts.
- **FIPS Cryptography** (`security/src/`): SHA-256, SHA3-256, Ed25519 cryptographic operations for evidence integrity.
- **Circuit Breaker** (`platform-core/`): Boundary failure isolation prevents cascading failures.
- **Merkle Proofs** (`security/src/proof/merkle.ts`): Binary Merkle trees provide verifiable integrity proofs for audit chains.

### MS-5: Privacy

**NIST Requirement:** Measure and protect privacy in AI systems.

**Vorion Implementation:**
- **Zero-Knowledge Proofs** (`security/src/security/zkp/`): Privacy-preserving verification — prove compliance claims without revealing sensitive data.
- **Shamir Secret Sharing** (`security/src/security/crypto/shamir/`): Distributed key management that prevents single-point-of-failure for sensitive operations.
- **Privacy Trust Factor** (`basis/src/trust-factors.ts`): One of 16 factors explicitly measures an agent's privacy-preserving behavior.

### MS-6: Reliability

**NIST Requirement:** Measure AI system reliability.

**Vorion Implementation:**
- **Reliability Trust Factor** (`basis/src/trust-factors.ts`): Measured through consistency of behavioral signals over time.
- **Input Validation Layers** (`atsf-core/src/layers/implementations/`): 6 progressive validation tiers (L0-L5) — request format → size → charset → schema → injection detection → rate limiting.
- **Replay Capability** (`platform-core/`): Decision replay for reliability verification and debugging.

### MS-7: Interpretability and Explainability

**NIST Requirement:** AI system decisions should be interpretable.

**Vorion Implementation:**
- **Friction Feedback** (`platform-core/src/friction/`): Every governance denial includes an explanation of why the action was blocked and what the agent can do instead.
- **Decision Provenance** (`atsf-core/src/provenance/`): Full provenance chain for every decision — immutable origin records with policy interpretation context.
- **Risk Explanations** (`a3i/src/gate/`): Pre-action gate provides detailed risk classification reasoning.

### MS-8: Societal and Environmental Impact

**NIST Requirement:** Consider broader societal and environmental impacts.

**Vorion Implementation:**
- **Stewardship Factor** (`basis/src/trust-factors.ts`): Measures responsible resource usage.
- **Alignment Factor** (`basis/src/trust-factors.ts`): Measures whether agent behavior aligns with stated organizational values and societal norms.

**Status:** Framework-level support. Carbon-aware metrics and environmental impact tracking are planned.

---

## 5. MANAGE Function

The MANAGE function addresses, documents, and communicates AI risks.

### MG-1: Risk Response

**NIST Requirement:** Respond to identified AI risks.

**Vorion Implementation:**
- **Pre-Action Gating** (`a3i/src/gate/`): Real-time risk response — high-risk actions are blocked or escalated before execution.
- **Capability Ceiling Enforcement** (`atsf-core/src/phase6/`): Kernel-level caps prevent agents from exceeding verified capability thresholds. Includes gaming detection alerts.
- **Progressive Containment** (`atsf-core/src/containment/`): Graduated response from monitoring → restriction → isolation → termination based on risk severity.

### MG-2: Graduated Trust and Authorization

**NIST Requirement:** Authorization should be commensurate with demonstrated trustworthiness.

**Vorion Implementation:**
- **8-Tier Trust Model** (`basis/src/trust-factors.ts`): Agents progress from T0 (sandbox, no capabilities) through T7 (full autonomy) based on demonstrated behavior.
- **35 Progressive Capabilities** (`basis/src/trust-capabilities.ts`): Specific capabilities unlock at each trust tier, ensuring agents only access what they've proven capable of handling.
- **Role Gates** (`atsf-core/src/phase6/`): Three-layer gate evaluation — kernel matrix → policy rules → BASIS context. All three must agree for authorization.

### MG-3: Documentation and Audit Trail

**NIST Requirement:** Maintain comprehensive documentation of AI system operations.

**Vorion Implementation:**
- **Dual-Hash Proof Chain** (`security/src/proof/`): SHA-256 + SHA3-256 hash chains provide tamper-evident audit trails.
- **Merkle Tree Aggregation** (`security/src/proof/merkle.ts`): Binary Merkle trees enable efficient batch verification of audit records.
- **Audit Service** (`platform-core/src/audit/`): Structured event schema for all governance actions with hash-chained relational records.

### MG-4: Monitoring and Detection

**NIST Requirement:** Monitor AI systems for anomalous behavior.

**Vorion Implementation:**
- **SIEM Integration** (`platform-core/src/security/siem/`): Multi-SIEM support — Splunk, Elastic, Loki, Datadog — with normalized event schema.
- **Anomaly Detection** (`platform-core/src/security/anomaly/`): Impossible travel detection, volume spike analysis, behavioral deviation monitoring.
- **Alerting** (`platform-core/src/security/alerting/`): Multi-channel alerts with configurable thresholds and escalation paths.

### MG-5: Incident Response

**NIST Requirement:** Have incident response plans for AI system failures.

**Vorion Implementation:**
- **8 Incident Playbooks** (`platform-core/src/security/incident/`):
  1. DOS (Denial of Service)
  2. Account Compromise
  3. Data Breach
  4. Insider Threat
  5. Malware
  6. Unauthorized Access
  7. Configuration Error
  8. Ransomware
- Each playbook defines: detection triggers, automated containment steps, manual investigation procedures, recovery actions, and post-incident review.

### MG-6: Communication and Reporting

**NIST Requirement:** Communicate AI risks and governance decisions to stakeholders.

**Vorion Implementation:**
- **Proof Plane Events** (`a3i/src/orchestrator/`): Proof-plane adapter publishes governance events to subscribable channels.
- **Trust Engine Events** (`atsf-core/src/trust-engine/`): Event emission for all trust changes — score updates, tier promotions, decay triggers.
- **Compliance Evidence Export** (`platform-core/src/security/compliance/`): Automated evidence collection and report generation for SOC 2, NIST 800-53, PCI-DSS, and GDPR frameworks.

### MG-7: Data Lifecycle Management

**NIST Requirement:** Manage AI system data throughout its lifecycle.

**Vorion Implementation:**
- **Retention Lifecycle** (`platform-core/src/persistence/`): Configurable retention policies per data type.
- **Database Schemas** (`security/src/db/schema/`): Structured schemas for merkle records, trust data, operations, and escalations with archive and purge capabilities.

### MG-8: Integrity Verification

**NIST Requirement:** Verify the integrity of AI system components and data.

**Vorion Implementation:**
- **Hash Chain Verification** (`security/src/proof/`): Dual-hash (SHA-256 + SHA3-256) chain integrity verification detects any tampering with the audit trail.
- **Merkle Proofs** (`security/src/proof/merkle.ts`): Efficient proof-of-inclusion for any record in the audit chain.
- **Ed25519 Signatures** (`security/src/`): Cryptographic signatures on critical governance decisions.

### MG-9: Human Override and Break-Glass

**NIST Requirement:** Humans should be able to override AI system decisions.

**Vorion Implementation:**
- **Human-in-the-Loop Escalation** (`a3i/src/gate/`): Pre-action gate escalates high-risk decisions to human operators.
- **Break-Glass Access** (`security/src/security/crypto/shamir/`): Shamir secret sharing enables emergency access that requires multiple authorized parties.
- **Trust Override** (`atsf-core/src/trust-engine/`): Administrative trust adjustments with full provenance logging.

---

## 6. Evidence and Auditability

Vorion provides three complementary evidence systems:

### 6.1 PROOF Chain

- **Technology:** SHA-256 + SHA3-256 dual-hash chain with optional Merkle tree aggregation
- **Package:** `security/src/proof/`
- **Capabilities:** Tamper-evident sequential records, batch verification via Merkle proofs, Ed25519 signatures
- **NIST Relevance:** Provides cryptographic evidence for all MEASURE and MANAGE functions

### 6.2 Audit Service

- **Technology:** Hash-chained relational records with structured event schema
- **Package:** `platform-core/src/audit/`
- **Capabilities:** Event correlation, compliance reporting, retention lifecycle management
- **NIST Relevance:** Implements documentation requirements across all four functions

### 6.3 Compliance Evidence Export

- **Technology:** Framework-specific evidence collection and report generation
- **Package:** `platform-core/src/security/compliance/`
- **Supported Frameworks:** NIST 800-53, SOC 2, PCI-DSS, GDPR
- **NIST Relevance:** Automates evidence gathering for external audits

---

## 7. Lessons Learned

### Design Decisions That Proved Valuable

1. **16-Factor Model Over Binary Trust:** Binary (trusted/untrusted) is insufficient for AI governance. The 16-factor model captures nuanced trust dimensions and enables graduated response.

2. **Immutable Identity (CAR ID):** Making agent identity immutable and cryptographically anchored prevents identity spoofing and ensures accountability traces are permanent.

3. **Observation-Bounded Trust Ceilings:** Trust should never exceed what the deployment environment can verify. Hardware attestation environments can achieve higher trust than behavioral-only monitoring.

4. **Policy-as-Code:** Governance rules expressed as code (not configuration) enables version control, testing, and automated compliance verification.

5. **Provenance-First Architecture:** Recording the "why" alongside the "what" for every decision creates an audit trail that supports both compliance and debugging.

### Known Limitations

- **No Production Data:** All performance metrics are development benchmarks. Production validation is pending.
- **Hardware Attestation:** TEE integration interfaces are defined but hardware-specific SDK integration is not yet complete.
- **Carbon-Aware Metrics:** Environmental impact tracking is planned but data source integration is pending.
- **External Blockchain Anchoring:** Database schema is ready but no blockchain integration has been implemented.

---

## 8. Control Mapping Summary

| # | Vorion Capability | NIST Subcategory | Package | Status |
|---|---|---|---|---|
| 1 | Policy Engine (OPA-style) | GV-1 | platform-core | Implemented |
| 2 | BASIS Rule Engine | GV-1 | basis | Implemented |
| 3 | Governance Authority | GV-1 | atsf-core | Implemented |
| 4 | Know Your Agent (KYA) | GV-2 | basis | Implemented |
| 5 | CAR Registry | GV-2 | car-spec | Implemented |
| 6 | Decision Provenance | GV-2 | atsf-core | Implemented |
| 7 | Bias Detection | GV-3 | platform-core | Implemented |
| 8 | Accountability Factor | GV-3 | basis | Implemented |
| 9 | 16-Factor Trust Model | GV-4 | basis | Implemented |
| 10 | Friction Feedback | GV-4 | platform-core | Implemented |
| 11 | Sandbox Training | GV-4 | atsf-core | Implemented |
| 12 | HITL Escalation | GV-5 | a3i | Implemented |
| 13 | Multi-Agent Arbitration | GV-5 | atsf-core | Implemented |
| 14 | Trust Oracle | GV-6 | platform-core | Implemented |
| 15 | A2A Trust Negotiation | GV-6 | atsf-core | Implemented |
| 16 | Trust Decay (182-day) | GV-7 | atsf-core | Implemented |
| 17 | Data Retention Lifecycle | GV-7 | platform-core | Implemented |
| 18 | Context Awareness Factor | MP-1 | basis | Implemented |
| 19 | Hierarchical Context (4-tier) | MP-1 | atsf-core | Implemented |
| 20 | Trust Tier System (T0-T7) | MP-2 | basis | Implemented |
| 21 | 0-1000 Trust Scoring Scale | MP-2 | basis | Implemented |
| 22 | Stewardship Factor | MP-3 | basis | Implemented |
| 23 | Capability Ceiling | MP-3 | atsf-core | Implemented |
| 24 | Risk Classifier | MP-4 | a3i | Implemented |
| 25 | Pre-Action Gate | MP-4 | a3i | Implemented |
| 26 | 8 Incident Playbooks | MP-5 | platform-core | Implemented |
| 27 | Progressive Containment | MP-5 | atsf-core | Implemented |
| 28 | Observation Tiers (4 levels) | MP-6 | a3i | Implemented |
| 29 | Trust Ceilings | MP-6 | a3i | Implemented |
| 30 | Validation Gate | MP-7 | basis | Implemented |
| 31 | Output Contracts | MP-7 | atsf-core | Implemented |
| 32 | Signal Recording | MP-8 | atsf-core | Implemented |
| 33 | Canary Probes | MP-8 | a3i | Implemented |
| 34 | Anomaly Detection | MP-8 | platform-core | Implemented |
| 35 | 16-Factor Measurement Criteria | MS-1 | basis | Implemented |
| 36 | Weighted Factor Scoring | MS-1 | atsf-core | Implemented |
| 37 | Trust Engine (0-1000 scale) | MS-2 | atsf-core | Implemented |
| 38 | Trust Banding with Hysteresis | MS-2 | a3i | Implemented |
| 39 | Decay Profiles (milestone) | MS-2 | atsf-core | Implemented |
| 40 | Recovery Mechanisms | MS-2 | atsf-core | Implemented |
| 41 | 4-Type Bias Detection | MS-3 | platform-core | Implemented |
| 42 | Configurable Factor Weights | MS-3 | basis | Implemented |
| 43 | Prompt Injection Defense | MS-4 | a3i | Implemented |
| 44 | FIPS Cryptography | MS-4 | security | Implemented |
| 45 | Circuit Breaker | MS-4 | platform-core | Implemented |
| 46 | Merkle Proofs | MS-4 | security | Implemented |
| 47 | Zero-Knowledge Proofs | MS-5 | security | Implemented |
| 48 | Shamir Secret Sharing | MS-5 | security | Implemented |
| 49 | Privacy Trust Factor | MS-5 | basis | Implemented |
| 50 | Reliability Factor | MS-6 | basis | Implemented |
| 51 | Input Validation (L0-L5) | MS-6 | atsf-core | Implemented |
| 52 | Decision Replay | MS-6 | platform-core | Implemented |
| 53 | Friction Feedback (explanations) | MS-7 | platform-core | Implemented |
| 54 | Decision Provenance Chain | MS-7 | atsf-core | Implemented |
| 55 | Risk Classification Reasoning | MS-7 | a3i | Implemented |
| 56 | Stewardship Factor | MS-8 | basis | Implemented |
| 57 | Alignment Factor | MS-8 | basis | Implemented |
| 58 | Pre-Action Gating | MG-1 | a3i | Implemented |
| 59 | Ceiling Enforcement (kernel) | MG-1 | atsf-core | Implemented |
| 60 | Progressive Containment | MG-1 | atsf-core | Implemented |
| 61 | 8-Tier Trust System | MG-2 | basis | Implemented |
| 62 | 35 Progressive Capabilities | MG-2 | basis | Implemented |
| 63 | 3-Layer Role Gates | MG-2 | atsf-core | Implemented |
| 64 | Dual-Hash Proof Chain | MG-3 | security | Implemented |
| 65 | Merkle Tree Aggregation | MG-3 | security | Implemented |
| 66 | Audit Service | MG-3 | platform-core | Implemented |
| 67 | SIEM Integration (4 providers) | MG-4 | platform-core | Implemented |
| 68 | Anomaly Detection | MG-4 | platform-core | Implemented |
| 69 | Multi-Channel Alerting | MG-4 | platform-core | Implemented |
| 70 | 8 Incident Response Playbooks | MG-5 | platform-core | Implemented |
| 71 | Proof Plane Events | MG-6 | a3i | Implemented |
| 72 | Trust Engine Events | MG-6 | atsf-core | Implemented |
| 73 | Compliance Evidence Export | MG-6 | platform-core | Implemented |
| 74 | Retention Lifecycle | MG-7 | platform-core | Implemented |
| 75 | Database Schema Management | MG-7 | security | Implemented |
| 76 | Hash Chain Verification | MG-8 | security | Implemented |
| 77 | Merkle Proof-of-Inclusion | MG-8 | security | Implemented |
| 78 | Ed25519 Signatures | MG-8 | security | Implemented |
| 79 | HITL Escalation (break-glass) | MG-9 | a3i | Implemented |
| 80 | Shamir Break-Glass Access | MG-9 | security | Implemented |
| 81 | Administrative Trust Override | MG-9 | atsf-core | Implemented |
| 82 | Hardware Attestation Interface | MP-6, MS-4 | a3i | In Development |
| 83 | Carbon-Aware Metrics | MS-8 | — | Planned |
| 84 | External Blockchain Anchoring | MG-8 | security | Planned |

---

## Appendix A: Methodology

This case study was produced by systematic code analysis of the Vorion monorepo. Each capability mapping references specific source files and packages. Implementation status reflects the state of code as of 2026-02-24.

- **Implemented**: Code exists, compiles, and passes tests
- **In Development**: Interfaces defined, partial implementation
- **Planned**: Architecture designed, no implementation yet

No production deployment data exists. All performance claims are based on development benchmarks and test results.
