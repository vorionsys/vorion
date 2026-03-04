# EU AI Act Technical Documentation Template (Article 11 / Annex IV)

**Document ID:** VOR-EUAI-TD-001
**Version:** 1.0.0
**Effective Date:** 2026-02-20
**Classification:** PUBLIC
**Owner:** Vorion -- Compliance Engineering
**Review Cadence:** Semi-annual (next review: 2026-08-20)
**Applicable Regulation:** Regulation (EU) 2024/1689, Article 11, Annex IV
**Satisfies:** EU AI Act Article 11 (Technical Documentation), Annex IV (Technical Documentation for High-Risk AI Systems)
**Product:** Vorion AI Governance Platform / Cognigate Enforcement Engine
**Standard:** BASIS v1.0 (Behavioral AI Safety Interoperability Standard)

---

## 1. Purpose and Scope

### 1.1 Purpose

Article 11(1) of the EU AI Act requires that the technical documentation of a high-risk AI system be drawn up before that system is placed on the market or put into service, and shall be kept up to date. This document provides:

1. A comprehensive template following the Annex IV structure for technical documentation of high-risk AI systems governed by the Vorion platform
2. Documentation of how Vorion automatically generates and maintains technical documentation artifacts through the PROOF chain
3. Guidance for providers and deployers on completing the template for their specific AI systems

### 1.2 Scope

This template applies to all AI systems that:

- Are classified as "high-risk" by Vorion's `AiActClassifier`
- Require technical documentation under Article 11
- Are governed by the Cognigate enforcement engine

### 1.3 Documentation Obligations

Article 11(1) requires that technical documentation shall contain, at a minimum, the information set out in Annex IV, as applicable to the relevant AI system. The documentation must be drawn up in such a way as to demonstrate that the AI system complies with the requirements set out in Chapter III, Section 2, and provide national competent authorities and notified bodies with the necessary information in a clear and comprehensive form.

Article 11(2) requires that where a high-risk AI system related to a product covered by Union harmonisation legislation listed in Section A of Annex I is placed on the market or put into service, a single set of technical documentation shall be drawn up containing all the information set out in Annex IV as well as the information required under those Union harmonisation acts.

---

## 2. Template: General Description of the AI System (Annex IV, Section 1)

### 2.1 System Identification

| Field | Value |
|---|---|
| AI system name | [Full name of the AI system] |
| Version / release identifier | [Version number] |
| Provider name and contact | [Legal name, address, contact] |
| Authorized representative (if applicable) | [Name and contact of EU representative per Article 22] |
| Date of first placing on market / putting into service | [Date] |
| EU AI Act risk classification | [Output of AiActClassifier: classification] |
| High-risk category (Annex III reference) | [Output of AiActClassifier: highRiskCategory] |
| Vorion entity ID | [Cognigate entity_id] |
| Vorion governance regime | [GovernanceRegime.regimeId] |

### 2.2 Intended Purpose (Annex IV, 1(a))

| Field | Description |
|---|---|
| Intended purpose | [Describe the specific purpose for which the AI system is intended to be used] |
| Intended users | [Categories of natural or legal persons intended to use the system] |
| Intended deployment context | [Organizational, sectoral, and geographic context] |
| Foreseeable use beyond intended purpose | [Describe any reasonably foreseeable use that deviates from intended purpose] |
| Prohibited uses | [Explicitly state uses that are not permitted, referencing Article 5 where applicable] |

**Vorion auto-generated artifacts:**
- `StructuredPlan.goal`: Captures the interpreted purpose per request [IMPLEMENTED]
- `GovernanceRegime.policyNamespaces`: Defines the policy context for the system [IMPLEMENTED]
- `AiActClassificationResult.obligations`: Lists regulatory obligations triggered by classification [IMPLEMENTED]

### 2.3 Interaction with Hardware and Software (Annex IV, 1(b))

| Field | Description |
|---|---|
| Hardware requirements | [Minimum and recommended hardware specifications] |
| Operating system requirements | [Supported operating systems and versions] |
| Software dependencies | [List all software dependencies, libraries, and frameworks] |
| Network requirements | [Network connectivity, bandwidth, latency requirements] |
| Integration interfaces | [APIs, protocols, data formats used for integration] |
| Third-party AI services used | [List any third-party AI models or services consumed] |

**Vorion auto-generated artifacts:**
- `StructuredPlan.tools_required`: Lists tools and APIs the system requires [IMPLEMENTED]
- `StructuredPlan.endpoints_required`: Lists external endpoints accessed [IMPLEMENTED]
- `GovernanceRegime.externalServicesAllowed`: Indicates whether external service integration is permitted [IMPLEMENTED]

### 2.4 Software Versions (Annex IV, 1(c))

| Field | Description |
|---|---|
| AI system software version | [Current version number] |
| AI model version(s) | [Version numbers of underlying AI models] |
| Framework versions | [ML framework versions, e.g., PyTorch, TensorFlow] |
| Runtime versions | [Runtime environment versions] |
| Vorion/Cognigate version | [Version of the governing Cognigate engine] |

**Vorion auto-generated artifacts:**
- Control registry `metadata.product_version`: Tracks Cognigate engine version (currently `0.2.0`) [IMPLEMENTED]
- `BaseResponse.version`: API version included in every response [IMPLEMENTED]

### 2.5 Forms of Deployment (Annex IV, 1(d))

| Field | Description |
|---|---|
| Deployment model | [Cloud SaaS, on-premises, hybrid, edge, embedded] |
| Cloud provider(s) | [Name and region of cloud providers] |
| Data residency | [Where data is stored and processed] |
| Availability architecture | [Redundancy, failover, disaster recovery] |
| Scaling characteristics | [Auto-scaling behavior, capacity limits] |

**Vorion auto-generated artifacts:**
- `GovernanceRegime.dataResidency`: Specifies required data residency [IMPLEMENTED]
- `GovernanceRegime.jurisdictions`: Lists applicable jurisdictions [IMPLEMENTED]

### 2.6 User Instructions (Annex IV, 1(e))

| Field | Description |
|---|---|
| Instructions for use | [Reference to user documentation] |
| Installation guide | [Reference to installation documentation] |
| Configuration guide | [Reference to configuration documentation] |
| Interpretation of outputs | [How to interpret the AI system's outputs] |
| Limitations and known issues | [Known limitations, failure modes, boundary conditions] |

---

## 3. Template: Development Process (Annex IV, Section 2)

### 3.1 Design Specifications (Annex IV, 2(a))

| Field | Description |
|---|---|
| System architecture description | [High-level architecture diagram and description] |
| AI model architecture | [Type of model (e.g., transformer, CNN), layer structure, parameter count] |
| Design principles | [Safety-by-design, privacy-by-design, human-centric design principles applied] |
| Design choices and trade-offs | [Key architectural decisions and their rationale] |

**Vorion context:** Vorion's own architecture follows the BASIS spec with three layers:

- **INTENT**: Goal normalization, risk analysis, AI critic evaluation, EU AI Act classification
- **ENFORCE**: Policy evaluation, circuit breaker, velocity caps, trust-tier enforcement, rigor modes
- **PROOF**: Immutable hash-chained audit records with SHA-256 integrity and optional digital signatures

### 3.2 Design Choices and Rationale (Annex IV, 2(b))

[Document key design decisions that affect the system's risk profile, accuracy, robustness, and cybersecurity. Include rationale for each decision.]

| Design Choice | Rationale | Alternatives Considered | Risk Implications |
|---|---|---|---|
| [Choice 1] | [Why this approach was selected] | [Alternatives evaluated] | [How this affects the risk profile] |
| [Choice 2] | | | |

### 3.3 System Architecture (Annex IV, 2(c))

[Provide a detailed architecture description including:]

- System component diagram
- Data flow diagram
- Control flow diagram
- Security boundary diagram
- Integration point documentation

**Vorion auto-generated artifacts:**
- `StructuredPlan`: Documents the system's planned execution path including tools, endpoints, data types, and risk scores [IMPLEMENTED]
- PROOF chain: Records the actual execution path with all decisions [IMPLEMENTED]

### 3.4 Computational Resources (Annex IV, 2(d))

| Resource | Description |
|---|---|
| Training compute | [Total compute used for training, measured in FLOP if applicable] |
| Inference compute | [Compute requirements per inference] |
| Memory requirements | [RAM, GPU memory, storage requirements] |
| Energy consumption | [Estimated energy consumption, if measurable] |

**Note:** For GPAI models, if training compute exceeds 10^25 FLOP, Article 55 systemic risk obligations apply. The `AiActClassifier` flags GPAI models and includes this obligation in the `obligations` array.

### 3.5 Data Requirements (Annex IV, 2(e))

| Field | Description |
|---|---|
| Training data description | [Description of training datasets, including size, sources, and characteristics] |
| Training data collection methodology | [How training data was collected, curated, and annotated] |
| Training data representativeness | [Assessment of whether training data is representative of the deployment population] |
| Validation data description | [Description of validation datasets] |
| Testing data description | [Description of testing datasets] |
| Data quality measures | [Measures taken to ensure data quality, accuracy, and completeness] |
| Data bias assessment | [Assessment of potential biases in training, validation, and testing data] |

**Vorion auto-generated artifacts:**
- `StructuredPlan.data_classifications`: Identifies data types involved in each request [IMPLEMENTED]
- Control registry maps to EU AI Act Article 10 (Data and Data Governance) [IMPLEMENTED]

### 3.6 Training, Validation, and Testing (Annex IV, 2(f))

| Field | Description |
|---|---|
| Training methodology | [Description of training approach, hyperparameters, optimization] |
| Validation methodology | [Description of validation approach, metrics, acceptance criteria] |
| Testing methodology | [Description of testing approach, test cases, coverage] |
| Performance metrics | [Metrics used to evaluate the system (accuracy, precision, recall, F1, etc.)] |
| Performance results | [Actual performance results on test data] |
| Testing for bias and fairness | [Methodology and results of bias testing] |
| Robustness testing | [Methodology and results of robustness and adversarial testing] |

---

## 4. Template: Monitoring, Functioning, and Control (Annex IV, Section 3)

### 4.1 System Monitoring Capabilities

| Capability | Description | Vorion Implementation | Status |
|---|---|---|---|
| Performance monitoring | Continuous monitoring of system accuracy and reliability | PROOF chain analytics; ProofStats aggregation | [IMPLEMENTED] |
| Drift detection | Detection of changes in data distribution or model behavior | [PLANNED] Dedicated drift detection module | [PLANNED] |
| Anomaly detection | Detection of unusual system behavior | Circuit breaker metrics (`CircuitMetrics`): tracks high-risk ratio, injection attempts, tripwire triggers | [IMPLEMENTED] |
| Error monitoring | Detection and logging of system errors and failures | PROOF records with `decision: "denied"` or `"escalated"` | [IMPLEMENTED] |
| Usage monitoring | Tracking of system usage patterns | Velocity tracking (`ENFORCE.velocity`); entity-level request history | [IMPLEMENTED] |

### 4.2 System Functioning

| Field | Description |
|---|---|
| Input specifications | [Define valid input formats, ranges, and constraints] |
| Output specifications | [Define output formats, ranges, and confidence thresholds] |
| Failure modes | [Document known failure modes and their consequences] |
| Fallback behavior | [Describe what happens when the system cannot produce a reliable output] |
| Degraded operation | [Describe behavior under degraded conditions] |

**Vorion context:**

Cognigate's input validation is enforced by Pydantic models:
- `IntentRequest.goal`: String, 1-4096 characters [IMPLEMENTED]
- `IntentRequest.entity_id`: Required EntityId [IMPLEMENTED]
- `EnforceRequest.trust_score`: Integer, 0-1000 [IMPLEMENTED]
- `EnforceRequest.trust_level`: Literal 0-7 [IMPLEMENTED]

Failure modes are handled by the circuit breaker's three-state model:
- **CLOSED**: Normal operation
- **OPEN**: System halted, all requests blocked
- **HALF_OPEN**: Testing recovery, limited requests allowed

### 4.3 Human Oversight and Control Measures

| Measure | Description | Vorion Implementation | Status |
|---|---|---|---|
| Human-in-the-loop | Human reviews and approves decisions before execution | `EnforceResponse.requires_approval` with configurable `approval_timeout` | [IMPLEMENTED] |
| Human-on-the-loop | Human monitors automated decisions with intervention capability | Trust tier system with observation tiers (T0-T2: STRICT rigor) | [IMPLEMENTED] |
| Human-in-command | Human can override, interrupt, or halt the system at any time | Circuit breaker `MANUAL_HALT`; trust revocation; admin API endpoints | [IMPLEMENTED] |
| Override capability | Authorized humans can override system decisions | Trust score overrides; admin key authentication | [IMPLEMENTED] |
| System shutdown | Capability to shut down the system completely | Circuit breaker OPEN state; all requests blocked | [IMPLEMENTED] |

---

## 5. Template: Risk Management System (Annex IV, Section 4)

### 5.1 Risk Management Framework

Article 9 requires that a risk management system be established, implemented, documented, and maintained throughout the entire lifecycle of the high-risk AI system.

| Article 9 Requirement | Description | Vorion Implementation | Status |
|---|---|---|---|
| Art. 9(1): Establish risk management system | Continuous iterative process throughout lifecycle | Multi-dimensional risk scoring; control registry; trust tier system | [IMPLEMENTED] |
| Art. 9(2)(a): Identify known and foreseeable risks | Risk identification and analysis | `AiActClassifier` identifies prohibited and high-risk categories; tripwire detection for known attack patterns | [IMPLEMENTED] |
| Art. 9(2)(b): Estimate and evaluate risks | Risk evaluation | `risk_score` (0.0-1.0) with per-category `risk_indicators` (data_exposure, tool_danger, scope_creep, escalation) | [IMPLEMENTED] |
| Art. 9(2)(c): Evaluate risks from data | Data-related risk evaluation | `data_classifications` in StructuredPlan; data residency controls in GovernanceRegime | [IMPLEMENTED] |
| Art. 9(2)(d): Evaluate risks considering cumulative effects | Cumulative risk assessment | Velocity tracking across time windows; circuit breaker metrics track cumulative indicators | [IMPLEMENTED] |
| Art. 9(4): Appropriate risk management measures | Risk mitigation implementation | Policy engine with severity-graded constraints; trust-proportional enforcement; circuit breaker | [IMPLEMENTED] |
| Art. 9(6): Testing for high-risk systems | Appropriate testing | AI critic evaluation; tripwire testing; [PLANNED] dedicated conformity testing framework | [PARTIAL] |
| Art. 9(7): Testing appropriate to intended purpose | Purpose-appropriate testing | Classification-specific testing per AiActClassifier output; [PLANNED] expanded test suites per Annex III category | [PARTIAL] |
| Art. 9(9): Risk management throughout lifecycle | Continuous risk management | PROOF chain records all decisions throughout lifecycle; trust scores evolve over time | [IMPLEMENTED] |

### 5.2 Risk Identification

[Document identified risks for the specific AI system]

| Risk ID | Risk Description | EU AI Act Reference | Likelihood | Impact | Risk Level | Mitigation |
|---|---|---|---|---|---|---|
| [R-001] | [Description] | [Article reference] | [H/M/L] | [H/M/L] | [H/M/L] | [Mitigation measure] |
| | | | | | | |

### 5.3 Residual Risks

[Document risks that remain after mitigation measures are applied]

| Risk ID | Residual Risk Description | Residual Level | Justification for Acceptance | Monitoring Approach |
|---|---|---|---|---|
| [R-001] | [Description after mitigation] | [H/M/L] | [Why this residual level is acceptable] | [How this risk is monitored] |
| | | | | |

---

## 6. Template: Data Governance Measures (Annex IV, Section 5)

### 6.1 Data Governance Framework

Article 10 requires that high-risk AI systems using techniques involving the training of AI models with data shall be developed on the basis of training, validation, and testing data sets that meet quality criteria.

| Article 10 Requirement | Description | Vorion Implementation | Status |
|---|---|---|---|
| Art. 10(2): Data governance and management practices | Design choices, data collection, preparation, formulation of assumptions | `StructuredPlan.data_classifications` documents data types; `GovernanceRegime.consentModel` governs consent | [IMPLEMENTED] |
| Art. 10(2)(a): Relevant design choices | Document data-related design choices | PROOF chain records data classification decisions | [IMPLEMENTED] |
| Art. 10(2)(b): Data collection processes | Document data collection and origin | `StructuredPlan.endpoints_required` documents data sources per request | [IMPLEMENTED] |
| Art. 10(2)(f): Examination for biases | Examine data for possible biases | [PLANNED] Automated bias detection integration; existing BiasDetector in platform-core | [PARTIAL] |
| Art. 10(3): Relevant, representative, free of errors, complete | Data quality requirements | Input validation via Pydantic models; [PLANNED] Data quality scoring | [PARTIAL] |
| Art. 10(5): Processing of special categories of personal data | Processing of sensitive data | `data_classifications` identifies sensitive data types; consent model enforcement | [IMPLEMENTED] |

### 6.2 Data Inventory

[To be completed for the specific AI system]

| Data Category | Source | Volume | Personal Data | Special Category | Consent Basis | Retention |
|---|---|---|---|---|---|---|
| [Category] | [Source] | [Volume] | [Yes/No] | [Yes/No] | [GDPR Art. 6 basis] | [Period] |
| | | | | | | |

### 6.3 Data Quality Measures

| Measure | Description | Implementation Status |
|---|---|---|
| Input validation | Pydantic model validation on all API inputs | [IMPLEMENTED] |
| Data classification | Automatic classification of data types in StructuredPlan | [IMPLEMENTED] |
| PII detection | Identification of personally identifiable information | [IMPLEMENTED via data_classifications] |
| Data integrity | SHA-256 hashing of inputs and outputs in PROOF records | [IMPLEMENTED] |
| Data minimization | Policy enforcement of data minimization principles | [IMPLEMENTED via ENFORCE.policy] |

---

## 7. How Vorion Generates and Maintains Technical Documentation Automatically

### 7.1 Automatic Documentation via PROOF Artifacts

Vorion's three-layer pipeline (INTENT, ENFORCE, PROOF) continuously generates documentation artifacts that satisfy significant portions of the Annex IV requirements:

| Pipeline Stage | Artifact Generated | Annex IV Section Addressed | Description |
|---|---|---|---|
| INTENT | `StructuredPlan` | 1(a), 2(e), 3 | Documents the system's intended action, tools, endpoints, data types, risk indicators, and reasoning trace |
| INTENT | `AiActClassificationResult` | 1(a), 4 | Documents the EU AI Act risk classification with confidence, reasoning, annex reference, and obligations |
| INTENT | `IntentResponse` | 1(a), 3 | Documents the entity, trust level, trust score, and processing status at time of request |
| ENFORCE | `EnforceResponse` | 3, 4 | Documents the enforcement verdict (allow/deny/escalate/modify), policy violations, policies evaluated, rigor mode, and approval requirements |
| ENFORCE | `PolicyViolation` | 4, 6 | Documents specific policy violations with severity, remediation guidance, and blocking status |
| PROOF | `ProofRecord` | 3, 5 | Provides immutable, hash-chained record of the complete decision including intent, verdict, entity, action type, decision, inputs hash, outputs hash, and chain integrity |
| PROOF | `ProofStats` | 3, 8 | Provides aggregate statistics on total records, chain integrity, and decision distribution |

### 7.2 Continuous Documentation Maintenance

The PROOF chain ensures that technical documentation is maintained throughout the AI system lifecycle:

1. **Real-time generation**: Every request through Cognigate produces timestamped, structured documentation artifacts
2. **Immutability**: Hash-chained records with SHA-256 ensure that historical documentation cannot be altered
3. **Completeness**: The three-layer pipeline ensures that intent, enforcement decision, and proof record are always generated together
4. **Traceability**: Every PROOF record links to its originating `intent_id` and `verdict_id`, enabling complete reconstruction of any decision
5. **Verifiability**: The `ProofVerification` model enables auditors to verify chain integrity at any time

### 7.3 Documentation Export

[PLANNED] Vorion will provide automated documentation export capabilities:

| Export Format | Description | Target Date |
|---|---|---|
| Annex IV report | Structured report following this template, populated with data from PROOF chain | [PLANNED] |
| Conformity assessment evidence bundle | Package of evidence for Article 43 conformity assessment | [PLANNED] |
| Notified body submission package | Formatted documentation package for third-party assessment | [PLANNED] |
| Supervisory authority response | Documentation package for regulatory inquiries | [PLANNED] |
| Machine-readable technical documentation | JSON/YAML export of all documentation artifacts | [PLANNED] |

### 7.4 Documentation Retention

Per Article 11(1) and Article 72, technical documentation must be kept for a period of 10 years from the date on which the AI system was placed on the market or put into service. Vorion supports this through:

- `GovernanceRegime.auditRetentionDays`: Configurable retention period per jurisdiction and governance regime [IMPLEMENTED]
- PROOF chain persistence in Neon PostgreSQL with configurable retention policies [IMPLEMENTED]
- Control registry maps `PROOF.retention` to Article 19(1) and Article 72 [IMPLEMENTED]

---

## 8. Template: Changes Throughout Lifecycle (Annex IV, Section 5)

### 8.1 Change Documentation

All changes to the AI system that affect its technical documentation must be recorded. Vorion supports change documentation through:

| Change Type | Documentation Mechanism | Status |
|---|---|---|
| Configuration changes | PROOF chain records governance regime changes | [IMPLEMENTED] |
| Policy changes | Policy engine version tracking; PROOF records policy evaluations | [IMPLEMENTED] |
| Trust tier changes | Trust history tracking with weighted score adjustment | [IMPLEMENTED] |
| System version changes | Control registry `metadata.product_version` and `last_updated` | [IMPLEMENTED] |
| Incident-driven changes | Circuit breaker trip records with reason and details | [IMPLEMENTED] |

### 8.2 Change Log Template

| Change ID | Date | Description | Affected Annex IV Sections | Approved By | PROOF Reference |
|---|---|---|---|---|---|
| [C-001] | [Date] | [Description of change] | [Sections affected] | [Approver] | [proof_id] |
| | | | | | |

---

## 9. Template: Conformity Assessment (Annex IV, Section 6)

Refer to document `VOR-EUAI-CA-001` (EU AI Act Conformity Assessment Procedure) for the complete conformity assessment methodology, including:

- Self-assessment vs. third-party assessment decision matrix
- Assessment pathway by Annex III category
- Evidence requirements for each assessment pathway
- CE marking eligibility [PLANNED]

---

## 10. Template: EU Declaration of Conformity (Annex IV, Section 7)

**Status: [PLANNED]**

The EU Declaration of Conformity under Article 47 must include:

| Declaration Element | Description | Status |
|---|---|---|
| AI system name and type | Unambiguous identification of the AI system | [PLANNED] |
| Provider name and address | Legal identification of the provider | [PLANNED] |
| Statement of conformity | Declaration that the system complies with the EU AI Act | [PLANNED] |
| Reference to harmonised standards | Standards applied, if any | [PLANNED] |
| Notified body involvement | Reference to notified body certificate, if applicable | [PLANNED] |
| Date and signature | Signed by authorized representative | [PLANNED] |

**Note:** Vorion does not currently hold any CE markings or EU Declarations of Conformity. These are planned future deliverables.

---

## 11. Template: Post-Market Monitoring (Annex IV, Section 8)

### 11.1 Post-Market Monitoring System (Article 61)

| Requirement | Description | Vorion Implementation | Status |
|---|---|---|---|
| Art. 61(1): Establish post-market monitoring system | Provider shall establish and document a post-market monitoring system | PROOF chain provides continuous monitoring data; [PLANNED] dedicated monitoring dashboard | [PARTIAL] |
| Art. 61(2): System proportionate to nature and risks | Monitoring proportionate to risk level | Rigor modes (LITE/STANDARD/STRICT) auto-selected by trust tier | [IMPLEMENTED] |
| Art. 61(3): Actively collect and review data | Proactive data collection on system performance | Circuit breaker metrics; PROOF statistics; velocity tracking | [IMPLEMENTED] |

### 11.2 Serious Incident Reporting (Article 62)

| Requirement | Description | Vorion Implementation | Status |
|---|---|---|---|
| Art. 62(1): Report serious incidents | Report to market surveillance authority of the Member State | [PLANNED] Automated incident reporting workflow | [PLANNED] |
| Art. 62(1): Report without undue delay | Report upon establishing causal link, and in any event within 15 days | [PLANNED] Incident reporting SLA enforcement | [PLANNED] |

### 11.3 Monitoring Metrics

| Metric | Data Source | Frequency | Threshold for Action |
|---|---|---|---|
| High-risk action ratio | `CircuitMetrics.high_risk_requests / total_requests` | Real-time | >10% triggers circuit breaker |
| Denial rate | `ProofStats.records_by_decision["denied"]` | Daily | Sustained >20% warrants investigation |
| Escalation rate | `ProofStats.records_by_decision["escalated"]` | Daily | Sustained >10% warrants investigation |
| Chain integrity | `ProofStats.chain_integrity` | Continuous | Any integrity failure triggers immediate investigation |
| Circuit breaker trips | `CircuitTrip` events | Per occurrence | All trips investigated |
| Entity trust degradation | Trust score trend analysis | Weekly | Score drop >100 points warrants investigation |

---

## 12. Completing This Template

### 12.1 Provider Responsibilities

The AI system provider is responsible for:

1. Completing all template sections with system-specific information
2. Ensuring accuracy and completeness of the documentation
3. Maintaining the documentation throughout the system lifecycle
4. Updating the documentation when material changes occur
5. Making the documentation available to competent authorities upon request

### 12.2 Deployer Responsibilities

The AI system deployer is responsible for:

1. Verifying that the provider has completed this documentation
2. Supplementing the documentation with deployment-specific information (data residency, user population, operational context)
3. Conducting the Fundamental Rights Impact Assessment (see `VOR-EUAI-FRIA-001`)
4. Maintaining deployment-specific logs and monitoring data
5. Reporting serious incidents per Article 62

### 12.3 Vorion's Role

Vorion provides:

1. Automated risk classification via the `AiActClassifier` [IMPLEMENTED]
2. Continuous documentation generation via the PROOF chain [IMPLEMENTED]
3. This template structure for organizing technical documentation [IMPLEMENTED]
4. Policy-based enforcement of documentation requirements [IMPLEMENTED]
5. [PLANNED] Automated Annex IV report generation from PROOF artifacts
6. [PLANNED] Automated documentation export for regulatory submissions

---

## 13. Document History

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0.0 | 2026-02-20 | Vorion Compliance Engineering | Initial release |

---

## 14. References

- Regulation (EU) 2024/1689, Article 11 and Annex IV: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689
- Vorion Conformity Assessment Procedure: `VOR-EUAI-CA-001`
- Vorion Fundamental Rights Impact Assessment Template: `VOR-EUAI-FRIA-001`
- Vorion Control Registry: `compliance/control-registry.yaml`
- AI Act Classifier Implementation: `packages/platform-core/src/intent-gateway/ai-act-classifier.ts`
- AI Act Type Definitions: `packages/platform-core/src/intent-gateway/types.ts`
- PROOF Model: `cognigate/app/models/proof.py`
- ENFORCE Model: `cognigate/app/models/enforce.py`
- INTENT Model: `cognigate/app/models/intent.py`
- Circuit Breaker: `cognigate/app/core/circuit_breaker.py`
- Trust Level Definitions: `cognigate/app/models/common.py`
- International Requirements Gap Analysis: `analysis/INTERNATIONAL_REQUIREMENTS.md`

---

*Document generated: 2026-02-20*
*Next review: 2026-08-20*
