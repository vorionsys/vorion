# Vorion Cognigate Assessment and Authorization Policy

**Document ID:** VOR-POL-CA-001
**Version:** 1.0.0
**Effective Date:** 2026-02-19
**Classification:** PUBLIC
**Owner:** Vorion Security Engineering
**Review Cadence:** Annual (next review: 2027-02-19)
**Satisfies:** NIST SP 800-53 Rev 5 CA-2(1), CA-5, CA-6, CA-7(1), CA-8

---

## 1. Purpose and Scope

This policy defines the assessment, authorization, and continuous monitoring practices for the Vorion Cognigate AI Agent Governance Engine. Cognigate enforces the BASIS (Behavioral AI Safety Interoperability Standard) through its three-layer architecture (INTENT, ENFORCE, PROOF) and provides real-time AI governance for autonomous agent operations.

This policy covers:

- Independent assessment of Cognigate's security controls and governance decisions
- Plan of Action and Milestones (POA&M) management
- System security authorization and ongoing authorization
- Independent monitoring by external assessors
- Penetration testing scope, schedule, and methodology

The system is classified as MODERATE (Confidentiality: M / Integrity: M / Availability: M) per the architecture overview (`compliance/oscal/architecture-overview.md`).

---

## 2. Independent Assessment (CA-2.1)

### 2.1 AI Critic as Independent Assessor

Cognigate implements architectural separation between planning and assessment through the Planner + Critic pattern. The AI Critic (`app/core/critic.py`) provides independent adversarial assessment of enforcement decisions:

**Critic Architecture**:

- The Critic is a separate AI evaluator that reviews plans produced by the INTENT layer
- It operates with an adversarial mindset, explicitly instructed to "ASSUME BAD INTENT until proven otherwise"
- The Critic's system prompt directs it to look for hidden risks, euphemisms, dangerous tool combinations, and scope creep
- It produces a structured judgment independent of the INTENT layer's risk score

**Judgment Scale**:

| Judgment | Meaning | Action |
|---|---|---|
| `safe` | No significant risks detected | Proceed normally |
| `suspicious` | Something feels off | Additional scrutiny recommended |
| `dangerous` | Clear risks present | Escalation to human review |
| `block` | Obvious malicious intent or critical system risk | Immediate block |

**Critic Output** (`CriticVerdict`):

- `judgment`: Independent safety classification
- `confidence`: Self-assessed confidence (0.0-1.0)
- `risk_adjustment`: Recommended adjustment to the INTENT layer's risk score (-0.5 to +0.5)
- `hidden_risks`: Risks the INTENT layer may have missed
- `reasoning`: Detailed adversarial reasoning
- `requires_human_review`: Whether human intervention is recommended
- `recommended_action`: `proceed`, `escalate`, `block`, or `modify`

**Invocation Criteria** (`should_run_critic()` in `app/core/critic.py`):

- Risk score >= 0.3 (moderate or higher risk)
- Any dangerous tools involved (`shell`, `file_delete`, `database`, `network`)
- All requests from entities at trust levels 0 or 1 (when enforcement rigor is STRICT)

**Provider Independence**: The Critic supports four independent AI providers (Anthropic Claude, OpenAI GPT, Google Gemini, xAI Grok). Organizations can configure a different provider for the Critic than for other AI operations, ensuring true independence of assessment.

### 2.2 Separation of Assessment from Enforcement

The Cognigate architecture enforces structural separation between the three pipeline stages:

```
INTENT (Analysis) --> ENFORCE (Decision) --> PROOF (Record)
     |                     |                     |
     v                     v                     v
  Risk scoring        Policy evaluation      Immutable audit
  Goal normalization   Trust gating           Hash chain
  Critic analysis      Velocity caps          Ed25519 signatures
                       Circuit breakers
```

The Critic provides assessment data to the ENFORCE layer but does not make enforcement decisions. The PolicyEngine (`app/core/policy_engine.py`) makes independent enforcement decisions based on policy constraints, trust levels, and the Critic's advisory input.

### 2.3 External Assessment Support

Cognigate's compliance endpoints are publicly queryable (with appropriate authentication), enabling external assessors to independently verify the system's compliance posture:

- **`GET /v1/compliance/dashboard`**: Aggregated view across all 13 mapped frameworks
- **`GET /v1/compliance/health`**: Health check identifying compliance gaps
- **`GET /v1/compliance/audit`**: Audit trail for compliance evidence
- **`GET /v1/compliance/access`**: Access control compliance status

These endpoints are implemented through the AgentAnchor compliance framework (`apps/agentanchor/lib/compliance/compliance-framework.ts`, `apps/agentanchor/lib/compliance/audit-logger.ts`).

### 2.4 Third-Party Assessment Schedule

| Assessment Type | Frequency | Assessor | Scope |
|---|---|---|---|
| Automated security scanning | Continuous (every PR) | CI/CD pipeline (CodeQL, Trivy, Semgrep, Bandit) | Full codebase |
| SBOM and dependency audit | Weekly + every release | Automated pipeline | All dependencies |
| Independent security assessment | Annual | Third-party security firm (planned) | Full system |
| Compliance framework review | Quarterly | Internal compliance team | 13-framework control registry |

---

## 3. Plan of Action and Milestones (CA-5)

### 3.1 OSCAL POA&M

The Cognigate Plan of Action and Milestones is maintained in OSCAL format at `compliance/oscal/poam.json`. The POA&M document:

- Conforms to OSCAL version 1.1.2
- References the System Security Plan via `import-ssp` linkage to `./ssp-draft.json`
- Is prepared and maintained by Vorion (`security@vorion.org`)
- Assigns risk levels and priorities to each POA&M item

Each POA&M item includes:

| Field | Description |
|---|---|
| `uuid` | Unique identifier for the item |
| `title` | Concise description of the finding |
| `description` | Detailed description with remediation context |
| `props.risk-level` | Risk classification (low, moderate, high) |
| `props.priority` | Remediation priority (P1-P4) |
| `related-risks` | Risk statements and impact assessments |

### 3.2 Compliance Gap Identification

Compliance gaps are identified through multiple mechanisms:

1. **Continuous Monitoring**: The `/v1/compliance/health` endpoint performs real-time health checks across 13 frameworks, identifying controls that are not fully implemented
2. **Control Registry Analysis**: The control registry (`compliance/control-registry.yaml`) maps every Cognigate capability to specific framework controls. Gaps between mapped controls and implemented capabilities are tracked as POA&M items
3. **Automated Scanning**: CI/CD security scanning identifies vulnerabilities, which are assessed for compliance impact and added to the POA&M when they affect control implementation
4. **Assessment Findings**: Results from third-party assessments and internal reviews are documented as POA&M items with remediation plans

### 3.3 Quarterly POA&M Review

Every quarter, the following review process is executed:

1. **Status Update**: Each open POA&M item is reviewed for progress against milestones
2. **Risk Reassessment**: Risk levels are reassessed based on current threat landscape and system changes
3. **Priority Adjustment**: Priorities are adjusted based on new compliance requirements or business context
4. **Closure Review**: Items with completed remediation are reviewed for closure with supporting evidence
5. **New Item Addition**: New findings from the quarter are added with risk levels, priorities, and milestones

### 3.4 POA&M Closure Evidence

POA&M items are tracked to closure with evidence recorded in the proof chain:

- **Code Changes**: Git commit references demonstrating the remediation
- **Test Evidence**: Test results (pytest coverage reports, security scan results) confirming the fix
- **Configuration Evidence**: Configuration changes recorded in proof chain with hash verification
- **Assessment Evidence**: Re-assessment results confirming the control is now implemented

---

## 4. Authorization (CA-6)

### 4.1 Authorization Package

The Cognigate authorization package consists of the following OSCAL artifacts maintained in `compliance/oscal/`:

| Artifact | File | Purpose |
|---|---|---|
| System Security Plan | `ssp-draft.json` | Comprehensive system description and control implementations |
| SSP Summary | `ssp-summary.md` | Human-readable SSP summary |
| Component Definition | `component-definition.json` | OSCAL component definitions for Cognigate |
| Implementation Narratives | `implementations-part1.json`, `implementations-part2.json`, `implementations-part3.json` | Detailed control implementation statements |
| Plan of Action & Milestones | `poam.json` | Open findings and remediation plans |
| Architecture Overview | `architecture-overview.md` | System architecture and authorization boundary |

### 4.2 Authorizing Official

The Authorizing Official (AO) role is defined as:

- **Primary AO**: Organization's Chief Information Security Officer (CISO) or designated delegate
- **Responsibilities**: Accepting risk on behalf of the organization for Cognigate operations, reviewing authorization packages, issuing Authorization to Operate (ATO) decisions
- **Authority**: The AO has authority to halt Cognigate operations if unacceptable risk is identified, leveraging the circuit breaker `manual_halt()` function for immediate system-wide halt

### 4.3 Continuous Authorization (FedRAMP 20x Model)

Cognigate supports a continuous authorization model aligned with the FedRAMP 20x initiative:

1. **Continuous Monitoring Foundation**: CA-7 health checks (`/v1/compliance/health`) assess compliance posture across 13 frameworks in real time
2. **Automated Evidence Collection**: The PROOF ledger, structured logging, and SBOM pipeline continuously generate authorization evidence
3. **Tamper-Evident Audit Trail**: The proof chain with SHA-256 hash linkage and Ed25519 signatures provides cryptographic assurance that evidence has not been modified
4. **Real-Time Risk Visibility**: The compliance dashboard aggregates risk metrics, trust tier distributions, circuit breaker status, and policy violation trends
5. **Automated Alerting**: Circuit breaker trips, high-risk request spikes, and injection attempts trigger structured log events at CRITICAL/WARNING severity

Under this model, the authorization decision is continuously informed by automated monitoring rather than relying solely on periodic point-in-time assessments.

### 4.4 Authorization Boundary

The authorization boundary is documented in `compliance/oscal/architecture-overview.md` and encompasses:

**Within Boundary**:
- Cognigate API application (`cognigate-api/app/`)
- INTENT, ENFORCE, and PROOF pipeline components
- Policy engine, trust engine, velocity caps, circuit breaker, tripwires, AI Critic
- Compliance endpoints and monitoring
- Proof chain storage and signature infrastructure

**Outside Boundary** (inherited controls from platform providers):
- Vercel deployment platform (compute, networking, CDN)
- External AI providers (Anthropic, OpenAI, Google, xAI) used by the Critic
- External Logic API (`logic_api_url` in `app/config.py`) when enabled
- Redis cache infrastructure
- PostgreSQL database infrastructure

---

## 5. Independent Monitoring (CA-7.1)

### 5.1 Public Compliance Endpoints

Cognigate provides compliance endpoints that allow independent verification of the system's governance posture. These endpoints enable assessors, auditors, and oversight bodies to query compliance data without relying solely on Vorion-generated reports:

| Endpoint | Method | Purpose | Authentication |
|---|---|---|---|
| `/v1/compliance/dashboard` | GET | Aggregated multi-framework compliance | API key |
| `/v1/compliance/health` | GET | Health check across 13 frameworks | API key |
| `/v1/compliance/audit` | GET | Audit trail access | API key (admin for full access) |
| `/v1/compliance/access` | GET | Access control compliance | API key |
| `/v1/compliance/hipaa` | GET | HIPAA compliance status | API key |
| `/v1/compliance/iso27001` | GET | ISO 27001 compliance status | API key |

### 5.2 CA-7 Continuous Health Assessment

The health check endpoint performs continuous assessment across all 13 mapped frameworks. For each framework, it evaluates:

- Control implementation status (implemented, partial, not implemented)
- Evidence freshness (when was evidence last generated)
- Configuration drift (has the system configuration changed since last assessment)
- Automated test results (are all relevant tests passing)

Results are structured to enable automated ingestion by GRC platforms and compliance monitoring tools.

### 5.3 Tamper-Evident Audit Trail for Assessors

The PROOF ledger provides assessors with a cryptographically verifiable audit trail:

1. **Chain Integrity Verification**: The `ProofVerification` model (`app/models/proof.py`) provides:
   - `valid`: Whether the individual proof record's hash is correct
   - `chain_valid`: Whether the `previous_hash` linkage is intact
   - `signature_valid`: Whether the Ed25519 signature verifies against the public key
   - `issues`: Any integrity issues detected

2. **Chain Statistics**: The `ProofStats` model provides:
   - `total_records`: Total proof records generated
   - `chain_length`: Current chain length
   - `records_by_decision`: Distribution of `allowed`, `denied`, `escalated`, `modified` decisions
   - `chain_integrity`: Boolean indicating overall chain integrity

3. **Public Key Distribution**: The signature manager (`app/core/signatures.py`) exports the public key via `get_public_key_pem()`, enabling any assessor to independently verify proof record signatures without access to the private key.

### 5.4 Third-Party Audit Portal

Independent auditors are supported through:

1. **Read-Only API Keys**: Dedicated API keys with read-only access to compliance endpoints and proof chain queries
2. **Scoped Access**: Read-only keys can query proof records (`ProofQuery` in `app/models/proof.py`) filtered by entity, intent, verdict, decision type, and date range
3. **Export Capability**: The evidence collector (`packages/security/src/compliance/export/evidence-collector.ts`) and report generator (`packages/security/src/compliance/export/report-generator.ts`) support bulk evidence export for audit packages
4. **Hash Verification**: The hash verifier (`packages/security/src/compliance/export/hash-verifier.ts`) enables auditors to independently verify the integrity of exported evidence

---

## 6. Penetration Testing (CA-8)

### 6.1 Annual Penetration Testing Schedule

| Quarter | Activity | Scope |
|---|---|---|
| Q1 | External penetration test | All `/v1/*` API endpoints, authentication bypass, injection attacks |
| Q2 | Red team exercise | Trust tier escalation, circuit breaker bypass, proof chain manipulation |
| Q3 | Application security assessment | Business logic flaws, policy engine bypass, Critic evasion |
| Q4 | Supply chain security review | Dependency analysis, SBOM validation, build pipeline integrity |

### 6.2 Automated Security Testing in CI/CD

The CI/CD pipeline performs continuous security testing that complements annual penetration tests:

**Static Application Security Testing (SAST)**:

| Tool | Pipeline | Scope |
|---|---|---|
| CodeQL | `security-scan.yml` | Semantic code analysis with `security-extended` and `security-and-quality` query suites |
| Bandit | `ci-python.yml` | Python-specific security linting at medium+ severity |
| Ruff | `ci-python.yml` | Python linting including security rules |
| Trivy | `security-scan.yml` | Filesystem vulnerability scanning (CRITICAL, HIGH) |

**Dependency Scanning**:

| Tool | Pipeline | Scope |
|---|---|---|
| Safety | `ci-python.yml` | Python dependency vulnerability check |
| pip-audit | `security-scan.yml` | Python dependency audit with CVE correlation |
| Dependency Review | `security-scan.yml` | PR-level dependency vulnerability gate |
| Gitleaks | `secrets-scan.yml` | Secret detection with SARIF reporting |
| npm audit | `sbom.yml` | Node.js dependency vulnerability correlation |

**Dynamic Application Security Testing (DAST)**: Planned for integration with the CI/CD pipeline. Currently addressed through the annual penetration testing schedule.

### 6.3 Adversarial Test Suite

The Cognigate test suite includes adversarial tests that validate security boundaries:

**Tripwire Tests**: Verify that all 22+ forbidden patterns in `FORBIDDEN_PATTERNS` (`app/core/tripwires.py`) correctly detect and block:
- Filesystem destruction (`rm -rf /`, `mkfs`, `dd`)
- Fork bombs (bash and function variants)
- SQL injection/destruction (`DROP TABLE`, `TRUNCATE`, `DELETE` without WHERE)
- Privilege escalation (`chmod 777`, `chown root`)
- Reverse shells (bash, netcat)
- Credential theft (shadow/passwd files, SSH keys)
- Remote code execution (`curl | bash`, download-and-execute)

**Policy Engine Tests** (`tests/test_policy_engine.py`): Verify that:
- High-risk plans are blocked by the expression evaluator
- Trust-gated access correctly restricts operations by trust level
- PII access requires appropriate trust level
- Policy violations are correctly classified by severity

**Enforcement Tests** (`tests/test_enforce.py`): Verify that:
- The ENFORCE layer correctly integrates policy evaluation, trust gating, and velocity caps
- Rigor mode selection matches trust level
- Violations correctly trigger block, escalate, or modify decisions

### 6.4 Bug Bounty Program

Cognigate participates in a vulnerability disclosure program via GitHub Security Advisories:

- **Reporting Channel**: GitHub Security Advisories on the `voriongit/vorion` repository
- **Scope**: All Cognigate API endpoints, governance pipeline components, and proof chain integrity
- **Response Time**: Initial acknowledgment within 48 hours, triage within 5 business days
- **Disclosure Timeline**: Coordinated disclosure per the vulnerability disclosure policy (see `compliance/policies/risk-supply-chain-addendum.md` Section 1)

### 6.5 Penetration Testing Scope

The following attack surfaces are in scope for penetration testing:

| Target | Attack Vector | Priority |
|---|---|---|
| `/v1/intent` endpoint | Adversarial prompt injection, risk score manipulation | Critical |
| `/v1/enforce` endpoint | Policy bypass, trust level spoofing | Critical |
| `/v1/proof/*` endpoints | Proof chain manipulation, hash collision | Critical |
| Admin API (`X-Admin-Key`) | Authentication bypass, timing attacks | Critical |
| Trust tier escalation | Trust score inflation, decay bypass | High |
| Circuit breaker bypass | Evasion of system-wide and entity-level halts | High |
| Velocity cap evasion | Rate limit bypass, distributed flooding | High |
| Tripwire evasion | Obfuscation of forbidden patterns | High |
| Critic evasion | Adversarial inputs designed to bypass AI assessment | High |
| Proof chain integrity | Hash chain breakage, signature forgery | Critical |
| Supply chain | Dependency confusion, typosquatting | Medium |
| Configuration injection | Environment variable manipulation | Medium |

---

## 7. Compliance Mapping

### NIST SP 800-53 Rev 5

| Control | Enhancement | Title | Section | Implementation Status |
|---|---|---|---|---|
| CA-2 | (1) | Independent Assessors | 2 | Implemented (AI Critic + external support) |
| CA-5 | -- | Plan of Action and Milestones | 3 | Implemented (OSCAL POA&M) |
| CA-6 | -- | Authorization | 4 | Implemented (OSCAL SSP + continuous auth) |
| CA-7 | (1) | Independent Assessment | 5 | Implemented (public endpoints + proof chain) |
| CA-8 | -- | Penetration Testing | 6 | Implemented (annual schedule + CI/CD SAST) |

### Cross-Framework Mapping

| Control | SOC 2 | ISO 27001:2022 | FedRAMP | CMMC 2.0 |
|---|---|---|---|---|
| CA-2(1) | CC4.1 | A.5.35, A.5.36 | CA-2(1) | CA.L2-3.12.1 |
| CA-5 | CC4.1 | A.5.36 | CA-5 | CA.L2-3.12.2 |
| CA-6 | CC4.1 | A.5.35 | CA-6 | CA.L2-3.12.4 |
| CA-7(1) | CC7.1, CC7.2 | A.5.36, A.8.16 | CA-7(1) | CA.L2-3.12.3 |
| CA-8 | CC4.1, CC7.1 | A.8.34 | CA-8 | CA.L2-3.12.1 |

### Evidence Artifacts

| Evidence | Location | Type |
|---|---|---|
| AI Critic implementation | `cognigate-api/app/core/critic.py` | Code |
| Critic system prompt (adversarial) | `app/core/critic.py` (CRITIC_SYSTEM_PROMPT) | Configuration |
| OSCAL POA&M | `compliance/oscal/poam.json` | Documentation |
| OSCAL SSP | `compliance/oscal/ssp-draft.json` | Documentation |
| Architecture overview | `compliance/oscal/architecture-overview.md` | Documentation |
| Component definition | `compliance/oscal/component-definition.json` | Documentation |
| Implementation narratives | `compliance/oscal/implementations-part*.json` | Documentation |
| Proof chain model | `cognigate-api/app/models/proof.py` | Code |
| Signature system | `cognigate-api/app/core/signatures.py` | Code |
| Evidence collector | `packages/security/src/compliance/export/evidence-collector.ts` | Code |
| Report generator | `packages/security/src/compliance/export/report-generator.ts` | Code |
| Hash verifier | `packages/security/src/compliance/export/hash-verifier.ts` | Code |
| Security scan pipeline | `.github/workflows/security-scan.yml` | Configuration |
| Secrets scan pipeline | `.github/workflows/secrets-scan.yml` | Configuration |
| CI/CD pipeline | `.github/workflows/ci-python.yml` | Configuration |
| Control registry (13 frameworks) | `compliance/control-registry.yaml` | Documentation |
| Policy engine tests | `cognigate-api/tests/test_policy_engine.py` | Test |
| Enforcement tests | `cognigate-api/tests/test_enforce.py` | Test |

---

## 8. Metrics and Performance Indicators

| Metric | Target | Frequency | Data Source |
|--------|--------|-----------|-------------|
| Control assessment completion rate (% per cycle) | 100% of selected controls assessed per quarter | Quarterly | `/v1/compliance/health`, control registry |
| POA&M remediation on-time rate | >= 90% of items closed by target date | Quarterly | `compliance/oscal/poam.json` |
| Continuous monitoring alert response time | < 4 hours for CRITICAL, < 24 hours for HIGH | Monthly | Structured logs, incident tracking system |
| Independent assessment finding remediation time | <= 30 days (critical), <= 60 days (high) | Quarterly | POA&M, CI/CD pipeline results |

Metrics are reported monthly to the ISSO and quarterly to the Authorizing Official as part of the continuous monitoring program (VOR-POL-CONMON-001).

---

## 9. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Information System Security Officer (ISSO) | _________________ | _________________ | ________ |
| System Owner | _________________ | _________________ | ________ |
| Authorizing Official | _________________ | _________________ | ________ |

---

*This policy is maintained by Vorion Security Engineering and reviewed annually or upon significant system changes. Changes to this policy require approval from the Vorion CISO or delegate.*
