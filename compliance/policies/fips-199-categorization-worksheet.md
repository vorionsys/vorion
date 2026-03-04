# FIPS 199 Security Categorization Worksheet

**Document ID:** VOR-POL-FIPS199-001
**Version:** 1.0.0
**Effective Date:** 2026-02-20
**Classification:** PUBLIC
**Owner:** Vorion Security Engineering
**Review Cadence:** Annual or upon significant system change (next review: 2027-02-20)
**Methodology:** NIST FIPS PUB 199, Standards for Security Categorization of Federal Information and Information Systems
**Supporting Guidance:** NIST SP 800-60 Vol. 1 Rev. 1, NIST SP 800-60 Vol. 2 Rev. 1

---

## 1. System Identification

| Field | Value |
|-------|-------|
| **System Name** | Vorion Cognigate |
| **System Acronym** | COGNIGATE |
| **System Owner** | Vorion |
| **System Description** | AI Agent Governance Runtime implementing the BASIS (Behavioral AI Safety Interoperability Standard) specification. Provides real-time intent normalization, policy enforcement, trust scoring, and cryptographic proof generation for autonomous AI agent operations. |
| **System Type** | Major Application |
| **Deployment Environment** | Vercel (FedRAMP Moderate Authorized) + Neon PostgreSQL (SOC 2 Type II) |
| **Operational Status** | Operational |
| **Architecture** | Three-layer governance pipeline: INTENT, ENFORCE, PROOF, CHAIN |

---

## 2. Authorization Boundary

The authorization boundary encompasses the following components:

**Within boundary:**

- Cognigate Engine core (FastAPI/Python application)
- INTENT layer -- intent normalization, risk scoring, AI Critic adversarial analysis
- ENFORCE layer -- PolicyEngine rule evaluation, trust tier gating, velocity caps, circuit breaker
- PROOF layer -- immutable SHA-256 hash chain audit ledger with Ed25519 digital signatures
- Trust Engine -- 8-tier trust model (T0 Sandbox through T7 Autonomous)
- API surfaces: `/v1/intent`, `/v1/enforce`, `/v1/proof`, `/v1/admin`, `/v1/compliance`
- ControlHealthEngine -- 21 real-time control metrics across 13 compliance frameworks
- Tripwire system, velocity engine, evidence hook

**Outside boundary (inherited controls):**

- Vercel compute, networking, CDN, TLS termination (FedRAMP Moderate inherited)
- Neon PostgreSQL database infrastructure (SOC 2 Type II inherited)
- External AI model providers (Anthropic, OpenAI, Google, xAI) used by the AI Critic
- Physical and environmental protections (16 PE controls inherited from cloud providers)
- Consumer applications and AI agents interacting with the system

---

## 3. Information Types

The following information types are identified per NIST SP 800-60 Vol. 2 Rev. 1 taxonomy. Each type is assessed for provisional impact across all three security objectives.

### 3.1 AI Agent Governance Records

| Attribute | Value |
|-----------|-------|
| **SP 800-60 Category** | C.3.5.8 -- General Information Technology Management |
| **Description** | Records of AI agent intent submissions, policy enforcement decisions (allow/deny/escalate/modify), trust tier assignments, and velocity tracking data. These records constitute the operational output of the governance pipeline. |
| **Volume** | High -- every agent action generates governance records |

| Objective | Provisional Impact | Justification |
|-----------|--------------------|---------------|
| Confidentiality | MODERATE | Governance records contain agent behavioral patterns, policy configurations, and enforcement rationale. Unauthorized disclosure could reveal governance bypass strategies or trust scoring algorithms to adversaries. Does not contain classified or national security data (not HIGH). |
| Integrity | MODERATE | Modification of governance records undermines the auditability of agent actions. Tampered records could conceal policy violations or misrepresent enforcement decisions. The SHA-256 hash chain and Ed25519 signatures provide tamper evidence. Does not directly cause loss of life or catastrophic mission failure (not HIGH). |
| Availability | MODERATE | Loss of governance record access degrades audit and compliance capabilities. The system continues to enforce policy in real time even without historical record access. Extended unavailability does not cause immediate safety risk (not HIGH). |

### 3.2 Cryptographic Proof Chain

| Attribute | Value |
|-----------|-------|
| **SP 800-60 Category** | C.3.5.1 -- System Development (audit and accountability subsystem) |
| **Description** | Immutable, sequentially linked audit records. Each proof record includes a SHA-256 content hash, Ed25519 digital signature, `previous_hash` chain linkage, enforcement verdict, entity identifier, and timestamp. The chain provides non-repudiation for all governance decisions. |
| **Volume** | High -- one proof record per governance decision |

| Objective | Provisional Impact | Justification |
|-----------|--------------------|---------------|
| Confidentiality | LOW | Proof records are designed for auditability and contain governance metadata rather than sensitive payload data. The records include entity identifiers and enforcement decisions but not raw agent instructions or protected content. |
| Integrity | HIGH | The proof chain is the foundational integrity mechanism. Any tampering breaks the hash chain from the modification point forward, invalidating all subsequent non-repudiation guarantees. Proof chain integrity is the single most critical security property of the system. |
| Availability | MODERATE | Temporary unavailability of the proof chain does not halt enforcement (the ENFORCE layer operates independently). Extended unavailability prevents audit verification and compliance demonstration. |

### 3.3 Policy Configuration Data

| Attribute | Value |
|-----------|-------|
| **SP 800-60 Category** | C.3.5.8 -- General Information Technology Management |
| **Description** | BASIS specification rules, trust tier capability matrices, velocity cap configurations, circuit breaker thresholds, tripwire forbidden patterns, and enforcement rigor settings. These configurations define the governance behavior of the system. |
| **Volume** | Low -- configuration changes are infrequent |

| Objective | Provisional Impact | Justification |
|-----------|--------------------|---------------|
| Confidentiality | MODERATE | Policy configurations reveal the governance boundaries, trust tier thresholds, and enforcement logic. Disclosure would enable adversaries to craft attacks that precisely evade detection or exploit threshold boundaries. |
| Integrity | MODERATE | Unauthorized modification of policy configurations could weaken governance enforcement, raise velocity caps, disable tripwires, or alter trust tier boundaries. The circuit breaker provides a fail-closed safety net. |
| Availability | MODERATE | Loss of policy configuration access prevents policy updates. The system continues to enforce using the last-known configuration. |

### 3.4 Cryptographic Key Material

| Attribute | Value |
|-----------|-------|
| **SP 800-60 Category** | C.3.5.4 -- Information Security Management |
| **Description** | Ed25519 signing key pair used for proof record signatures, API authentication keys (256-bit entropy), and admin authentication keys. These credentials protect the authenticity and authorization boundaries of the system. |
| **Volume** | Very low -- small number of key artifacts |

| Objective | Provisional Impact | Justification |
|-----------|--------------------|---------------|
| Confidentiality | HIGH | Compromise of the Ed25519 signing private key would allow an attacker to forge proof records, undermining all non-repudiation guarantees. Compromise of admin keys would grant unrestricted privileged access. |
| Integrity | MODERATE | Key material integrity is protected by the cryptographic algorithms themselves. Modification of a key renders it non-functional (detected via signature verification failure). |
| Availability | MODERATE | Loss of key material prevents new proof record signing and may require chain re-initialization. Key backup and recovery procedures mitigate this risk. |

### 3.5 Entity and Trust Metadata

| Attribute | Value |
|-----------|-------|
| **SP 800-60 Category** | C.3.5.2 -- Lifecycle and Change Management |
| **Description** | Entity registration records, trust tier assignments (T0-T7), behavioral trust scores, velocity usage statistics, and tripwire alert history. Minimal PII is processed -- entities are primarily AI agents identified by opaque identifiers. |
| **Volume** | Moderate -- grows with registered entity count |

| Objective | Provisional Impact | Justification |
|-----------|--------------------|---------------|
| Confidentiality | LOW | Entity metadata consists primarily of opaque identifiers and trust scores for AI agents. Minimal PII is processed. Disclosure reveals agent trust levels but not sensitive personal or organizational data. |
| Integrity | MODERATE | Unauthorized modification of trust metadata (particularly trust tier inflation from T0-T2 to T3+) would grant agents capabilities beyond their authorized level. The behavioral scoring model and tripwire detection provide compensating controls. |
| Availability | MODERATE | Loss of entity metadata prevents trust-informed enforcement. The system defaults to restrictive behavior (lowest trust tier) when metadata is unavailable. |

---

## 4. Impact Level Adjustment

Per NIST SP 800-60 Vol. 1 Section 3.2, provisional impact levels may be adjusted based on system-specific factors. The following adjustments are applied.

### 4.1 Adjustment: Proof Chain Integrity -- HIGH downgraded to MODERATE

| Attribute | Value |
|-----------|-------|
| **Information Type** | Cryptographic Proof Chain |
| **Objective** | Integrity |
| **Provisional Level** | HIGH |
| **Adjusted Level** | MODERATE |
| **Justification** | While proof chain integrity is the foundational audit mechanism, Cognigate is a governance layer for commercial AI operations, not a national security or life-safety system. Proof chain compromise would undermine compliance demonstration and non-repudiation but would not directly cause loss of life, catastrophic mission failure, or compromise of classified information. The SHA-256 hash chain provides immediate tamper evidence, and proof chain verification (`GET /v1/proof/{proof_id}/verify`) enables rapid detection of any integrity breach. |

### 4.2 Adjustment: Key Material Confidentiality -- HIGH downgraded to MODERATE

| Attribute | Value |
|-----------|-------|
| **Information Type** | Cryptographic Key Material |
| **Objective** | Confidentiality |
| **Provisional Level** | HIGH |
| **Adjusted Level** | MODERATE |
| **Justification** | Ed25519 signing key compromise is a serious event but is bounded in impact. The key is used solely for proof record signing within the Cognigate system, not for encrypting classified data or protecting human safety systems. Key compromise would allow proof record forgery until the key is rotated, but the circuit breaker fail-closed design, velocity caps, and policy engine enforcement continue to operate independently of the proof chain. Compensating controls include Vercel encrypted environment variable storage, key compromise response procedures, and planned HSM/KMS migration (Q3 2026). |

### 4.3 No Other Adjustments Required

All remaining provisional impact levels are confirmed at their assessed values. No upward adjustments are warranted based on the system's operational context.

---

## 5. Final Security Categorization

### 5.1 Aggregate Impact by Objective

Per FIPS 199, the impact level for each security objective is the HIGH-WATER MARK across all information types processed by the system.

| Security Objective | Information Type High-Water Mark | Adjusted Level |
|--------------------|----------------------------------|:--------------:|
| **Confidentiality** | Policy Configuration Data, Governance Records | **MODERATE** |
| **Integrity** | Governance Records, Policy Configuration, Entity Metadata | **MODERATE** |
| **Availability** | Governance Records, Proof Chain, Policy Configuration, Entity Metadata | **MODERATE** |

### 5.2 Overall System Categorization

Per FIPS 199 Section 4, the overall impact level for the information system is the HIGH-WATER MARK across all three security objectives:

```
SC Vorion Cognigate = {(Confidentiality, MODERATE), (Integrity, MODERATE), (Availability, MODERATE)}

Overall System Impact Level: MODERATE
```

---

## 6. Categorization Justification

### 6.1 Why Not LOW

A LOW categorization is inappropriate because:

1. **Governance impact is non-trivial.** Cognigate enforces behavioral boundaries on autonomous AI agents. Compromise of governance integrity would allow agents to operate outside policy bounds, with consequences extending to downstream consumer systems.
2. **Proof chain provides non-repudiation.** The cryptographic audit trail is a compliance-critical artifact. Its compromise has significant legal and regulatory consequences beyond minor inconvenience.
3. **Multi-framework compliance obligations.** The system satisfies controls across 13 compliance frameworks (NIST 800-53, FedRAMP, ISO 27001, SOC 2, CMMC, EU AI Act, and others). A LOW categorization would be inconsistent with these compliance postures.
4. **Trust tier model governs agent capabilities.** The 8-tier trust model (T0 Sandbox through T7 Autonomous) gates access to progressively more powerful capabilities (shell access at T3+, LITE rigor at T5+). Compromise of trust integrity has material security consequences.

### 6.2 Why Not HIGH

A HIGH categorization is not warranted because:

1. **No classified or national security data.** Cognigate does not process classified information, controlled unclassified information (CUI) at the SECRET level, or data whose disclosure would damage national security.
2. **No direct life-safety impact.** Cognigate governs AI agent behavior in commercial contexts. While governance failures have security consequences, they do not directly cause loss of human life or catastrophic physical harm.
3. **No critical infrastructure dependency.** Cognigate is not a component of critical infrastructure (power grid, financial clearing, healthcare delivery) where unavailability would cause severe or catastrophic harm to the public.
4. **Bounded blast radius.** The circuit breaker fail-closed design ensures that under attack or system failure, the system blocks all agent actions rather than permitting ungovernanced operations. This architectural decision bounds the worst-case failure mode.
5. **Inherited infrastructure protections.** Physical security, network infrastructure, and platform availability are inherited from Vercel (FedRAMP Moderate) and Neon PostgreSQL (SOC 2 Type II), which provide their own HIGH-level protections for their infrastructure without requiring Cognigate to independently achieve HIGH.

### 6.3 Why MODERATE is Appropriate

MODERATE is the correct categorization because:

1. **Significant but bounded consequences.** Unauthorized disclosure, modification, or disruption of governance data would have serious adverse effects on organizational operations, assets, or individuals -- but would not cause catastrophic or exceptionally grave consequences.
2. **Consistent with the inherited control model.** Vercel's FedRAMP Moderate authorization establishes the platform-level baseline. Cognigate's categorization aligns with its deployment infrastructure.
3. **Appropriate for the threat landscape.** The risk assessment (VOR-RA-001) identifies 8 HIGH risks and 8 MODERATE risks, all with treatment plans. The residual risk after compensating controls is MODERATE.
4. **Consistent with NIST SP 800-60 guidance.** The information types processed (IT management, information security management, lifecycle management) align with MODERATE impact guidance in SP 800-60 Vol. 2 for non-national-security systems.

---

## 7. Applicable NIST SP 800-53 Baseline

Based on the MODERATE overall categorization, the applicable control baseline is:

| Attribute | Value |
|-----------|-------|
| **Baseline** | NIST SP 800-53 Rev 5 Moderate |
| **Total Controls** | 313 |
| **Implemented** | 277 (88.5%) |
| **Partially Implemented** | 5 (1.6% -- all in the IA family) |
| **Not Applicable** | 31 (9.9% -- primarily PE physical controls inherited from cloud providers) |
| **Full Implementation Rate (excl. N/A)** | 98.2% |

See the System Security Plan (`compliance/oscal/ssp-draft.json`) and SSP Summary (`compliance/oscal/ssp-summary.md`) for detailed control implementation narratives.

---

## 8. Review and Recategorization Triggers

This categorization must be reassessed when any of the following events occur:

1. Cognigate begins processing classified or CUI-marked data
2. The system is deployed to support life-safety or critical infrastructure use cases
3. Regulatory changes impose new data sensitivity requirements on AI governance systems
4. The authorization boundary expands to include new data stores or processing components
5. A security incident reveals that the actual impact of a compromise exceeds MODERATE thresholds
6. Annual review cycle (next scheduled: 2027-02-20)

---

## 9. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| System Owner | [PLACEHOLDER] | [PLACEHOLDER] | [PLACEHOLDER] |
| Information System Security Officer (ISSO) | [PLACEHOLDER] | [PLACEHOLDER] | [PLACEHOLDER] |
| Authorizing Official (AO) | [PLACEHOLDER] | [PLACEHOLDER] | [PLACEHOLDER] |

**Categorization statement:** I have reviewed this FIPS 199 Security Categorization Worksheet and confirm that the MODERATE overall impact level is appropriate for the Vorion Cognigate system based on the information types processed, the system's operational context, and the applicable adjustments documented herein.

---

*This worksheet was prepared in accordance with NIST FIPS PUB 199 (Standards for Security Categorization of Federal Information and Information Systems) and NIST SP 800-60 Vol. 1 Rev. 1 (Guide for Mapping Types of Information and Information Systems to Security Categories). It should be reviewed and updated annually, or upon trigger events as defined in Section 8.*
