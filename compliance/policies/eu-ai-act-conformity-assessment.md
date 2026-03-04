# EU AI Act Conformity Assessment Procedure

**Document ID:** VOR-EUAI-CA-001
**Version:** 1.0.0
**Effective Date:** 2026-02-20
**Classification:** PUBLIC
**Owner:** Vorion -- Compliance Engineering
**Review Cadence:** Semi-annual (next review: 2026-08-20)
**Applicable Regulation:** Regulation (EU) 2024/1689 (EU AI Act)
**Satisfies:** EU AI Act Articles 9, 11, 12, 13, 14, 15, 43
**Product:** Vorion AI Governance Platform / Cognigate Enforcement Engine
**Standard:** BASIS v1.0 (Behavioral AI Safety Interoperability Standard)

---

## 1. Purpose and Scope

This document establishes the conformity assessment procedure for AI systems governed by the Vorion AI Governance Platform and its Cognigate enforcement engine. It defines:

- How Vorion classifies AI systems under the EU AI Act risk taxonomy
- The conformity assessment pathway (self-assessment vs. third-party) applicable to each risk classification
- Technical documentation requirements under Article 11 and Annex IV
- Record-keeping obligations under Article 12
- Transparency obligations under Article 13
- Human oversight provisions under Article 14
- How the Cognigate INTENT, ENFORCE, and PROOF pipeline satisfies these obligations

This procedure applies to all AI systems that are registered with, governed by, or monitored through the Vorion platform when those systems operate within or serve users in the European Union or European Economic Area.

**Important distinction:** Vorion is an AI governance platform -- it is not itself a high-risk AI system under Annex III. Vorion provides the infrastructure that enables deployers and providers of AI systems to meet their EU AI Act obligations. This conformity assessment procedure addresses both (a) Vorion's own compliance posture and (b) how Vorion enables compliance for the AI systems it governs.

---

## 2. Risk Classification Methodology

### 2.1 EU AI Act Risk Categories

The EU AI Act (Regulation 2024/1689) establishes four risk tiers for AI systems:

| Risk Level | EU AI Act Category | Regulatory Treatment | Relevant Articles |
|---|---|---|---|
| Unacceptable | Prohibited AI Practices | Banned in the EU/EEA | Article 5 |
| High-Risk | High-Risk AI Systems | Full compliance obligations | Articles 6-15, 43 |
| Limited Risk | Limited-Risk AI Systems | Transparency obligations | Article 50 |
| Minimal Risk | Minimal-Risk AI Systems | Voluntary codes of conduct | Article 95 |

Additionally, the EU AI Act introduces obligations for General-Purpose AI (GPAI) models under Title VIII-A (Articles 51-56), which apply regardless of the risk classification of downstream systems.

### 2.2 Vorion Risk Classification Implementation

Vorion implements automated risk classification through the `AiActClassifier` class located at:

```
/packages/platform-core/src/intent-gateway/ai-act-classifier.ts
```

**Status: [IMPLEMENTED]**

The classifier defines five classification categories as TypeScript types:

```typescript
export const AI_ACT_CLASSIFICATIONS = [
  "unacceptable",
  "high-risk",
  "gpai",
  "limited-risk",
  "minimal-risk",
] as const;
```

Classification is performed by analyzing the stated goal, context, and intent type of each AI system request against curated keyword dictionaries. The classifier follows a priority-ordered evaluation:

1. **Prohibited (Unacceptable) check** -- Scans for keywords associated with Article 5 prohibitions including social scoring, subliminal manipulation, real-time biometric identification for law enforcement, emotion recognition in workplace/education settings, predictive policing of individuals, and untargeted facial image scraping. Confidence: 0.9 when matched.

2. **High-Risk check** -- Evaluates against eight Annex III categories with dedicated keyword sets:

   | Annex III Category | Classifier Category ID | Example Keywords |
   |---|---|---|
   | Biometric identification (1) | `biometric-identification` | facial recognition, voice identification, iris recognition |
   | Critical infrastructure (2) | `critical-infrastructure` | power grid, water supply, traffic management |
   | Education and vocational training (3) | `education-vocational` | student assessment, exam scoring, educational placement |
   | Employment and worker management (4) | `employment-worker-management` | recruitment, CV screening, performance monitoring |
   | Essential private/public services (5) | `essential-services` | credit scoring, insurance pricing, loan application |
   | Law enforcement (6) | `law-enforcement` | criminal risk assessment, recidivism prediction |
   | Migration, asylum, border control (7) | `migration-asylum-border` | border control, asylum application, visa application |
   | Administration of justice and democratic processes (8) | `justice-democratic` | judicial decision, sentencing, electoral processes |

   Confidence scales with keyword match density: `min(0.5 + matches * 0.15, 0.95)`.

3. **GPAI check** -- Detects general-purpose AI models via keywords such as "foundation model," "large language model," "generative ai," triggering Article 53 obligations. Confidence: 0.75.

4. **Limited-Risk check** -- Identifies chatbots, deepfakes, synthetic media, and content generation systems requiring Article 50 transparency obligations. Confidence: 0.70.

5. **Minimal-Risk fallback** -- When no risk indicators are detected, the system defaults to minimal-risk classification with 0.6 confidence, noting voluntary codes of conduct apply.

### 2.3 Classification Output

Each classification produces an `AiActClassificationResult` containing:

- `classification`: The EU AI Act risk tier
- `highRiskCategory`: The specific Annex III category (for high-risk only)
- `confidence`: Numeric confidence score (0.0-1.0)
- `reasoning`: Human-readable explanation of the classification rationale
- `annexReference`: Applicable EU AI Act article or annex reference
- `obligations`: Array of specific regulatory obligations triggered

### 2.4 Obligations by Classification

The classifier maps each risk tier to its corresponding EU AI Act obligations:

**Unacceptable (Article 5):**
- System must not be deployed in the EU/EEA
- Immediate cessation required for EU market
- Notify supervisory authority

**High-Risk (Articles 6-15):**
- Risk management system (Article 9)
- Data governance (Article 10)
- Technical documentation (Article 11)
- Record-keeping / automatic logging (Article 12)
- Transparency and information provision (Article 13)
- Human oversight (Article 14)
- Accuracy, robustness, and cybersecurity (Article 15)
- Conformity assessment (Article 43)
- CE marking (Article 48)
- Post-market monitoring (Article 61)
- Incident reporting (Article 62)

**GPAI (Articles 51-56):**
- Technical documentation (Article 53)
- Downstream provider transparency (Article 53)
- Copyright compliance (Article 53)
- AI Office notification
- Systemic risk assessment if training compute exceeds 10^25 FLOP (Article 55)

**Limited Risk (Article 50):**
- Inform users of AI interaction
- Label AI-generated content
- Disclose deepfake/synthetic content

**Minimal Risk (Article 95):**
- Voluntary codes of conduct
- No mandatory obligations

---

## 3. Conformity Assessment Pathway

### 3.1 Self-Assessment vs. Third-Party Assessment Decision Matrix

Article 43 of the EU AI Act defines two conformity assessment pathways. The applicable pathway depends on the risk classification and the specific Annex III category.

| Risk Classification | Assessment Pathway | Notified Body Required | Basis |
|---|---|---|---|
| Prohibited (Unacceptable) | N/A -- Deployment prohibited | N/A | Article 5 |
| High-Risk: Biometric identification | Third-party conformity assessment | Yes | Article 43(1), Annex III Area 1 |
| High-Risk: Critical infrastructure | Internal control (self-assessment) with QMS | No | Article 43(2), Annex VI |
| High-Risk: Education/vocational | Internal control (self-assessment) with QMS | No | Article 43(2), Annex VI |
| High-Risk: Employment | Internal control (self-assessment) with QMS | No | Article 43(2), Annex VI |
| High-Risk: Essential services (credit scoring) | Third-party conformity assessment | Yes, for credit scoring systems | Article 43(1), Annex III Area 5(a) |
| High-Risk: Law enforcement | Third-party conformity assessment | Yes | Article 43(1), Annex III Area 6 |
| High-Risk: Migration/asylum/border | Third-party conformity assessment | Yes | Article 43(1), Annex III Area 7 |
| High-Risk: Justice/democratic processes | Third-party conformity assessment | Yes | Article 43(1), Annex III Area 8 |
| GPAI | Provider obligations per Article 53; systemic risk assessment for high-capability models | AI Office oversight | Articles 53-56 |
| Limited Risk | No conformity assessment required | No | Article 50 (transparency only) |
| Minimal Risk | No conformity assessment required | No | Article 95 (voluntary) |

### 3.2 Vorion's Role in Conformity Assessment

Vorion operates as a governance infrastructure provider. Its role in conformity assessment is:

1. **For AI systems governed by Vorion**: Vorion provides the technical infrastructure for providers and deployers to satisfy their conformity assessment obligations, including automated risk classification, record-keeping, transparency mechanisms, and human oversight controls.

2. **For Vorion itself**: As a software platform that processes AI system metadata and makes governance decisions, Vorion's own classification is context-dependent. The Cognigate engine performs risk analysis and policy enforcement but does not itself make decisions in any Annex III domain. Vorion's conformity posture is documented in Section 7 below.

### 3.3 Conformity Assessment Process

For AI systems classified as high-risk by the `AiActClassifier`, Vorion facilitates the following conformity assessment workflow:

**Step 1: Risk Classification**
- Cognigate's INTENT layer runs the `AiActClassifier` on every request
- Classification result is recorded in the PROOF chain
- High-risk classification triggers enhanced governance regime

**Step 2: Technical Documentation Generation**
- See Section 4 for Article 11 requirements
- Vorion generates and maintains documentation artifacts via PROOF records

**Step 3: Quality Management System Verification**
- Verify that the provider has an Article 17 quality management system
- Vorion's policy engine (`ENFORCE.policy`) validates QMS-related constraints
- [PLANNED] Automated QMS checklist validation

**Step 4: Conformity Assessment Execution**
- For self-assessment pathways: Vorion provides evidence artifacts from the PROOF chain
- For third-party assessment pathways: Vorion exports documentation packages for notified body review
- [PLANNED] Automated export of conformity assessment evidence bundles

**Step 5: EU Declaration of Conformity**
- [PLANNED] Template generation for Article 47 declarations
- [PLANNED] Integration with EU AI Act database (Article 71)

**Step 6: CE Marking**
- [PLANNED] CE marking workflow per Article 48
- [PLANNED] Automated CE marking eligibility check

---

## 4. Technical Documentation Requirements (Article 11 / Annex IV)

Article 11 requires that technical documentation be drawn up before a high-risk AI system is placed on the market or put into service, and kept up to date throughout its lifecycle.

### 4.1 Annex IV Documentation Elements

The following table maps each Annex IV requirement to Vorion's implementation status:

| Annex IV Element | Description | Vorion Implementation | Status |
|---|---|---|---|
| 1(a) | General description: intended purpose | `GovernanceRegime` definition includes `regimeId`, `name`, policy namespaces | [IMPLEMENTED] |
| 1(b) | General description: interaction with hardware/software | Cognigate API specification (FastAPI/OpenAPI schema); integration documentation | [IMPLEMENTED] |
| 1(c) | General description: versions of relevant software | `registry.metadata.product_version` in control registry; API `version` field | [IMPLEMENTED] |
| 1(d) | General description: forms of deployment | Vercel serverless deployment; Neon PostgreSQL; API-based integration | [IMPLEMENTED] |
| 2(a) | Development process: design and design specifications | BASIS spec documentation; INTENT/ENFORCE/PROOF architecture | [IMPLEMENTED] |
| 2(b) | Development process: design choices and rationale | Architecture decision records in documentation | [IMPLEMENTED] |
| 2(c) | Development process: system architecture | Three-layer pipeline (INTENT, ENFORCE, PROOF) documented | [IMPLEMENTED] |
| 2(d) | Development process: computational resources | Vercel serverless compute; Neon PostgreSQL storage | [IMPLEMENTED] |
| 2(e) | Development process: data requirements and data sheets | Data classification system (`data_classifications` in `StructuredPlan`) | [IMPLEMENTED] |
| 2(f) | Development process: training, validation, testing data | Applicable to AI models governed by Vorion; Vorion does not itself train models | [N/A for Vorion; IMPLEMENTED for governed systems via PROOF records] |
| 3 | Monitoring, functioning, and control | PROOF chain provides immutable audit trail; circuit breaker provides system halt capability | [IMPLEMENTED] |
| 4 | Risk management system | Multi-dimensional risk scoring (`risk_score`, `risk_indicators`); trust tier system; control registry | [IMPLEMENTED] |
| 5 | Changes to the system throughout lifecycle | PROOF chain records all decisions; version tracking in control registry metadata | [IMPLEMENTED] |
| 6 | Conformity assessment procedure | This document | [IMPLEMENTED] |
| 7 | EU declaration of conformity | [PLANNED] Template and workflow for Article 47 declarations | [PLANNED] |
| 8 | Post-market monitoring system | Continuous monitoring via PROOF chain analysis; [PLANNED] dedicated post-market monitoring dashboard | [PARTIAL] |

### 4.2 Documentation Maintenance

Vorion supports continuous documentation maintenance through:

- **Automated record creation**: Every INTENT/ENFORCE/PROOF transaction generates timestamped, hash-chained records
- **Version tracking**: Control registry metadata includes `version`, `last_updated`, and `schema_version`
- **Retention**: PROOF records are retained per the `auditRetentionDays` configured in the `GovernanceRegime` (configurable per jurisdiction)
- **Integrity**: PROOF records use SHA-256 hashing with chain linkage (`previous_hash`, `hash`) and optional digital signatures (`signature` field)

---

## 5. Record-Keeping Requirements (Article 12)

### 5.1 Article 12 Obligations

Article 12 requires that high-risk AI systems be designed and developed with capabilities enabling the automatic recording of events (logs) while the system is in operation. Logging capabilities must:

- Be appropriate to the intended purpose of the system (Article 12(1))
- Enable monitoring of the system's operation throughout its lifecycle (Article 12(2))
- Be commensurate with the intended purpose (Article 12(3))
- Facilitate traceability of the system's functioning (Article 12(4))

### 5.2 How Cognigate's PROOF Chain Satisfies Article 12

The PROOF (Persistent Record of Operational Facts) layer is the third stage of the Cognigate pipeline. Every governance decision produces an immutable `ProofRecord` (defined in `cognigate/app/models/proof.py`) with the following fields:

| ProofRecord Field | Article 12 Relevance | Description |
|---|---|---|
| `proof_id` | Unique identification | Unique identifier with `prf_` prefix |
| `chain_position` | Sequential ordering | Integer position in the proof chain for chronological reconstruction |
| `intent_id` | Traceability to request | Links to the original INTENT request |
| `verdict_id` | Traceability to decision | Links to the ENFORCE verdict |
| `entity_id` | Actor identification | Identifies the AI agent or entity that initiated the action |
| `action_type` | Event categorization | Type of action recorded |
| `decision` | Outcome recording | One of: `allowed`, `denied`, `escalated`, `modified` |
| `inputs_hash` | Input integrity | SHA-256 hash of all inputs to the decision |
| `outputs_hash` | Output integrity | SHA-256 hash of all outputs of the decision |
| `previous_hash` | Chain integrity (Art. 12(4)) | Hash of the preceding proof record, forming an immutable chain |
| `hash` | Record integrity | SHA-256 hash of the current record |
| `signature` | Non-repudiation | Optional digital signature for the record |
| `created_at` | Timestamping | UTC timestamp of record creation |
| `metadata` | Extensible context | Additional context (risk scores, policy IDs evaluated, violations found) |

### 5.3 Chain Integrity Verification

The PROOF chain supports integrity verification through the `ProofVerification` model, which checks:

- **Record validity**: Hash of the record matches its contents
- **Chain validity**: Each record's `previous_hash` matches the `hash` of the preceding record
- **Signature validity**: Digital signature verification when signatures are present

This design satisfies Article 12(4)'s traceability requirement by ensuring that any tampering with historical records is detectable.

### 5.4 Querying and Audit Support

The `ProofQuery` model supports filtering records by:

- `entity_id` -- Retrieve all decisions for a specific AI agent
- `intent_id` -- Trace a specific request through the pipeline
- `verdict_id` -- Find the proof record for a specific enforcement decision
- `decision` -- Filter by outcome type (allowed/denied/escalated/modified)
- `start_date` / `end_date` -- Time-bounded queries
- Pagination via `limit` and `offset`

The `ProofStats` model provides aggregate statistics including total records, chain length, records by decision type, and overall chain integrity status.

### 5.5 Retention Compliance

PROOF record retention is governed by the `auditRetentionDays` field in the `GovernanceRegime` type, which is configurable per jurisdiction. For EU-jurisdiction governance regimes, retention periods are set to comply with Article 19(1), which requires logs to be kept for an appropriate period consistent with the intended purpose of the high-risk AI system and applicable legal obligations. The control registry maps this capability to Article 72, which requires documentation and records to be kept for 10 years from the date the AI system was placed on the market.

---

## 6. Transparency Requirements (Article 13)

### 6.1 Article 13 Obligations

Article 13 requires that high-risk AI systems be designed and developed to ensure that their operation is sufficiently transparent to enable deployers to interpret the system's output and use it appropriately.

### 6.2 Vorion Transparency Implementation

| Article 13 Requirement | Vorion Implementation | Status |
|---|---|---|
| Art. 13(1): Transparency in operation | Every ENFORCE verdict includes `violations`, `policies_evaluated`, `constraints_evaluated`, `rigor_mode`, and `duration_ms` | [IMPLEMENTED] |
| Art. 13(2): Appropriate type and degree of transparency | `reasoning_trace` field in `StructuredPlan` explains interpretation; `reasoning` field in `AiActClassificationResult` explains risk classification | [IMPLEMENTED] |
| Art. 13(3)(a): Intended purpose | `GovernanceRegime` defines intended purpose via `regimeId`, `name`, and `policyNamespaces` | [IMPLEMENTED] |
| Art. 13(3)(b): Level of accuracy, robustness, cybersecurity | `confidence` score in classification results; risk scoring with `risk_indicators` by category (`data_exposure`, `tool_danger`, `scope_creep`, `escalation`) | [IMPLEMENTED] |
| Art. 13(3)(c): Known or foreseeable circumstances of misuse | Tripwire detection system with 22+ forbidden patterns; AI critic evaluation for hidden risks, euphemisms, and unsafe tool combinations | [IMPLEMENTED] |
| Art. 13(3)(d): Human oversight measures | Trust tier system (T0-T7); `requires_approval` flag in enforcement verdicts; circuit breaker with manual halt capability | [IMPLEMENTED] |
| Art. 13(3)(e): Expected lifetime and maintenance measures | `expiresAt` on agent entities; version tracking in control registry | [IMPLEMENTED] |
| Art. 50: User notification of AI interaction | [PLANNED] UI indicator for AI-generated content and AI interaction disclosure | [PLANNED] |
| Art. 50: Synthetic content labeling | [PLANNED] Watermarking and labeling for AI-generated outputs | [PLANNED] |

### 6.3 Goal Classification Transparency

The INTENT layer's goal classification capability (`INTENT.plan`) produces a `StructuredPlan` that includes:

- `goal`: The interpreted goal in plain language
- `tools_required`: Explicit list of tools/APIs the AI system needs
- `endpoints_required`: External endpoints to be accessed
- `data_classifications`: Types of data involved (e.g., `pii_email`)
- `risk_indicators`: Per-category risk scores
- `risk_score`: Overall risk score (0.0 to 1.0)
- `reasoning_trace`: Human-readable explanation of the classification

This level of transparency enables deployers to understand what the AI system intends to do before it acts, satisfying Article 13(1) and 13(2).

---

## 7. Human Oversight (Article 14)

### 7.1 Article 14 Obligations

Article 14 requires that high-risk AI systems be designed and developed so that they can be effectively overseen by natural persons during the period in which they are in use. Human oversight measures shall aim to prevent or minimize risks to health, safety, or fundamental rights.

### 7.2 How the Trust Tier System Supports Article 14

Cognigate's 8-tier trust model (defined in `cognigate/app/models/common.py`) implements progressive human oversight that scales inversely with demonstrated trustworthiness:

| Trust Tier | Name | Score Range | Human Oversight Level | Rigor Mode |
|---|---|---|---|---|
| T0 | Sandbox | 0-199 | Maximum: All actions reviewed, no autonomous execution | STRICT |
| T1 | Observed | 200-349 | High: Actions logged and sampled for review | STRICT |
| T2 | Provisional | 350-499 | High: Enhanced auditing and AI critic review | STRICT |
| T3 | Monitored | 500-649 | Standard: All BASIS policies evaluated | STANDARD |
| T4 | Standard | 650-799 | Standard: All BASIS policies evaluated | STANDARD |
| T5 | Trusted | 800-875 | Reduced: Critical policies only | LITE |
| T6 | Certified | 876-950 | Reduced: Critical policies only | LITE |
| T7 | Autonomous | 951-1000 | Minimal: Critical policies only, highest autonomy | LITE |

This model satisfies Article 14 requirements as follows:

### 7.3 Article 14(4) Specific Requirements

| Requirement | Vorion Implementation | Status |
|---|---|---|
| Art. 14(4)(a): Fully understand capacities and limitations of the AI system | Policy engine (`ENFORCE.policy`) evaluates constraints and produces detailed violation reports with severity levels and remediation guidance | [IMPLEMENTED] |
| Art. 14(4)(b): Aware of automation bias | AI critic (`INTENT.critic`) implements adversarial analysis using multi-provider LLM evaluation; paranoia mode (`INTENT.paranoia`) assumes bad intent | [IMPLEMENTED] |
| Art. 14(4)(c): Correctly interpret high-risk AI output | Trust tier enforcement (`ENFORCE.trust`) requires observation periods before granting higher autonomy; new entities start at T1 (Observed) | [IMPLEMENTED] |
| Art. 14(4)(d): Decide not to use AI in a particular situation | Circuit breaker (`ENFORCE.circuit_breaker`) enables autonomous system halt; enforcement verdicts include `action: "deny"` and `action: "escalate"` decisions | [IMPLEMENTED] |
| Art. 14(4)(e): Intervene in or interrupt the AI system | Circuit breaker supports `MANUAL_HALT` trip reason; admin endpoints allow trust revocation; `requires_approval` flag enables human-in-the-loop gating | [IMPLEMENTED] |

### 7.4 Escalation and Intervention Mechanisms

The Cognigate enforcement layer provides multiple intervention mechanisms:

1. **Pre-execution blocking**: The ENFORCE layer can deny or escalate any action before execution. The `EnforceResponse` model includes `allowed: bool` and `action` (allow/deny/escalate/modify).

2. **Circuit breaker halt**: The circuit breaker (`cognigate/app/core/circuit_breaker.py`) automatically halts the system when safety thresholds are exceeded. Trip reasons include:
   - `HIGH_RISK_THRESHOLD`: More than 10% of actions classified as high-risk
   - `INJECTION_DETECTED`: Prompt injection attack detected
   - `CRITICAL_DRIFT`: Critical behavioral drift observed
   - `TRIPWIRE_CASCADE`: Multiple tripwire triggers in 60 seconds
   - `ENTITY_MISBEHAVIOR`: Single entity causing excessive violations
   - `CRITIC_BLOCK_CASCADE`: Multiple AI critic block decisions
   - `VELOCITY_ABUSE`: Rate/velocity limit violations
   - `MANUAL_HALT`: Human-initiated system halt

3. **Trust revocation**: Trust scores can be reduced, causing immediate capability restrictions as the entity falls to a lower trust tier with more restrictive oversight.

4. **Approval gating**: The `requires_approval` flag in enforcement verdicts enables human-in-the-loop review with configurable `approval_timeout` (e.g., "4h").

---

## 8. Accuracy, Robustness, and Cybersecurity (Article 15)

### 8.1 Accuracy

The Cognigate classification and enforcement system achieves accuracy through:

- **Multi-dimensional risk scoring**: Risk scores range from 0.0 to 1.0 with per-category indicators (`data_exposure`, `tool_danger`, `scope_creep`, `escalation`)
- **Confidence scoring**: Every classification includes a numeric confidence value
- **AI critic validation**: Multi-provider LLM analysis (Anthropic, OpenAI, Google, xAI) with judgment scale: safe/suspicious/dangerous/block

### 8.2 Robustness

- **Deterministic tripwire detection**: 22+ regex-based pattern detection for known attack vectors (filesystem destruction, fork bombs, SQL injection, privilege escalation, reverse shells, credential theft, remote code execution)
- **Circuit breaker resilience**: Automatic system halt on safety threshold violations with three-state model (CLOSED/OPEN/HALF_OPEN) and auto-reset capability
- **Chain integrity**: PROOF records are hash-chained with SHA-256, making tampering detectable

### 8.3 Cybersecurity

- **Authentication**: API key authentication with constant-time comparison (`secrets.compare_digest`) to prevent timing attacks
- **Input validation**: Pydantic model validation on all API inputs; goal length limited to 4,096 characters
- **Prompt injection defense**: Dedicated detection in the AI critic evaluation
- **Encryption**: FIPS-validated cryptography support per `GovernanceRegime.cryptoSuite` configuration (options: `standard`, `fips-140-2`, `sm-national`, `post-quantum`, `cnsa-2.0`)

---

## 9. Control Registry Mapping

The Vorion control registry (`compliance/control-registry.yaml`) maps every Cognigate capability to specific EU AI Act articles. The following articles are covered across the INTENT, ENFORCE, and PROOF layers:

| EU AI Act Article | Cognigate Capabilities Mapped | Layer |
|---|---|---|
| Article 9 (Risk Management) | `INTENT.tripwire`, `INTENT.critic`, `INTENT.risk_score`, `INTENT.paranoia`, `ENFORCE.policy`, `ENFORCE.trust`, `ENFORCE.rigor` | INTENT, ENFORCE |
| Article 10 (Data Governance) | Data classification in `StructuredPlan`; `data_classifications` field | INTENT |
| Article 11 (Technical Documentation) | `INTENT.plan` (structured plan documentation); control registry metadata | INTENT, PROOF |
| Article 12 (Record-Keeping) | `PROOF.decision_log`, `PROOF.chain`, `PROOF.retention`, `INTENT.plan` | PROOF, INTENT |
| Article 13 (Transparency) | `INTENT.plan` (reasoning trace, goal interpretation) | INTENT |
| Article 14 (Human Oversight) | `ENFORCE.circuit_breaker`, `ENFORCE.trust`, `ENFORCE.policy` | ENFORCE |
| Article 15 (Accuracy/Robustness/Cybersecurity) | `INTENT.tripwire`, `INTENT.critic`, `ENFORCE.circuit_breaker`, `ENFORCE.velocity`, `ENFORCE.rate_limit`, `PROOF.signatures` | INTENT, ENFORCE, PROOF |
| Article 16 (Provider Obligations) | `ENFORCE.entity_management` (lifecycle management) | ENFORCE |
| Article 17 (Quality Management System) | `ENFORCE.policy`, `PROOF.chain`, `ENFORCE.rigor`, control registry | ENFORCE, PROOF |
| Article 19 (Log Retention) | `PROOF.retention` (configurable per jurisdiction) | PROOF |
| Article 26 (Deployer Obligations) | `ENFORCE.trust` (deployer control via trust tiers) | ENFORCE |
| Article 43 (Conformity Assessment) | This document; `AiActClassifier` determines pathway | INTENT |
| Article 72 (Documentation Retention) | `PROOF.retention` (10-year retention for EU regimes) | PROOF |

---

## 10. Planned Enhancements

The following items are identified as gaps in the current implementation and are planned for remediation:

| Item | EU AI Act Reference | Priority | Target Date |
|---|---|---|---|
| CE marking eligibility workflow | Article 48 | High | [PLANNED] |
| EU Declaration of Conformity template | Article 47 | High | [PLANNED] |
| EU AI Act database registration integration | Article 71 | High | [PLANNED] |
| User-facing AI interaction disclosure UI | Article 50 | Medium | [PLANNED] |
| Synthetic content watermarking | Article 50 | Medium | [PLANNED] |
| Automated conformity evidence bundle export | Article 43 | Medium | [PLANNED] |
| Post-market monitoring dashboard | Article 61 | Medium | [PLANNED] |
| Incident reporting workflow to national authorities | Article 62 | Medium | [PLANNED] |
| Quality management system automated checklist | Article 17 | Medium | [PLANNED] |

---

## 11. Document History

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0.0 | 2026-02-20 | Vorion Compliance Engineering | Initial release |

---

## 12. References

- Regulation (EU) 2024/1689 of the European Parliament and of the Council (EU AI Act): https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689
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
