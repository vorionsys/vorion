# Privacy Policy — PII Processing and Transparency

**Document ID:** VOR-POL-PT-001
**Version:** 1.0
**Effective Date:** February 19, 2026
**Last Reviewed:** February 19, 2026
**Owner:** Vorion, Chief Privacy Officer (CPO) / Data Protection Officer (DPO)
**Classification:** Public
**Applicable Controls:** PT-1, PT-4, PT-5, PT-7

---

## 1. Purpose and Scope

This policy establishes the privacy framework governing how Vorion Cognigate processes, stores, and protects personally identifiable information (PII) and other sensitive data. Cognigate is an AI Agent Governance Runtime that enforces the BASIS specification. It governs AI agent *actions* -- it does not process end-user data, serve as a consumer-facing application, or store application-layer payloads. This distinction is fundamental to understanding Cognigate's privacy posture.

This policy applies to:

- All data processed by the Cognigate Engine across the INTENT, ENFORCE, PROOF, and CHAIN pipeline layers
- All API surfaces: `/v1/intent`, `/v1/enforce`, `/v1/proof`, and `/v1/admin`
- All proof chain records stored in the PROOF plane
- Trust scores, entity metadata, and governance decision records
- All Vorion personnel, contractors, and third-party integrators who handle Cognigate data

This policy does **not** govern:

- End-user data processed by downstream AI agents governed by Cognigate (consumer organizations are responsible for their own end-user privacy obligations)
- Application-layer payloads that pass through AI agents under Cognigate governance (Cognigate governs the action, not the payload content)

---

## 2. PII Processing Policy (PT-1)

### 2.1 Privacy Policy and Procedures

Vorion establishes, maintains, and disseminates this privacy policy as part of the organizational privacy program. The CPO/DPO is the designated senior official responsible for:

- Developing and maintaining privacy policies, procedures, and guidance
- Ensuring privacy considerations are integrated into the Cognigate system design and operations
- Conducting privacy impact assessments for new features or data processing changes
- Coordinating with the CISO on privacy-related security controls
- Reviewing and updating this policy at least annually

### 2.2 Data Minimization Principle

Cognigate is designed around the principle of data minimization. The system collects and processes only the minimum data necessary to perform its governance function:

**Data Cognigate Processes:**

| Data Element | Purpose | PII Classification |
|---|---|---|
| `entity_id` | Unique identifier for each governed AI agent | Indirect identifier (correlatable, not directly PII) |
| Ed25519 public keys | Cryptographic identity verification | Not PII |
| Trust scores (0-1000) | Behavioral trust quantification | Behavioral profiling (addressed through transparency) |
| Trust tier (T0-T7) | Access level classification | Not PII |
| Action logs (intent, decision, proof) | Governance audit trail | May contain PII if agent actions reference PII (see Section 5) |
| Risk scores | Per-action risk quantification | Not PII |
| Velocity metrics | Rate limiting counters | Not PII |
| Circuit breaker state | System health monitoring | Not PII |
| Critic verdicts | Adversarial analysis results | Not PII |

**Data Cognigate Does Not Process:**

- Consumer end-user names, email addresses, physical addresses, or phone numbers
- Social Security numbers, government identifiers, or financial account numbers
- Health information, biometric data, or genetic information
- Consumer browsing history, purchase history, or behavioral tracking data
- Application-layer message content between AI agents and their end-users

### 2.3 Legal Basis for Processing

Cognigate's data processing is based on:

- **Legitimate interest:** Governance and safety enforcement for AI agent operations
- **Contractual obligation:** Consumer organizations register entities for governance monitoring as part of their service agreement with Vorion
- **Legal compliance:** Audit trail maintenance for regulatory compliance (NIST 800-53, FedRAMP, SOC 2)

---

## 3. Consent Mechanisms (PT-4)

### 3.1 Entity Registration Consent Model

Cognigate employs an operational consent model appropriate to its role as an infrastructure governance layer:

**Registration as Consent:**

When a consumer organization registers an AI agent entity with Cognigate, this constitutes informed consent for governance monitoring. The registration process discloses:

- All data elements that will be collected (entity_id, public keys, trust scores, action logs)
- The governance pipeline the entity will be subject to (INTENT, ENFORCE, PROOF, CHAIN)
- The retention periods applicable to governance records
- The trust tier model and how trust progression works

**Earned Consent Model for Trust Progression:**

Trust tier advancement is not granted by request -- it is earned through demonstrated compliance. This mechanism provides ongoing, behavioral consent:

- T0 Sandbox (0-199): Initial registration, maximum restrictions, entity operates in observation mode
- T1 Observed (200-349): Default registration tier; entity under active monitoring
- T2 Provisional (350-499): Requires demonstrated compliance with data protection policies
- T3 Monitored (500-649): Requires sustained clean behavioral record
- T4 Standard (650-799): Requires extended compliance history
- T5 Trusted (800-875): Requires elevated verification and auditable compliance history
- T6 Certified (876-950): Requires administrative approval and certification
- T7 Autonomous (951-1000): Maximum operational freedom within policy constraints

Each tier progression represents an earned expansion of operational scope, where the entity has demonstrated trustworthiness through its actions. Trust can be demoted: violations result in trust impact penalties (e.g., -50 for critical violations, -10 for high violations per the ENFORCE layer logic).

### 3.2 Opt-Out and Deregistration

Entities and their owning organizations may opt out of Cognigate governance through:

- **Entity deregistration:** The consumer organization may deregister an entity, which halts active governance monitoring for that entity
- **Proof chain retention:** Upon deregistration, governance records (proof chain entries) are retained for 7 years to satisfy regulatory audit requirements. This retention period cannot be shortened by opt-out, as it serves a legal compliance obligation
- **Data minimization upon deregistration:** Active velocity state, real-time trust scores, and cached policy results are purged upon deregistration. Only the immutable proof chain records are retained

### 3.3 Consumer Organization Responsibilities

Consumer organizations that integrate with Cognigate are responsible for:

- Obtaining any necessary end-user consent for their own applications
- Disclosing to their end-users that AI agent actions are subject to governance oversight
- Managing end-user data subject requests that pertain to their own application data (Cognigate does not hold end-user data)

---

## 4. Privacy Notices (PT-5)

### 4.1 Decision Transparency

Every governance decision made by Cognigate includes transparency information in the API response:

**INTENT Layer Response:**

- `status`: Whether the intent was normalized, blocked, or errored
- `plan.risk_score`: Quantified risk assessment
- `plan.risk_indicators`: Specific risk factors detected (e.g., `euphemism_attack`, `destructive_intent`, `dangerous_tools`)
- `plan.reasoning_trace`: Human-readable explanation of the analysis process
- `error`: If blocked, the specific reason (e.g., "TRIPWIRE: Recursive deletion of root filesystem detected")

**ENFORCE Layer Response:**

- `allowed`: Boolean permit/deny
- `action`: Specific verdict (allow, deny, escalate, modify)
- `violations`: Detailed list of policy violations, each including `policy_id`, `constraint_id`, `severity`, `message`, and `remediation`
- `rigor_mode`: The enforcement rigor applied (STRICT, STANDARD, LITE) and why
- `trust_impact`: How this decision affects the entity's trust score
- `requires_approval`: Whether human review is mandated

**PROOF Layer Response:**

- `proof_record`: The complete, signed proof record including SHA-256 hash chain linkage
- `signature`: Ed25519 signature for independent verification

This transparency ensures that governed entities and their operators can understand, challenge, and audit every governance decision.

### 4.2 API Documentation and Terms of Service

Privacy notices are incorporated into:

- **API documentation:** Full disclosure of all data elements collected, processed, and retained for each endpoint
- **Terms of Service:** Privacy obligations, data processing terms, and retention schedules
- **Developer documentation:** Integration guides that explain the governance data flow and privacy implications
- **OSCAL System Security Plan:** Machine-readable privacy control documentation (compliance/oscal/ssp-draft.json)

### 4.3 Data Retention Disclosures

| Data Category | Retention Period | Justification |
|---|---|---|
| Proof chain records | 7 years from creation | Regulatory audit compliance (NIST, FedRAMP, SOC 2) |
| Trust scores | Entity active lifetime + 1 year | Governance continuity and audit support |
| Velocity state (real-time) | Sliding window (up to 24 hours) | Operational rate limiting only |
| Circuit breaker metrics | 5-minute sliding window | Real-time system protection only |
| Circuit breaker trip history | System lifetime | Incident investigation and trend analysis |
| Cached policy results | TTL-based (configurable) | Performance optimization only |

### 4.4 Third-Party Data Sharing

Cognigate does **not** share entity data with external third parties. Specifically:

- No entity identifiers, trust scores, or action logs are transmitted to external services for marketing, analytics, or profiling purposes
- The Critic module sends anonymized plan summaries to AI provider APIs (Anthropic, OpenAI, Google, xAI) for adversarial analysis, but these summaries contain only the goal text, risk assessment, and tool requirements -- not entity identifiers or proof chain data
- OSCAL compliance artifacts may be shared with authorizing officials and assessment organizations as part of the security authorization process
- Consumer organizations receive governance decisions pertaining to their own registered entities only

---

## 5. Specific Categories of PII (PT-7)

### 5.1 PII Categories Present in Cognigate

Cognigate does not collect traditional categories of PII (names, addresses, government identifiers). However, the following data elements warrant privacy consideration:

**Entity Identifiers:**

- `entity_id` values are organization-assigned strings (e.g., `agent_001`) that are not directly PII
- However, if a consumer organization uses personally attributable identifiers as entity IDs, these become correlatable to individuals
- Vorion recommends that consumer organizations use opaque, non-personally-identifiable entity IDs
- Privacy impact: Low, mitigated by organizational guidance on identifier selection

**Public Keys:**

- Ed25519 public keys are cryptographic identifiers, not PII
- Public keys cannot be reversed to derive personal information
- Privacy impact: None

**Action Logs and Governance Records:**

- Intent requests contain a `goal` field (free-text natural language) that may reference PII if the AI agent's task involves PII processing
- Example: An agent submitting "Send email to john.doe@example.com" would cause the email address to appear in the intent log
- Cognigate governs the *action* (whether the email-sending action is permitted), not the *payload* (the email content)
- The proof chain preserves the governance decision record, which includes the action classification but not the full payload
- Data classifications detected by the intent analysis (e.g., `pii_email`, `pii_ssn`, `credentials`) are recorded as metadata tags, not the PII values themselves
- Privacy impact: Moderate for action logs; mitigated by data classification tagging and access controls

**Trust Scores and Behavioral Profiles:**

- Trust scores (0-1000) and trust tiers (T0-T7) represent behavioral profiling of AI agent entities
- These scores quantify compliance behavior, not human behavior
- However, if an entity is operated by or directly associated with an individual, trust scores could be interpreted as profiling that individual's operational patterns
- Privacy impact: Low to moderate; addressed through decision transparency (every trust impact is disclosed in ENFORCE responses)

### 5.2 PII Handling Procedures

When the Cognigate system detects PII-indicative data classifications in action logs:

1. The Policy Engine evaluates data protection constraints (e.g., `pii-requires-l2`: PII access requires T2 Provisional trust level or higher)
2. Elevated audit logging is triggered for actions involving PII-classified data
3. Access to proof chain records containing PII-adjacent data is restricted to authorized personnel
4. Credential-classified data triggers mandatory audit logging per the `credentials-audit` constraint

### 5.3 Sensitive PII Categories

Cognigate does not intentionally process sensitive PII categories including:

- Social Security numbers or government identifiers
- Financial account numbers
- Health or medical information
- Biometric or genetic data
- Information about minors

If sensitive PII appears in action logs due to AI agent operations, the data classification system flags it (e.g., `pii_ssn`), and the Policy Engine enforces elevated trust requirements and access controls.

---

## 6. Data Subject Rights

### 6.1 Applicability

Because Cognigate primarily processes AI agent entity data rather than end-user personal data, traditional data subject rights (access, rectification, erasure, portability) apply in a limited context:

**For Consumer Organizations (Data Controllers):**

- **Right of Access:** Consumer organizations may access all governance records pertaining to their registered entities via the `/v1/proof` API and admin endpoints
- **Right to Rectification:** Entity metadata (trust scores, tier assignments) can be corrected through administrative procedures when demonstrated to be inaccurate
- **Right to Erasure:** Active entity data can be deregistered and purged; proof chain records are retained for the regulatory retention period (7 years) under the legal compliance basis
- **Right to Data Portability:** Governance records can be exported in machine-readable format (JSON) via the proof chain API

**For Individuals (if entity_id is correlatable):**

- Individuals who believe their personal information appears in Cognigate action logs may submit data subject requests through their consumer organization
- Vorion will cooperate with consumer organizations to respond to valid data subject requests within 30 days

### 6.2 Request Processing

Data subject requests are processed through the following procedure:

1. Request received via security@vorion.org or through the consumer organization's designated privacy contact
2. Identity verification completed within 5 business days
3. Request scope assessed and applicable data identified within 10 business days
4. Response provided within 30 calendar days of verified request receipt
5. Request and response documented for accountability

---

## 7. Privacy Impact Assessment Summary

### 7.1 System Description

Cognigate is an AI Agent Governance Runtime that evaluates, constrains, and audits AI agent actions. It does not interact with end-users directly, does not process consumer data for commercial purposes, and does not perform automated individual decision-making that produces legal effects on natural persons.

### 7.2 Privacy Risk Assessment

| Risk | Likelihood | Impact | Mitigation | Residual Risk |
|---|---|---|---|---|
| PII in action logs | Medium | Low | Data classification tagging, access controls, data minimization guidance | Low |
| Entity ID correlation to individuals | Low | Low | Guidance to use opaque identifiers, access restrictions | Low |
| Trust score behavioral profiling | Low | Medium | Decision transparency in API responses, limited retention | Low |
| Proof chain retention vs. erasure requests | Medium | Low | Legal compliance basis for retention, data minimization at deregistration | Low |
| Critic module sending data to AI providers | Medium | Low | Anonymized summaries only, no entity IDs transmitted, provider DPAs | Low |

### 7.3 Privacy Enhancing Technologies

Cognigate incorporates the following privacy-enhancing measures:

- **Data minimization by design:** Only governance-relevant data is collected
- **Cryptographic integrity:** Ed25519 signatures ensure proof records are tamper-evident, protecting privacy audit trails
- **Transparency by design:** Every governance decision includes machine-readable explanation
- **Access control:** Admin endpoints require authenticated X-Admin-Key headers
- **Retention limits:** Active operational data (velocity state, cached results) has short-lived retention

---

## 8. Compliance Mapping

### 8.1 NIST 800-53 Rev 5 Controls

| Control | Implementation Status | Policy Section |
|---|---|---|
| **PT-1** Policy and Procedures | **Implemented** | Section 2 |
| **PT-4** Consent | **Implemented** | Section 3 |
| **PT-5** Privacy Notice | **Implemented** | Section 4 |
| **PT-7** Specific Categories of PII | **Implemented** | Section 5 |

### 8.2 International Privacy Framework Mapping

| Framework | Article/Requirement | Cognigate Implementation |
|---|---|---|
| **GDPR Art. 5** | Principles of processing | Data minimization (Sec 2.2), purpose limitation (governance only), storage limitation (Sec 4.3) |
| **GDPR Art. 6** | Lawfulness of processing | Legitimate interest and contractual basis (Sec 2.3) |
| **GDPR Art. 13/14** | Information to data subjects | Decision transparency in API responses (Sec 4.1) |
| **GDPR Art. 15-22** | Data subject rights | Access, rectification, erasure, portability procedures (Sec 6) |
| **GDPR Art. 25** | Data protection by design | Data minimization, transparency by design, cryptographic integrity (Sec 7.3) |
| **GDPR Art. 30** | Records of processing activities | Proof chain provides tamper-evident processing records |
| **GDPR Art. 32** | Security of processing | Ed25519 signatures, SHA-256 hash chain, access controls |
| **GDPR Art. 35** | Data protection impact assessment | Privacy impact assessment (Sec 7) |
| **PDPA (Singapore)** | Data Protection Obligations | Purpose limitation, notification, access and correction obligations addressed |
| **APPI (Japan)** | Purpose of Utilization | Purpose specification and limitation through governance-only data processing |
| **LGPD (Brazil)** | Legal Bases for Processing | Legitimate interest and contractual bases apply |
| **CCPA/CPRA (California)** | Consumer Rights | Access, deletion (subject to retention), and transparency rights addressed |
| **EU AI Act** | Art. 13 Transparency | Decision transparency in governance responses; Art. 15 accuracy through proof chain integrity |

---

## 9. Metrics and Performance Indicators

| Metric | Target | Frequency | Data Source |
|--------|--------|-----------|-------------|
| PII inventory accuracy rate (data elements correctly classified) | >= 95% | Quarterly | INTENT layer data classification tags (`pii_email`, `pii_ssn`, `credentials`), policy engine logs |
| Consent mechanism compliance rate (% entities registered with governance disclosure) | 100% | Monthly | Entity registry, registration API logs |
| Data minimization adherence (% proof records containing only governance-relevant data) | 100% | Quarterly | PROOF ledger audit, privacy impact assessment reviews |
| Privacy impact assessment completion rate (PIAs for new features) | 100% of qualifying features assessed before release | Quarterly | PIA register, CPO/DPO records |

Metrics are reported monthly to the ISSO and quarterly to the Authorizing Official as part of the continuous monitoring program (VOR-POL-CONMON-001).

---

## 10. Policy Review and Maintenance

This policy is reviewed and updated:

- At least annually by the CPO/DPO
- When new data processing activities are introduced to the Cognigate platform
- When privacy regulations change in jurisdictions where Vorion or its consumer organizations operate
- Following privacy incidents or data subject complaints that reveal policy gaps
- When new compliance framework requirements affect privacy obligations

**Approval:**

| Role | Name | Date |
|---|---|---|
| CPO/DPO | ___________________ | ________ |
| CISO | ___________________ | ________ |
| General Counsel | ___________________ | ________ |
