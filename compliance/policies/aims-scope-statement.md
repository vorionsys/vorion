# AIMS Scope Statement

**Document ID:** VOR-AIMS-SCP-001
**Version:** 1.0.0
**Effective Date:** 2026-02-20
**Classification:** INTERNAL -- CONTROLLED
**Last Updated:** 2026-02-20
**Owner:** AIMS Manager, Vorion
**Approved By:** [PENDING -- Executive Sponsor]
**Review Cadence:** Annual (next review: 2027-02-20)
**Satisfies:** ISO/IEC 42001:2023 Clause 4.3

---

## 1. Purpose

This document defines the scope, boundaries, and applicability of the AI Management System (AIMS) operated by Vorion. It establishes which AI systems, processes, organizational units, physical locations, and information assets fall within the AIMS boundary, and documents any exclusions with justification.

This scope statement fulfills the requirements of ISO/IEC 42001:2023 Clause 4.3 ("Determining the scope of the AI management system") and is a mandatory input to ISO 42001 certification.

---

## 2. Organization Context (Clause 4.1 Reference)

### 2.1 Organization Profile

| Attribute | Detail |
|---|---|
| **Legal Entity** | Vorion |
| **Product** | Vorion AI Governance Platform |
| **Primary Function** | AI governance infrastructure for autonomous agent systems |
| **Industry** | AI Safety and Governance Technology |
| **Headquarters** | United States |
| **Employees in Scope** | All personnel with roles in AI system development, operation, or governance |

### 2.2 External Issues Relevant to the AIMS

| External Issue | Relevance to AIMS |
|---|---|
| EU AI Act enforcement timelines | Drives compliance evidence requirements for customers operating in EU jurisdictions |
| NIST AI Risk Management Framework adoption | Shapes risk assessment methodology and reporting requirements |
| Rapid growth in autonomous AI agent deployments | Increases volume and complexity of governance decisions processed by Cognigate |
| Evolving AI safety research and best practices | Requires ongoing review of trust tier thresholds and policy rules |
| Customer regulatory obligations (FedRAMP, SOC 2, CMMC) | Mandates evidence generation and retention capabilities |
| AI incident and liability case law developments | Informs risk treatment strategies and escalation thresholds |

### 2.3 Internal Issues Relevant to the AIMS

| Internal Issue | Relevance to AIMS |
|---|---|
| Cognigate platform maturity and feature velocity | Change management procedures must accommodate rapid development cycles |
| Team size and role specialization | Competency requirements must be realistic for current organizational capacity |
| BASIS specification evolution | Standard updates require systematic change management across the platform |
| Multi-framework compliance obligations | Evidence generation must serve ISO 42001, NIST 800-53, EU AI Act, SOC 2, CMMC, GDPR, and NIST AI RMF simultaneously |
| Infrastructure dependencies (Vercel, Neon PostgreSQL) | Third-party service governance must be incorporated |

---

## 3. Interested Parties (Clause 4.2 Reference)

### 3.1 Interested Parties Register

| Interested Party | Needs and Expectations | Relevant AIMS Requirements |
|---|---|---|
| **Customers (AI system operators)** | Reliable governance enforcement; compliance evidence; low-latency decisions; transparent audit trails | Clauses 8.1, 9.1, Annex A.5, A.8 |
| **End users affected by AI decisions** | Fair, transparent, and accountable AI governance; human oversight availability | Annex A.8.3, A.8.4, B.4.6 |
| **Regulatory bodies** | Demonstrable compliance with AI governance standards; audit-ready evidence | Clauses 9.2, 9.3, Annex A.7 |
| **Certification body (ISO 42001 auditor)** | Complete AIMS documentation; objective evidence of control effectiveness | All clauses |
| **Vorion management** | Effective risk management; operational efficiency; market differentiation | Clauses 5.1, 9.3 |
| **Development and engineering team** | Clear competency requirements; defined change procedures; workable governance processes | Clauses 7.2, 7.3, 8.1 |
| **Infrastructure providers (Vercel, Neon)** | Service-level commitments; security requirements; data handling expectations | Clause 8.1.4, Annex A.9.2 |
| **Industry standards bodies (ISO, NIST)** | Faithful implementation of standards; feedback on standard applicability | Clause 10.1 |

---

## 4. AIMS Scope Definition

### 4.1 Scope Statement

The AIMS of Vorion encompasses the **development, provision, and operation** of the Vorion AI Governance Platform, including the Cognigate enforcement engine and all supporting components that enable AI agent governance through the BASIS (Behavioral Agent Standard for Integrity and Safety) specification.

Specifically, the AIMS covers:

1. **The design, development, deployment, and continuous operation** of the Cognigate governance runtime
2. **All AI-assisted decision-making components** within the platform, including the Critic adversarial evaluation module
3. **The full INTENT, ENFORCE, PROOF governance pipeline** and the 8-tier trust model (T0-T7)
4. **Evidence generation, retention, and export capabilities** for multi-framework compliance
5. **Organizational processes** for AI risk management, change management, competency management, and management review as they relate to the platform

### 4.2 AI Systems in Scope

| AI System / Component | Description | AI Functionality | Risk Classification |
|---|---|---|---|
| **Cognigate Engine** | FastAPI/Python governance runtime deployed on Vercel | Policy enforcement decisions (allow/deny/escalate/modify) based on trust scoring and constraint evaluation | High -- controls access decisions for autonomous AI agents |
| **INTENT Processor** | Goal normalization and risk assessment layer | Parses natural-language agent goals into structured plans; identifies tools, endpoints, and data classifications; calculates risk scores | High -- risk scoring accuracy directly affects governance outcomes |
| **ENFORCE Policy Engine** | Constraint validation and gating layer (`app/core/policy_engine.py`) | Evaluates structured plans against BASIS policy rules; renders verdicts with violation details and trust impact | High -- primary enforcement control for all agent actions |
| **Trust Engine** | 8-tier trust scoring system (T0-T7, scores 0-1000) | Maintains and adjusts entity trust scores based on behavioral history; determines capability boundaries per tier | High -- trust miscalculation could grant excessive or insufficient privileges |
| **Critic Module** | Adversarial AI-vs-AI evaluation (`app/core/critic.py`) | Uses LLM-based adversarial review to identify hidden risks, euphemisms, unsafe tool combinations, and escalation triggers that the Planner may have missed | High -- independent verification of governance decisions |
| **PROOF Ledger** | Cryptographic audit chain (`app/db/proof_repository.py`) | Hash-linked, append-only proof records with chain integrity verification | Medium -- data integrity, not decision-making |
| **Evidence Mapper** | Automated compliance evidence generation (`app/core/evidence_mapper.py`) | Maps proof events to control evidence across seven governance frameworks | Medium -- evidence accuracy affects compliance posture |
| **Circuit Breaker** | System-level safety halt mechanism (`app/core/circuit_breaker.py`) | Automated safety shutoff when anomalous patterns are detected | High -- safety-critical control |
| **Tripwire System** | Deterministic security pattern matching (`app/core/tripwires.py`) | Pattern-based detection of known dangerous behaviors | High -- intrusion detection for AI actions |
| **Velocity Monitor** | Rate limiting and anomaly detection (`app/core/velocity.py`) | Detects and enforces rate-based behavioral constraints | Medium -- abuse prevention |

### 4.3 AI Lifecycle Phases Covered

The AIMS covers the following AI system lifecycle phases as defined in ISO 42001 Annex A.5:

| Lifecycle Phase | Coverage | AIMS Activities |
|---|---|---|
| **A.5.2 Planning** | [IMPLEMENTED] | INTENT normalization; risk scoring; structured plan generation |
| **A.5.3 Design and Development** | [IMPLEMENTED] | Constraint design; policy rule authoring; trust tier calibration |
| **A.5.4 Verification and Validation** | [IMPLEMENTED] | Critic adversarial evaluation; automated testing; chain integrity verification |
| **A.5.5 Deployment** | [IMPLEMENTED] | Vercel deployment governance; configuration management; rollback procedures |
| **A.5.6 Operation and Monitoring** | [IMPLEMENTED] | Real-time enforcement; trust score monitoring; dashboard metrics; alerting |
| **A.5.7 Retirement** | [IMPLEMENTED] | Entity expiration; evidence retention; proof chain archival |

---

## 5. Organizational Boundaries

### 5.1 Organizational Units in Scope

| Organizational Unit | Role in AIMS |
|---|---|
| **Executive Leadership** | AIMS sponsorship; management review; resource allocation; AI policy approval |
| **Engineering / Platform Development** | Cognigate development, testing, deployment; change implementation |
| **Security Engineering** | Security controls; incident response; vulnerability management; Critic module oversight |
| **AI Safety / Governance** | AIMS management; risk assessment; competency management; compliance coordination |
| **Operations** | Platform monitoring; incident triage; availability management |

### 5.2 Organizational Units Excluded

| Unit | Justification |
|---|---|
| Sales and Marketing | No direct involvement in AI system development, provision, or operation. Marketing materials referencing AI capabilities are reviewed by AI Governance before publication. |
| Finance and Accounting | No interaction with AI systems. Financial reporting on AIMS resource allocation is captured through management review. |

---

## 6. Physical and Logical Boundaries

### 6.1 Logical Boundaries

| Boundary | Description |
|---|---|
| **Production Environment** | Cognigate production deployment at `cognigate.dev` on Vercel serverless infrastructure |
| **Database Layer** | Neon PostgreSQL hosting proof chain, evidence records, trust state, and entity registrations |
| **Development Environment** | Local development and staging environments used for Cognigate development and testing |
| **Source Code Repository** | Git repositories containing Cognigate source code, configuration, and policy definitions |
| **CI/CD Pipeline** | Automated build, test, and deployment pipeline |
| **Monitoring and Alerting** | Dashboard and alerting infrastructure for operational and compliance monitoring |

### 6.2 Network Boundaries

| Boundary | In Scope | Out of Scope |
|---|---|---|
| Cognigate API endpoints (`/v1/intent`, `/v1/enforce`, `/v1/proof`, `/v1/critic`) | Yes | -- |
| Admin API endpoints (`/admin/*`) | Yes | -- |
| Compliance API endpoints (`/v1/compliance/*`) | Yes | -- |
| Health and reference endpoints (`/health`, `/v1/reference/*`) | Yes | -- |
| Customer application code calling Cognigate APIs | -- | Yes (customer responsibility) |
| Upstream LLM providers used by Critic module | Partially -- API integration and data handling are in scope; provider internal operations are not | -- |

### 6.3 Physical Boundaries

Cognigate is a cloud-native application with no on-premises infrastructure. Physical boundaries are defined by the cloud service providers:

| Provider | Service | Scope Consideration |
|---|---|---|
| **Vercel** | Serverless compute, CDN, edge network | Platform availability and deployment configuration are in scope; Vercel's internal infrastructure security is governed by Vercel's own certifications |
| **Neon** | PostgreSQL database hosting | Database configuration, access controls, and data retention are in scope; Neon's infrastructure security is governed by Neon's own certifications |
| **LLM Providers** (Anthropic, OpenAI, Google, xAI) | AI model inference for Critic module | API integration security, data sent to providers, and response handling are in scope; provider model training and internal operations are not |

---

## 7. Exclusions

| Exclusion | Clause/Control | Justification |
|---|---|---|
| Customer-side AI systems governed by Cognigate | A.5.3 (customer development) | Vorion provides the governance platform; customers are responsible for their own AI system development practices. Cognigate enforces policy at the API boundary. |
| Physical security controls | A.10.2 (physical aspects) | Cloud-native architecture has no owned physical infrastructure. Physical security is delegated to cloud service providers (Vercel, Neon) under their respective certifications. |
| Environmental impact assessment | B.3.5 | [PLANNED] Environmental considerations for AI compute are acknowledged but not yet formally assessed. This will be addressed in a future revision as industry methodologies for AI environmental impact mature. |

---

## 8. Interfaces with Other Management Systems

| Management System | Interface |
|---|---|
| NIST SP 800-53 Rev 5 compliance program | Shared evidence generation through the PROOF ledger and Evidence Mapper; shared access control and incident response policies |
| SOC 2 Type II program | Shared control evidence; shared monitoring and audit infrastructure |
| NIST AI RMF alignment | Risk assessment methodology alignment; shared GOVERN/MAP/MEASURE/MANAGE evidence |
| EU AI Act compliance | Shared risk management system evidence; shared transparency and human oversight controls |

---

## 9. Scope Review and Maintenance

This scope statement shall be reviewed:

- **Annually** as part of the scheduled management review cycle (Clause 9.3)
- **Upon significant change** to the AI systems in scope, organizational structure, or external regulatory environment
- **Following any internal or external audit finding** that identifies scope inadequacy

Changes to the AIMS scope require approval from the AIMS Manager and Executive Sponsor, and must be documented as a controlled change per the AIMS Change Management Procedure (VOR-AIMS-CHG-001).

---

## 10. Document Control

| Version | Date | Author | Change Description |
|---|---|---|---|
| 1.0.0 | 2026-02-20 | AIMS Manager | Initial release -- addresses Gap GAP_002 from ISO 42001 Gap Analysis |

---

**Prepared by:** AIMS Manager, Vorion
**Reviewed by:** [PENDING -- CTO Review]
**Approved by:** [PENDING -- Executive Sponsor Approval]
