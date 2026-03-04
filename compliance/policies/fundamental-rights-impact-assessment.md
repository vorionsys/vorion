# Fundamental Rights Impact Assessment (FRIA) Template

**Document ID:** VOR-EUAI-FRIA-001
**Version:** 1.0.0
**Effective Date:** 2026-02-20
**Classification:** PUBLIC
**Owner:** Vorion -- Compliance Engineering
**Review Cadence:** Semi-annual (next review: 2026-08-20)
**Applicable Regulation:** Regulation (EU) 2024/1689, Article 27
**Satisfies:** EU AI Act Article 27 (Fundamental Rights Impact Assessment for High-Risk AI Systems)
**Product:** Vorion AI Governance Platform / Cognigate Enforcement Engine
**Standard:** BASIS v1.0 (Behavioral AI Safety Interoperability Standard)

---

## 1. Purpose and Scope

### 1.1 Purpose

Article 27 of the EU AI Act requires deployers of high-risk AI systems to carry out a fundamental rights impact assessment (FRIA) before putting the system into use. This document provides:

1. A structured FRIA methodology for AI systems governed by the Vorion AI Governance Platform
2. A reusable template with standardized sections for assessment execution
3. A scoring rubric for evaluating fundamental rights impact
4. Documentation of how Cognigate's INTENT analysis and ENFORCE policy enforcement mitigate fundamental rights risks

### 1.2 Scope

This FRIA template applies to AI systems that:

- Are classified as "high-risk" by Vorion's `AiActClassifier` (see `VOR-EUAI-CA-001`)
- Operate within or serve natural persons in the European Union or European Economic Area
- Are governed by the Cognigate enforcement engine's INTENT/ENFORCE/PROOF pipeline

### 1.3 Legal Basis

Article 27(1) of the EU AI Act requires that, before deploying a high-risk AI system referred to in Article 6(2), deployers that are bodies governed by public law, or are private entities providing public services, and deployers of high-risk AI systems referred to in points 5(b) and 5(c) of Annex III, shall perform an assessment of the impact on fundamental rights that the use of such system may produce.

This assessment must be performed before the high-risk AI system is put into use, and must be updated when the deployer considers that any of the relevant factors have changed.

### 1.4 Relationship to GDPR Data Protection Impact Assessment

The FRIA under Article 27 is complementary to, but distinct from, the Data Protection Impact Assessment (DPIA) required under GDPR Article 35. Where both assessments are required, Article 27(4) allows them to be conducted together, provided the FRIA includes the additional elements specified in Article 27(3). Vorion recommends conducting both assessments in parallel when the AI system processes personal data.

---

## 2. FRIA Methodology

### 2.1 Assessment Lifecycle

The FRIA follows a five-phase lifecycle:

```
Phase 1: SCOPE       --> Define the AI system and its deployment context
Phase 2: IDENTIFY    --> Identify fundamental rights at risk
Phase 3: ASSESS      --> Evaluate severity, likelihood, and scope of impact
Phase 4: MITIGATE    --> Define and implement mitigation measures
Phase 5: MONITOR     --> Establish ongoing monitoring and review
```

### 2.2 Assessment Triggers

A new or updated FRIA must be conducted when:

| Trigger | Basis | Vorion Detection Mechanism |
|---|---|---|
| Initial deployment of a high-risk AI system | Article 27(1) | `AiActClassifier` returns `classification: "high-risk"` |
| Material change to the AI system's intended purpose | Article 27(1) | Change in `GovernanceRegime.policyNamespaces` or `regimeId` |
| Change in the population affected | Article 27(1) | Change in `GovernanceRegime.jurisdictions` or deployer scope |
| Change in risk classification | Article 27(1) | `AiActClassifier` returns a different `highRiskCategory` |
| Incident or near-miss involving fundamental rights | Best practice | PROOF chain records with `decision: "denied"` or `decision: "escalated"` correlated with rights-relevant categories |
| Periodic review (minimum annual) | Best practice | Scheduled review per document cadence |

### 2.3 Roles and Responsibilities

| Role | Responsibility | Vorion Support |
|---|---|---|
| Deployer (AI System Operator) | Conducts the FRIA; documents findings; implements mitigations | Vorion provides FRIA template, risk classification data, and PROOF evidence |
| Provider (AI System Developer) | Supplies technical documentation per Article 11; supports deployer FRIA | Vorion generates technical documentation artifacts |
| Data Protection Officer (DPO) | Reviews FRIA for GDPR alignment; advises on data protection impacts | Vorion's GDPR module supports DPO activities |
| Affected Persons / Representatives | Consulted where practicable per Article 27(3)(e) | [PLANNED] Stakeholder consultation workflow |
| National Supervisory Authority | Receives FRIA results upon request per Article 27(5) | Vorion generates exportable FRIA reports |

---

## 3. FRIA Template

### Section A: System Description

**A.1 AI System Identification**

| Field | Value |
|---|---|
| System Name | [Name of the AI system] |
| System Version | [Version number] |
| Provider | [Name of the AI system provider] |
| Deployer | [Name of the deploying organization] |
| Vorion Entity ID | [Cognigate entity_id, e.g., `agent_001`] |
| Vorion Governance Regime | [Applicable `GovernanceRegime.regimeId`] |
| EU AI Act Classification | [Output of `AiActClassifier`: `classification` value] |
| High-Risk Category (Annex III) | [Output of `AiActClassifier`: `highRiskCategory` value] |
| Classification Confidence | [Output of `AiActClassifier`: `confidence` value] |
| Classification Reasoning | [Output of `AiActClassifier`: `reasoning` value] |
| Annex Reference | [Output of `AiActClassifier`: `annexReference` value] |

**A.2 Intended Purpose and Context of Use**

| Field | Description |
|---|---|
| Intended purpose | [Describe the AI system's intended purpose as documented in the technical documentation] |
| Context of use | [Describe the organizational and operational context] |
| Geographic scope | [EU/EEA member states where the system will be deployed] |
| Sector | [Applicable sector per Annex III] |
| Target population | [Describe the natural persons affected by the system] |
| Scale of deployment | [Estimated number of persons affected] |
| Decision types | [Types of decisions or outputs the system produces] |
| Degree of autonomy | [Level of autonomy; reference Vorion trust tier if applicable] |

**A.3 Data Processing**

| Field | Description |
|---|---|
| Personal data categories | [List categories from `StructuredPlan.data_classifications`] |
| Special category data (Art. 9 GDPR) | [Yes/No; if yes, specify categories] |
| Data sources | [Origins of input data] |
| Data subjects | [Categories of natural persons whose data is processed] |
| Cross-border data transfers | [Yes/No; if yes, reference `GovernanceRegime.dataResidency`] |
| Retention period | [Reference `GovernanceRegime.auditRetentionDays`] |

### Section B: Fundamental Rights at Risk

For each fundamental right listed below, assess whether the AI system may impact that right. Rights are drawn from the EU Charter of Fundamental Rights, the European Convention on Human Rights, and the specific rights enumerated in the EU AI Act recitals.

**B.1 Non-Discrimination (Charter Art. 21; ECHR Art. 14)**

| Assessment Element | Response |
|---|---|
| Does the system make or inform decisions about natural persons? | [Yes/No] |
| Could the system produce discriminatory outcomes based on protected characteristics (race, ethnicity, gender, age, disability, religion, sexual orientation, etc.)? | [Yes/No/Unknown] |
| Are training data or input data representative of the affected population? | [Yes/No/Unknown] |
| Has bias testing been conducted? | [Yes/No; describe methodology and results] |
| Are there proxy variables that could lead to indirect discrimination? | [Yes/No; identify] |
| Vorion mitigation: Does the Cognigate risk scoring flag discrimination-related indicators? | [Reference `risk_indicators` categories] |

**B.2 Privacy and Data Protection (Charter Art. 7-8; ECHR Art. 8; GDPR)**

| Assessment Element | Response |
|---|---|
| Does the system process personal data? | [Yes/No] |
| Is a DPIA required under GDPR Article 35? | [Yes/No] |
| Are data minimization principles applied? | [Yes/No; describe] |
| Is there a lawful basis for processing under GDPR Article 6? | [Specify] |
| Are data subject rights (access, erasure, portability) supported? | [Yes/No; describe] |
| Vorion mitigation: Does Cognigate's data classification system (`data_classifications`) identify PII categories? | [Reference StructuredPlan fields] |

**B.3 Freedom of Expression and Information (Charter Art. 11; ECHR Art. 10)**

| Assessment Element | Response |
|---|---|
| Could the system restrict or chill freedom of expression? | [Yes/No; describe] |
| Does the system filter, moderate, or rank content? | [Yes/No; describe] |
| Could the system produce a chilling effect on speech? | [Yes/No; describe] |
| Are content moderation decisions transparent and explainable? | [Yes/No; describe] |
| Vorion mitigation: Does the reasoning trace explain content-related decisions? | [Reference `reasoning_trace` in StructuredPlan] |

**B.4 Human Dignity (Charter Art. 1)**

| Assessment Element | Response |
|---|---|
| Could the system treat persons as mere objects of automated processing? | [Yes/No; describe] |
| Does the system enable meaningful human agency? | [Yes/No; describe] |
| Could the system produce dehumanizing outputs? | [Yes/No; describe] |
| Vorion mitigation: Does the trust tier system ensure human oversight proportional to risk? | [Reference trust tier and rigor mode] |

**B.5 Right to an Effective Remedy and Fair Trial (Charter Art. 47)**

| Assessment Element | Response |
|---|---|
| Does the system affect access to justice? | [Yes/No; describe] |
| Can affected persons challenge the system's decisions? | [Yes/No; describe mechanism] |
| Is the decision-making process sufficiently transparent to enable challenge? | [Yes/No; describe] |
| Vorion mitigation: Does the PROOF chain provide sufficient evidence for meaningful contestation? | [Reference PROOF record fields] |

**B.6 Right to Good Administration (Charter Art. 41)**

| Assessment Element | Response |
|---|---|
| Is the system used by or on behalf of a public authority? | [Yes/No] |
| Does the system give reasons for its decisions? | [Yes/No; describe] |
| Can affected persons access their file? | [Yes/No; describe] |
| Vorion mitigation: Does the ENFORCE verdict include violation details and remediation guidance? | [Reference EnforceResponse fields] |

**B.7 Workers' Rights (Charter Art. 31; Art. 27-28)**

| Assessment Element | Response |
|---|---|
| Is the system used in employment context (hiring, monitoring, evaluation, termination)? | [Yes/No] |
| Have workers or their representatives been consulted? | [Yes/No; describe] |
| Does the system respect working time, rest, and fair conditions? | [Yes/No; describe] |
| Vorion mitigation: Does the `AiActClassifier` flag employment-related high-risk categories? | [Reference `employment-worker-management` category] |

**B.8 Rights of the Child (Charter Art. 24)**

| Assessment Element | Response |
|---|---|
| Could the system affect children (persons under 18)? | [Yes/No] |
| Are there age-appropriate safeguards? | [Yes/No; describe] |
| Vorion mitigation: Does the `AiActClassifier` flag education-related high-risk categories? | [Reference `education-vocational` category] |

**B.9 Rights of Persons with Disabilities (Charter Art. 26; UN CRPD)**

| Assessment Element | Response |
|---|---|
| Is the system accessible to persons with disabilities? | [Yes/No; describe] |
| Could the system produce outcomes that disproportionately affect persons with disabilities? | [Yes/No; describe] |

### Section C: Risk Assessment and Scoring

**C.1 Impact Scoring Rubric**

For each fundamental right identified as at risk in Section B, assign scores using the following rubric:

**Severity of Impact:**

| Score | Level | Description |
|---|---|---|
| 1 | Negligible | Minor inconvenience; easily reversible; no lasting effect on the exercise of the right |
| 2 | Minor | Moderate inconvenience; reversible with effort; temporary restriction on the exercise of the right |
| 3 | Significant | Material impact on the exercise of the right; may require formal remedy to reverse |
| 4 | Severe | Substantial and potentially lasting impact on the exercise of the right; formal redress required |
| 5 | Critical | Fundamental denial or severe violation of the right; may be irreversible; existential impact on affected persons |

**Likelihood of Impact:**

| Score | Level | Description |
|---|---|---|
| 1 | Remote | Highly unlikely under normal or reasonably foreseeable conditions |
| 2 | Unlikely | Could occur in unusual circumstances but not under normal operation |
| 3 | Possible | Could occur under reasonably foreseeable conditions |
| 4 | Likely | Expected to occur for some proportion of affected persons |
| 5 | Almost Certain | Expected to occur for a significant proportion of affected persons |

**Scale of Impact:**

| Score | Level | Description |
|---|---|---|
| 1 | Individual | Affects isolated individuals (fewer than 10 persons) |
| 2 | Small Group | Affects a small group (10-100 persons) |
| 3 | Community | Affects a community or organizational unit (100-10,000 persons) |
| 4 | Population Segment | Affects a significant population segment (10,000-1,000,000 persons) |
| 5 | Societal | Affects society at large or a very large population (>1,000,000 persons) |

**C.2 Risk Score Calculation**

For each fundamental right at risk:

```
Right Risk Score = Severity x Likelihood x Scale
```

| Score Range | Risk Level | Required Action |
|---|---|---|
| 1-10 | Low | Document and monitor; voluntary mitigations |
| 11-30 | Medium | Implement specific mitigations; periodic review |
| 31-60 | High | Implement comprehensive mitigations; enhanced monitoring; consider deployment restrictions |
| 61-100 | Very High | Deploy only with robust mitigations and continuous monitoring; consider whether deployment is proportionate |
| >100 | Critical | Deployment should not proceed without fundamental redesign or scope restriction |

**C.3 Aggregate Assessment**

| Fundamental Right | Severity (1-5) | Likelihood (1-5) | Scale (1-5) | Risk Score | Risk Level | Mitigation Required |
|---|---|---|---|---|---|---|
| Non-discrimination | | | | | | |
| Privacy / data protection | | | | | | |
| Freedom of expression | | | | | | |
| Human dignity | | | | | | |
| Effective remedy | | | | | | |
| Good administration | | | | | | |
| Workers' rights | | | | | | |
| Rights of the child | | | | | | |
| Rights of persons with disabilities | | | | | | |

**Overall FRIA Risk Level:** [Determined by the highest individual right risk level]

### Section D: Mitigation Measures

**D.1 Technical Mitigations Provided by Cognigate**

The following mitigations are automatically applied by the Cognigate enforcement engine to all governed AI systems:

| Mitigation | Mechanism | Fundamental Rights Protected | Status |
|---|---|---|---|
| **Pre-execution risk analysis** | INTENT layer analyzes every goal before execution; `risk_score` (0.0-1.0) with per-category `risk_indicators` | All rights -- risk-proportionate governance | [IMPLEMENTED] |
| **Prohibited use detection** | `AiActClassifier` checks for Article 5 prohibited practices (social scoring, subliminal manipulation, mass surveillance, etc.) | Human dignity, non-discrimination, privacy | [IMPLEMENTED] |
| **High-risk category flagging** | `AiActClassifier` identifies 8 Annex III high-risk categories with confidence scoring | All rights relevant to the specific category | [IMPLEMENTED] |
| **Policy enforcement** | ENFORCE layer evaluates all applicable BASIS policies with severity-graded violations (critical/high/medium/low) | All rights -- policy-driven protection | [IMPLEMENTED] |
| **Proportional oversight** | Trust tier system (T0-T7) applies oversight inversely proportional to demonstrated trustworthiness; rigor modes (LITE/STANDARD/STRICT) | Human dignity, effective remedy, non-discrimination | [IMPLEMENTED] |
| **Human-in-the-loop gating** | `requires_approval` flag and `approval_timeout` in ENFORCE verdicts | All rights -- human oversight ensures accountability | [IMPLEMENTED] |
| **Circuit breaker halt** | Autonomous system halt on safety threshold violations (8 trip reasons) | All rights -- systemic safety protection | [IMPLEMENTED] |
| **Immutable audit trail** | PROOF chain with hash-chained records, input/output hashes, digital signatures | Effective remedy, good administration -- evidence for contestation | [IMPLEMENTED] |
| **Adversarial AI review** | Multi-provider AI critic evaluation for hidden risks, euphemisms, and unsafe combinations | All rights -- defense against evasion | [IMPLEMENTED] |
| **Tripwire detection** | 22+ deterministic patterns for known dangerous operations | Human dignity, privacy -- protection against overt attacks | [IMPLEMENTED] |
| **Trust revocation** | Trust scores can be reduced, immediately restricting capabilities | All rights -- rapid response to observed harm | [IMPLEMENTED] |
| **Data classification** | `data_classifications` in StructuredPlan identifies PII and sensitive data types | Privacy, data protection | [IMPLEMENTED] |

**D.2 Deployer-Specific Mitigations**

[To be completed by the deployer for each identified risk]

| Fundamental Right at Risk | Mitigation Measure | Owner | Implementation Date | Verification Method |
|---|---|---|---|---|
| [Right] | [Description of specific mitigation] | [Person/team responsible] | [Date] | [How effectiveness will be verified] |
| | | | | |
| | | | | |

**D.3 Residual Risk Assessment**

After mitigations are applied, reassess the risk level for each fundamental right:

| Fundamental Right | Pre-Mitigation Risk Score | Mitigations Applied | Post-Mitigation Risk Score | Residual Risk Level | Acceptable? |
|---|---|---|---|---|---|
| | | | | | [Yes/No] |
| | | | | | |

If any residual risk level remains "Very High" or "Critical," the deployer must document the justification for proceeding with deployment or implement additional mitigations before deployment.

### Section E: Monitoring Plan

**E.1 Ongoing Monitoring Requirements**

| Monitoring Activity | Frequency | Data Source | Responsible Party | Escalation Threshold |
|---|---|---|---|---|
| Review PROOF chain records for rights-relevant denials/escalations | Weekly | `ProofQuery` filtered by `decision: "denied"` or `"escalated"` | Deployer DPO / Compliance | >5 rights-relevant denials per week |
| Analyze `AiActClassifier` confidence trends | Monthly | Classification result metadata | Deployer AI Governance | Confidence dropping below 0.5 for known high-risk systems |
| Review circuit breaker trip events | Per occurrence | `CircuitTrip` records | Deployer Operations + Compliance | Any trip with `ENTITY_MISBEHAVIOR` or `CRITICAL_DRIFT` reason |
| Bias monitoring of system outputs | Quarterly | System output logs | Deployer AI Ethics | Statistical disparity >20% across protected characteristics |
| Affected person complaints / feedback | Ongoing | Complaint management system | Deployer DPO | Any complaint alleging fundamental rights impact |
| FRIA periodic review | Annual minimum | This document | Deployer Compliance | Any material change per Section 2.2 triggers |

**E.2 Incident Response for Fundamental Rights Impacts**

When a fundamental rights impact is identified or suspected:

1. **Immediate**: Assess whether the circuit breaker should be engaged (manual halt via `MANUAL_HALT` trip reason)
2. **Within 24 hours**: Document the incident in the PROOF chain; notify the deployer's DPO
3. **Within 72 hours**: Determine whether the incident constitutes a "serious incident" under Article 62 requiring notification to the market surveillance authority
4. **Within 7 days**: Update this FRIA with the incident details and revised risk scores
5. **Within 30 days**: Implement additional mitigations if required; verify effectiveness

---

## 4. How Cognigate Mitigates Fundamental Rights Risks

### 4.1 INTENT Layer: Pre-Execution Rights Protection

The INTENT layer provides first-line fundamental rights protection by analyzing every AI system request before execution:

- **Goal analysis**: The `IntentRequest` is processed into a `StructuredPlan` that exposes `tools_required`, `endpoints_required`, `data_classifications`, and `risk_indicators` -- making the AI system's intentions transparent before action is taken
- **Risk classification**: The `AiActClassifier` immediately identifies prohibited practices (Article 5 violations) and high-risk categories (Annex III), with specific keyword dictionaries for each category
- **Adversarial critique**: The AI critic (`INTENT.critic`) uses multi-provider LLM analysis to detect hidden risks, euphemisms, scope creep, and unsafe tool combinations that keyword-based analysis might miss

### 4.2 ENFORCE Layer: Policy-Based Rights Enforcement

The ENFORCE layer applies configurable policies that can encode fundamental rights protections:

- **Severity-graded enforcement**: Policy violations are classified as critical, high, medium, or low severity; critical violations always block execution
- **Proportional oversight**: The rigor mode (LITE/STANDARD/STRICT) is automatically selected based on trust tier, ensuring that lower-trust AI systems receive more thorough evaluation
- **Human gating**: The `requires_approval` mechanism ensures that high-risk decisions can be routed to human reviewers before execution
- **Intervention capability**: The circuit breaker provides autonomous system halt capability, and trust revocation provides graduated response

### 4.3 PROOF Layer: Evidence for Remedy and Accountability

The PROOF layer supports fundamental rights by ensuring that all governance decisions are recorded, verifiable, and available for contestation:

- **Immutable records**: Hash-chained proof records cannot be altered retroactively
- **Complete traceability**: Every record links to its originating intent and enforcement verdict
- **Queryable history**: The `ProofQuery` model enables retrieval of all decisions for a specific entity, time period, or decision type
- **Chain verification**: The `ProofVerification` model enables auditors to verify that the record chain has not been tampered with

---

## 5. Limitations and Disclaimers

- This FRIA template provides a structured methodology but does not constitute legal advice. Deployers must engage qualified legal counsel familiar with EU AI Act requirements and the specific fundamental rights implications of their AI system.
- Vorion's `AiActClassifier` performs keyword-based risk classification. While it covers the primary prohibited practices and Annex III categories, it may not detect all possible fundamental rights impacts. Deployers must exercise independent judgment.
- The scoring rubric in Section C provides a quantitative framework for risk assessment but does not replace qualitative expert analysis of fundamental rights impacts.
- Vorion does not have visibility into the internal workings of the AI systems it governs. The FRIA must be informed by the provider's technical documentation and the deployer's operational knowledge.

---

## 6. Document History

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0.0 | 2026-02-20 | Vorion Compliance Engineering | Initial release |

---

## 7. References

- Regulation (EU) 2024/1689, Article 27 (Fundamental Rights Impact Assessment): https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689
- Charter of Fundamental Rights of the European Union (2012/C 326/02)
- European Convention on Human Rights (ECHR)
- Regulation (EU) 2016/679 (General Data Protection Regulation), Article 35 (DPIA)
- Vorion Conformity Assessment Procedure: `VOR-EUAI-CA-001`
- AI Act Classifier Implementation: `packages/platform-core/src/intent-gateway/ai-act-classifier.ts`
- PROOF Model: `cognigate/app/models/proof.py`
- ENFORCE Model: `cognigate/app/models/enforce.py`
- INTENT Model: `cognigate/app/models/intent.py`
- Trust Level Definitions: `cognigate/app/models/common.py`

---

*Document generated: 2026-02-20*
*Next review: 2026-08-20*
