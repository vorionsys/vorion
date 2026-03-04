# NIST COSAiS Alignment: Vorion Platform

**Control Overlays for Securing AI Systems -- SP 800-53 Mapping**

| Field | Value |
|-------|-------|
| Version | 1.0.0 |
| Date | 2026-02-11 |
| Status | Draft for CAISI RFI Submission |
| Deadline | March 9, 2026 |
| Prepared by | Vorion |
| Contact | contact@vorion.org |
| Platform Version | Vorion v6 (Phase 6) |
| Specification | BASIS v1.0.0 (CC BY 4.0) |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Methodology](#2-methodology)
3. [Platform Architecture Overview](#3-platform-architecture-overview)
4. [Use Case 3: Single Agent Systems](#4-use-case-3-single-agent-systems)
5. [Use Case 4: Multi-Agent Systems](#5-use-case-4-multi-agent-systems)
6. [Coverage Summary](#6-coverage-summary)
7. [Gaps and Remediation Plan](#7-gaps-and-remediation-plan)
8. [Recommendations to NIST](#8-recommendations-to-nist)

---

## 1. Executive Summary

Vorion is an enterprise AI governance platform implementing the BASIS (Baseline Authority for Safe & Interoperable Systems) open specification. The platform enforces a governance-before-execution model across a six-layer stack: INTENT, BASIS, ENFORCE, COGNIGATE, PROOF, and TRUST ENGINE.

This document maps NIST SP 800-53 Rev. 5 control families to concrete Vorion implementations in the context of the COSAiS (Control Overlays for Securing AI Systems) framework. COSAiS defines Use Case 3 (Single Agent Systems) and Use Case 4 (Multi-Agent Systems) as the primary scenarios for AI-specific control overlays.

**Key findings:**

- Vorion provides **strong coverage** (implemented in code with tests) for AC, AU, CM, IA, RA, SC, and SI control families in Use Case 3.
- Vorion provides **strong coverage** for Use Case 4 multi-agent controls through its A2A protocol, trust negotiation, chain-of-trust tracking, and cross-agent attestation system.
- The IR (Incident Response) and CA (Assessment) families have **substantial implementations** with playbook automation and trust scoring, though some operational procedures remain configuration-dependent.
- The SA (System Acquisition) family is **partially addressed** through the agent registry and lifecycle management, though formal supply-chain controls for third-party agents remain an area for development.
- All claims below are verified against actual source code in the repository.

---

## 2. Methodology

Each control mapping in this document was produced by:

1. Reading the actual TypeScript source code in the Vorion repository.
2. Identifying the specific file(s), class(es), or function(s) that implement the control.
3. Noting the maturity level of each implementation: **Implemented** (code exists with types/logic), **Tested** (unit/integration tests exist), **Partial** (scaffolded or incomplete), or **Planned** (not yet in code).
4. Documenting gaps honestly where controls are not yet addressed.

Source paths are relative to the repository root `/Users/alexblanc/dev/vorion/`.

---

## 3. Platform Architecture Overview

The Vorion governance stack processes every agent action request through the following layers:

```
Agent Action Request
        |
        v
+---------------------------------------------------------------+
|  INTENT Layer                                                  |
|  Parse action, extract capabilities, classify risk             |
|  Source: packages/runtime/src/intent-pipeline/                 |
|          src/intent/                                           |
+---------------------------------------------------------------+
        |
        v
+---------------------------------------------------------------+
|  BASIS / Validation Gate                                       |
|  Validate agent manifest, CAR ID, trust tier, capabilities     |
|  Source: packages/basis/src/validation-gate.ts                 |
|          packages/basis/src/trust-factors.ts                   |
|          packages/basis/src/trust-capabilities.ts              |
+---------------------------------------------------------------+
        |
        v
+---------------------------------------------------------------+
|  ENFORCE Layer                                                 |
|  Evaluate intent against policies, determine ALLOW/DENY/       |
|  ESCALATE/DEGRADE/LIMIT/MONITOR                               |
|  Source: src/enforce/policy-engine.ts                          |
|          packages/platform-core/src/enforce/                   |
+---------------------------------------------------------------+
        |
        v
+---------------------------------------------------------------+
|  COGNIGATE                                                     |
|  Human-in-the-loop escalation, fluid governance workflow       |
|  Source: src/cognigate/, cognigate-api/                        |
+---------------------------------------------------------------+
        |
        v
+---------------------------------------------------------------+
|  PROOF Layer                                                   |
|  SHA-256 hash chain, Ed25519 signatures, immutable audit trail |
|  Source: packages/proof-plane/src/                             |
+---------------------------------------------------------------+
        |
        v
+---------------------------------------------------------------+
|  TRUST ENGINE                                                  |
|  0-1000 scoring, T0-T7 tiers, 23 trust factors, decay         |
|  Source: packages/platform-core/src/trust-engine/              |
|          packages/basis/src/trust-factors.ts                   |
+---------------------------------------------------------------+
        |
        v
  Action Execution (if ALLOW)
```

**Supporting subsystems:**

- **Agent Registry** (`packages/platform-core/src/agent-registry/`): CAR-based agent registration, state machine (T0-T7 + quarantine/suspended/revoked/expelled), attestation storage, multi-tenant isolation.
- **A2A Protocol** (`packages/platform-core/src/a2a/`): Agent-to-agent communication with trust negotiation, chain-of-trust tracking, delegation tokens, attestation generation.
- **Security** (`src/security/`): Anomaly detection, incident response, DLP, injection detection, RBAC, policy engine, SIEM integration, HSM support, post-quantum cryptography, ZKP compliance proofs.
- **Observability** (`packages/platform-core/src/observability/`): Prometheus metrics, distributed tracing, structured logging, health checks.

---

## 4. Use Case 3: Single Agent Systems

Use Case 3 addresses controls for individual AI agents operating within a governed environment. Each subsection maps a NIST SP 800-53 control family to specific Vorion implementations.

### 4.1 AC -- Access Control

| Control | Description | Vorion Implementation | Source | Status |
|---------|-------------|----------------------|--------|--------|
| AC-1 | Policy and Procedures | `PolicyEngine` class manages named, versioned, priority-ordered enforcement policies with runtime updates and rollback. Default action is deny. | `src/enforce/policy-engine.ts` | Implemented |
| AC-2 | Account Management | Agent Registry provides full lifecycle management: registration, state transitions (T0_SANDBOX through T7_AUTONOMOUS, plus QUARANTINE/SUSPENDED/REVOKED/EXPELLED), multi-tenant isolation. | `packages/platform-core/src/agent-registry/service.ts` | Implemented |
| AC-3 | Access Enforcement | `ValidationGate` enforces PASS/REJECT/ESCALATE decisions based on agent manifest, trust tier, registered profile, and capability matching. `PolicyEngine.evaluate()` short-circuits on deny. | `packages/basis/src/validation-gate.ts`, `src/enforce/policy-engine.ts` | Implemented |
| AC-4 | Information Flow | Capability gating restricts data access by trust tier: T0 = public read-only, T1 = internal read, T2 = approved writes + external GET, T3 = DB write + sandboxed code, T4+ = agent communication. Each capability has explicit constraints (e.g., "No PII", "Rate limited", "Approved endpoints"). | `packages/basis/src/trust-capabilities.ts` | Implemented |
| AC-5 | Separation of Duties | Trust tiers enforce separation: agents at lower tiers cannot perform operations reserved for higher tiers. T5+ can delegate, T6+ can spawn agents, T7 gets governance authority. Capability categories (DATA_ACCESS, GOVERNANCE, SYSTEM_ADMINISTRATION, etc.) enforce domain separation. | `packages/basis/src/trust-capabilities.ts` | Implemented |
| AC-6 | Least Privilege | Agents initialize at trust score 0 (T0_SANDBOX tier) with only 3 capabilities (read public data, generate responses, observe metrics). Capabilities unlock progressively: 6 at T1, 10 at T2, 15 at T3, 20 at T4, 25 at T5, 30 at T6, 35 at T7. Trust decay (configurable half-life) prevents stale high-trust entities. | `packages/basis/src/trust-capabilities.ts`, `packages/basis/src/trust-factors.ts` | Implemented |
| AC-17 | Remote Access | Agent communication gated at T4+. Cross-organization communication requires T6 (CAP-CROSS-ORG) with constraints: federation approved, data classification, encrypted. External API access requires T2+ (GET only) or T3+ (full REST). | `packages/basis/src/trust-capabilities.ts` | Implemented |
| AC-24 | Access Control Decisions | Four-outcome decision model: ALLOW, DENY, ESCALATE, DEGRADE/LIMIT/MONITOR. Policy engine evaluates multiple policies in priority order. Deny overrides all; escalate takes precedence over allow. | `src/enforce/policy-engine.ts` | Implemented |

### 4.2 AU -- Audit and Accountability

| Control | Description | Vorion Implementation | Source | Status |
|---------|-------------|----------------------|--------|--------|
| AU-1 | Policy and Procedures | Proof Plane provides a complete audit system. All governance decisions logged as typed events with correlation IDs. Configurable retention, shadow mode for sandbox agents. | `packages/proof-plane/src/proof-plane/proof-plane.ts` | Implemented |
| AU-2 | Event Logging | Six typed proof events: INTENT_RECEIVED, DECISION_MADE, TRUST_DELTA, EXECUTION_STARTED, EXECUTION_COMPLETED, EXECUTION_FAILED. Each event carries: eventId, eventType, correlationId, agentId, payload, previousHash, occurredAt, signedBy, signature. | `packages/proof-plane/src/proof-plane/proof-plane.ts` | Implemented |
| AU-3 | Content of Audit Records | IntentReceivedPayload includes intentId, action, actionType, resourceScope. DecisionMadePayload includes decisionId, intentId, permitted, trustBand, trustScore, reasoning. ExecutionCompletedPayload includes durationMs and outputHash. | `packages/proof-plane/src/proof-plane/proof-plane.ts` | Implemented |
| AU-6 | Audit Record Review | `queryEvents()` supports filtering by type, agent, correlation ID, time range, and shadow mode. `getTrace()` reconstructs full request lifecycle. `getAgentHistory()` provides per-agent audit trail. `getStats()` returns event statistics. | `packages/proof-plane/src/proof-plane/proof-plane.ts` | Implemented |
| AU-8 | Time Stamps | Every proof event has `occurredAt` and `recordedAt` timestamps. Hash chain includes timestamp in the hashable data structure for tamper detection. | `packages/proof-plane/src/events/hash-chain.ts` | Implemented |
| AU-9 | Protection of Audit Information | SHA-256 hash chain links each event to its predecessor via `previousHash`. Events are hashed using deterministic JSON serialization with sorted keys. Chain verification detects any tampering. | `packages/proof-plane/src/events/hash-chain.ts` | Implemented |
| AU-10 | Non-repudiation | Ed25519 digital signatures on proof events via `EventSigningService`. Keys identified by keyId with owner attribution. Batch verification available. Combined chain + signature verification via `verifyChainAndSignatures()`. | `packages/proof-plane/src/events/event-signatures.ts` | Implemented |
| AU-12 | Audit Record Generation | Event emission is integrated into the governance pipeline. `ProofPlane.logIntentReceived()`, `logDecisionMade()`, `logTrustDelta()`, `logExecutionStarted()`, `logExecutionCompleted()`, `logExecutionFailed()` are called at each pipeline stage. Hook system (EVENT_EMITTED) enables external notification. | `packages/proof-plane/src/proof-plane/proof-plane.ts` | Implemented |

### 4.3 CA -- Assessment, Authorization, and Monitoring

| Control | Description | Vorion Implementation | Source | Status |
|---------|-------------|----------------------|--------|--------|
| CA-2 | Control Assessments | Trust scoring system evaluates agents against 23 factors (15 core + 8 life-critical) across 4 tiers (Foundational, Operational, Sophisticated, Life-Critical). `calculateTrustScore()` identifies missing factors and below-threshold scores. Each factor has measurement criteria and a required-from tier. | `packages/basis/src/trust-factors.ts` | Implemented |
| CA-5 | Plan of Action | `ValidationGateResult.recommendations` provides actionable guidance when agents fail validation (e.g., "Increase trust score to access denied capabilities"). Trust tier display system shows agents their current position and requirements for advancement. | `packages/basis/src/validation-gate.ts` | Implemented |
| CA-7 | Continuous Monitoring | Trust Oracle provides continuous monitoring with risk scoring, vendor registry, data sources, and reporting. Anomaly detection runs 6 detectors (geographic, temporal, volume, account-compromise, data-exfiltration, lateral-movement, privilege-escalation). Prometheus metrics track agent counts by state, state transitions, attestation outcomes, A2A latencies. | `src/security/trust-oracle/`, `src/security/anomaly/`, `packages/platform-core/src/observability/metrics.ts` | Implemented |
| CA-9 | Internal System Connections | Agent-to-agent connections validated through trust negotiation. Each A2A invocation requires trust proof, capability verification, and chain-of-trust validation before proceeding. | `packages/platform-core/src/a2a/trust-negotiation.ts` | Implemented |

### 4.4 CM -- Configuration Management

| Control | Description | Vorion Implementation | Source | Status |
|---------|-------------|----------------------|--------|--------|
| CM-1 | Policy and Procedures | Policy engine supports versioned policies with `PolicyVersion` metadata (version string, createdBy, createdAt, description, previousVersionId). Update listeners notify on add/update/remove. | `src/enforce/policy-engine.ts` | Implemented |
| CM-2 | Baseline Configuration | Agent manifests (`AgentManifest`) define baseline: agentId (CAR format), organization, agentClass, domains, capabilityLevel (L0-L7), version, trustScore, requestedCapabilities. Registered profiles (`RegisteredProfile`) define approved baselines with approvedDomains, maxCapabilityLevel, approvedCapabilities. | `packages/basis/src/validation-gate.ts` | Implemented |
| CM-3 | Configuration Change Control | `PolicyEngine.updatePolicy()` creates new version with rollback capability. `rollbackPolicy()` reverts to previous version. Version history tracked via `getPolicyVersions()`. Enforce schema stores decisions with workflow state machine (SUBMITTED -> EVALUATING -> APPROVED/DENIED/PENDING_REVIEW). | `src/enforce/policy-engine.ts`, `packages/platform-core/src/enforce/schema.ts` | Implemented |
| CM-5 | Access Restrictions for Change | Policy creation requires T6_CERTIFIED (CAP-POLICY-CREATE). Limited policy modification requires T5_TRUSTED (CAP-POLICY-MODIFY-LIMITED) with constraints: non-critical only, reversible, logged. Full governance authority requires T7_AUTONOMOUS. | `packages/basis/src/trust-capabilities.ts` | Implemented |
| CM-6 | Configuration Settings | Constraint templates (`ConstraintTemplate`) provide reusable policy patterns with typed parameters, validation constraints, and tags. `findTemplatesByTag()` for categorized retrieval. Runtime configuration via `PolicyEngineOptions`: defaultAction, maxPolicies, enableCaching, cacheTtlMs. | `src/enforce/policy-engine.ts` | Implemented |
| CM-7 | Least Functionality | Capability taxonomy defines exactly 35 capabilities across 8 categories. Each trust tier unlocks a specific subset. Capabilities carry explicit constraints (e.g., "No network", "Size limited", "Time limited", "Approved directories only"). | `packages/basis/src/trust-capabilities.ts` | Implemented |
| CM-8 | System Component Inventory | Agent registry maintains database-backed inventory: agent ID, tenant, state, trust score, domains, capabilities, registration date, last verification. `DOMAIN_BITS` bitmask for domain encoding. State-to-tier mapping maintained. | `packages/platform-core/src/agent-registry/service.ts` | Implemented |

### 4.5 IA -- Identification and Authentication

| Control | Description | Vorion Implementation | Source | Status |
|---------|-------------|----------------------|--------|--------|
| IA-1 | Policy and Procedures | Agents identified via CAR (Categorical Agent Registry) format: `registry.org.class:DOMAINS-Ln@version`. Validation gate enforces CAR format via regex. | `packages/basis/src/validation-gate.ts` | Implemented |
| IA-2 | Identification and Authentication | CAR string encodes: registry, organization, agent class, domain bitmask, capability level (L0-L7), and version. `validateCARFormat()` parses and validates the identifier. Trust proofs signed with HMAC-SHA256 or Ed25519 provide cryptographic authentication. | `packages/basis/src/validation-gate.ts`, `packages/platform-core/src/a2a/trust-negotiation.ts` | Implemented |
| IA-3 | Device Identification | Agent manifests include metadata for device/runtime identification. Fingerprint service provides device fingerprinting. WebAuthn integration available for hardware-bound authentication. | `src/security/fingerprint-service.ts`, `src/security/webauthn/` | Implemented |
| IA-4 | Identifier Management | Agent registry provides full identifier lifecycle: registration (with CAR generation), state transitions, suspension, revocation, expulsion. Tenant isolation ensures identifier uniqueness per tenant. | `packages/platform-core/src/agent-registry/service.ts` | Implemented |
| IA-5 | Authenticator Management | Ed25519 key pairs for proof plane signing (SigningKeyPair with keyId, owner, createdAt). HMAC-SHA256 for trust proof signatures. HSM integration (AWS CloudHSM, Azure HSM, GCP HSM, Thales Luna, SoftHSM) for key protection. Key rotation via `key-rotation.ts`. Secrets rotation via `secrets-rotation.ts`. | `packages/proof-plane/src/events/event-signatures.ts`, `src/security/hsm/`, `src/security/key-rotation.ts` | Implemented |
| IA-8 | Identification of Non-Organizational Users | Cross-organization agent communication (CAP-CROSS-ORG) at T6+ requires federation approval, data classification, and encryption. Trust proofs include registry identifier for organizational attribution. | `packages/basis/src/trust-capabilities.ts`, `packages/platform-core/src/a2a/trust-negotiation.ts` | Implemented |

### 4.6 IR -- Incident Response

| Control | Description | Vorion Implementation | Source | Status |
|---------|-------------|----------------------|--------|--------|
| IR-1 | Policy and Procedures | Incident management system with typed incidents (DATA_BREACH, ACCOUNT_COMPROMISE, MALWARE, DENIAL_OF_SERVICE, UNAUTHORIZED_ACCESS, INSIDER_THREAT, PHISHING, RANSOMWARE, CONFIGURATION_ERROR). Severity levels P1-P4. | `src/security/incident/types.ts` | Implemented |
| IR-4 | Incident Handling | Full incident lifecycle: DETECTED -> INVESTIGATING -> CONTAINED -> ERADICATED -> RECOVERED -> CLOSED. Timeline entries track all activities. Evidence collection with SHA-256 hashes for integrity. | `src/security/incident/types.ts` | Implemented |
| IR-5 | Incident Monitoring | Anomaly detection with 7 detectors: geographic (impossible travel), temporal (unusual time), volume (spike detection), account-compromise, data-exfiltration, lateral-movement, privilege-escalation. Alert rules with configurable conditions and auto-incident creation. Configurable learning period (14 days default). | `src/security/anomaly/detectors/` | Implemented |
| IR-6 | Incident Reporting | `IncidentReport` type includes: duration metrics (time-to-detect, time-to-contain, time-to-resolve), escalation level, playbook progress, evidence count, notifications sent, timeline, impact assessment, recommendations. `IncidentMetrics` aggregates across all incidents. | `src/security/incident/types.ts` | Implemented |
| IR-8 | Incident Response Plan | Automated playbooks for 8 incident types: account-compromise, data-breach, denial-of-service, malware, ransomware, unauthorized-access, insider-threat, configuration-error. Steps can be manual or automated, with approval gates, retry logic, dependencies, and rollback support. | `src/security/incident/playbooks/` | Implemented |
| IR-AI-1 (proposed) | Agent Circuit Breaker | Trust score suspension on policy violations (-50 points). Agent states include QUARANTINE, SUSPENDED, REVOKED, EXPELLED for isolating compromised agents. Anomaly auto-block when confidence exceeds threshold. | `packages/platform-core/src/agent-registry/service.ts`, `src/security/anomaly/types.ts` | Implemented |

### 4.7 RA -- Risk Assessment

| Control | Description | Vorion Implementation | Source | Status |
|---------|-------------|----------------------|--------|--------|
| RA-1 | Policy and Procedures | Risk classification integrated into INTENT layer: each intent receives a structured risk assessment including action type, resource scope, and capability requirements. | `packages/proof-plane/src/proof-plane/proof-plane.ts` (IntentReceivedPayload) | Implemented |
| RA-3 | Risk Assessment | Trust evaluation via `calculateTrustScore()` assesses agents against required factors for their tier. Identifies missing factors and below-threshold scores. `TrustEvaluation` result includes totalScore, percentile, compliant boolean, missingFactors, belowThreshold arrays. | `packages/basis/src/trust-factors.ts` | Implemented |
| RA-5 | Vulnerability Monitoring | Automated npm audit in compliance evidence pipeline (evidence files in `compliance/evidence/npm-audit-*.json`). SIEM integration (Splunk, Elastic, Datadog) for continuous vulnerability monitoring. Threat intel integration (IP reputation, bot detection, credential stuffing). | `compliance/evidence/`, `src/security/siem/`, `src/security/threat-intel/` | Implemented |
| RA-7 | Risk Response | Trust-based graduated response: risk assessment maps to capability restrictions. High-risk actions trigger escalation (ESCALATE decision). Policy conditions support time-based restrictions (`TimeCondition`). Trust score impacts amplify failure signals (3x for task_failed, -50 for policy_violation). | `src/enforce/policy-engine.ts`, `packages/basis/src/trust-factors.ts` | Implemented |

### 4.8 SA -- System and Services Acquisition

| Control | Description | Vorion Implementation | Source | Status |
|---------|-------------|----------------------|--------|--------|
| SA-4 | Acquisition Process | Agent registration requires: agentId, organization, agentClass, domains, capabilityLevel, version. Registered profiles store approved baselines. Approval requests tracked in database schema. | `packages/platform-core/src/agent-registry/service.ts` | Implemented |
| SA-9 | External System Services | External API access gated by trust tier: T2 for GET, T3 for full REST, T4 for external integrations with OAuth scoping and webhook validation. Cross-org communication at T6 requires federation approval. | `packages/basis/src/trust-capabilities.ts` | Implemented |
| SA-10 | Developer Testing | Validation gate has production and strict presets: `strictValidationGate` treats warnings as errors; `productionValidationGate` requires registered profile and minimum T2 tier. Shadow mode for T0_SANDBOX agents segregates testnet from production events. | `packages/basis/src/validation-gate.ts`, `packages/proof-plane/src/proof-plane/proof-plane.ts` | Implemented |
| SA-11 | Developer Security Testing | Automated code review evidence collected in compliance pipeline (`compliance/evidence/code-reviews-*.txt`). Security scan evidence (`compliance/evidence/security-latest-*.log`). npm audit evidence. | `compliance/evidence/` | Implemented |
| SA-AI-1 (proposed) | Agent Lifecycle Mgmt | Agent state machine: T0_SANDBOX -> T1_OBSERVED -> ... -> T7_AUTONOMOUS, with negative states (QUARANTINE, SUSPENDED, REVOKED, EXPELLED). State transitions stored in database with before/after state, action, reason, and actor. | `packages/platform-core/src/agent-registry/service.ts` | Implemented |

### 4.9 SC -- System and Communications Protection

| Control | Description | Vorion Implementation | Source | Status |
|---------|-------------|----------------------|--------|--------|
| SC-3 | Security Function Isolation | Governance pipeline is layered: INTENT -> BASIS -> ENFORCE -> PROOF each have isolated responsibilities. Capabilities enforce sandboxing: T3 code execution is "Sandboxed, Time limited, Memory limited, No network". | `packages/basis/src/trust-capabilities.ts` | Implemented |
| SC-7 | Boundary Protection | Trust boundaries enforced via capability gating. Internal/external API access separated by tier. DLP scanner prevents sensitive data leakage. Security headers middleware (CSP, HSTS, Permissions-Policy). | `packages/basis/src/trust-capabilities.ts`, `src/security/dlp/scanner.ts`, `src/security/headers/` | Implemented |
| SC-8 | Transmission Confidentiality | DPoP (Demonstrating Proof of Possession) token binding. PKCE for OAuth flows. mTLS requirement available in trust negotiation (`requireMtls` in `TrustRequirements`). Encryption service with key providers. | `src/security/dpop.ts`, `src/security/pkce.ts`, `packages/platform-core/src/a2a/types.ts`, `src/security/encryption/` | Implemented |
| SC-12 | Cryptographic Key Establishment | HSM integration: AWS CloudHSM, Azure HSM, GCP HSM, Thales Luna, local SoftHSM. Key ceremony procedures. PKCS#11 wrapper. Key rotation service. Post-quantum cryptography: Kyber (KEM) and Dilithium (signatures) with hybrid mode for migration. | `src/security/hsm/`, `src/security/crypto/post-quantum/` | Implemented |
| SC-13 | Cryptographic Protection | SHA-256 for hash chains. Ed25519 for event signatures (128-bit security, 64-byte signatures, deterministic). HMAC-SHA256 for trust proofs. Shamir secret sharing with security analysis and test vectors. FIPS mode support. | `packages/proof-plane/src/events/hash-chain.ts`, `packages/proof-plane/src/events/event-signatures.ts`, `src/security/crypto/` | Implemented |
| SC-28 | Protection of Information at Rest | Encryption service with decorators for field-level encryption. Key provider abstraction. KMS integration (AWS KMS, HashiCorp Vault, local). Secure memory for sensitive data handling. | `src/security/encryption/`, `src/security/kms/`, `src/security/secure-memory.ts` | Implemented |
| SC-AI-1 (proposed) | Agent Sandboxing | T0_SANDBOX tier: 3 capabilities only (read public, respond, observe). T3 code execution explicitly sandboxed (CAP-CODE-SANDBOX: "Sandboxed, Time limited, Memory limited, No network"). Shadow mode in Proof Plane segregates sandbox agent events. | `packages/basis/src/trust-capabilities.ts`, `packages/proof-plane/src/proof-plane/proof-plane.ts` | Implemented |

### 4.10 SI -- System and Information Integrity

| Control | Description | Vorion Implementation | Source | Status |
|---------|-------------|----------------------|--------|--------|
| SI-1 | Policy and Procedures | Governance-before-execution: no agent action proceeds without passing through the validation gate and policy engine. Default deny policy. | `packages/basis/src/validation-gate.ts`, `src/enforce/policy-engine.ts` | Implemented |
| SI-3 | Malicious Code Protection | Injection detector covers 8 attack types: SQL, XSS, Command, Template, Path Traversal, LDAP, XML, NoSQL. Prompt injection defense with configurable sensitivity, encoding attack detection, context overflow detection. AI governance output filter. | `src/security/injection-detector.ts`, `src/security/ai-governance/prompt-injection.ts`, `src/security/ai-governance/output-filter.ts` | Implemented |
| SI-4 | System Monitoring | Prometheus metrics: agent counts by state, state transitions, attestation outcomes, A2A latencies, decision durations. SIEM connectors (Splunk, Elastic, Datadog) with enrichment and formatting. Alerting via Slack, email, PagerDuty, SNS, webhooks. | `packages/platform-core/src/observability/metrics.ts`, `src/security/siem/`, `src/security/alerting/` | Implemented |
| SI-7 | Software, Firmware, and Information Integrity | Hash chain provides tamper detection: each proof event's SHA-256 hash incorporates the previous event's hash. `verifyChainWithDetails()` validates the entire chain. Ed25519 signatures provide authenticity. Combined verification via `verifyChainAndSignatures()`. | `packages/proof-plane/src/events/hash-chain.ts`, `packages/proof-plane/src/events/event-signatures.ts` | Implemented |
| SI-10 | Information Input Validation | Agent manifest validated via Zod schemas (`agentManifestSchema`): agentId min(1), capabilityLevel int min(0) max(7), trustScore min(0) max(1000). CAR format validation via regex. Policy rule conditions validated before evaluation. | `packages/basis/src/validation-gate.ts` | Implemented |
| SI-16 | Memory Protection | Secure memory module for handling sensitive data in memory. TEE (Trusted Execution Environment) support for production and development environments. | `src/security/secure-memory.ts`, `src/security/tee.ts`, `src/security/tee-production.ts` | Implemented |
| SI-AI-1 (proposed) | AI Output Integrity | Proof Plane logs `ExecutionCompletedPayload` with `outputHash` (hash of execution output). Output filter in AI governance module. Bias detection module. Trust scoring penalizes failed executions via tier-scaled penalty (7–10x positive signal rate). | `packages/proof-plane/src/proof-plane/proof-plane.ts`, `src/security/ai-governance/output-filter.ts`, `src/security/ai-governance/bias-detection.ts` | Implemented |

---

## 5. Use Case 4: Multi-Agent Systems

Use Case 4 addresses controls specific to agent-to-agent interactions, where multiple AI agents collaborate, delegate, or communicate. Vorion implements a comprehensive A2A protocol with trust negotiation, chain-of-trust tracking, delegation verification, and cross-agent attestation.

### 5.1 A2A Trust Negotiation

**Source:** `packages/platform-core/src/a2a/trust-negotiation.ts`

The `TrustNegotiationService` implements bidirectional trust verification:

| Control Aspect | Implementation |
|---------------|----------------|
| **Caller verification** | `verifyCallerTrust()` checks: agent exists and is active, trust context matches actual trust, trust proof validity (HMAC signature, expiration, ACI match), delegation chain validity, chain-of-trust floor, minimum tier/score requirements, required capabilities. |
| **Mutual negotiation** | `negotiate()` verifies both caller and callee meet each other's requirements. Agreed requirements take the stricter of each parameter (higher minTier, intersection of capabilities, lower maxChainDepth). |
| **Trust proofs** | `generateTrustProof()` creates time-limited cryptographic proofs (HMAC-SHA256 signed) containing ACI, tier, score, issuedAt, expiresAt, registry. Validity period configurable via `TRUST_PROOF_VALIDITY_SEC`. |
| **Delegation** | `verifyDelegation()` validates: delegate ACI match, expiration, uses remaining, allowed/blocked target lists, time restrictions, delegation chain length limits, delegator trust sufficiency. |

### 5.2 Chain-of-Trust Tracking

**Source:** `packages/platform-core/src/a2a/chain-of-trust.ts`

The `ChainOfTrustService` tracks nested agent-to-agent call chains:

| Control Aspect | Implementation |
|---------------|----------------|
| **Chain management** | `startChain()`, `addLink()`, `completeChain()`, `failChain()` manage full chain lifecycle. Active chains tracked in memory with state (active/completed/failed/expired). |
| **Trust inheritance** | Four modes: `minimum` (trust = min of all agents), `weighted` (recent links weighted higher), `caller_only` (last caller's trust), `root_only` (original initiator's trust). Default: minimum. |
| **Loop detection** | `validateLink()` checks for duplicate ACIs in chain, preventing circular agent-to-agent calls. Loop detections tracked in statistics. |
| **Depth limiting** | `MAX_CHAIN_DEPTH` enforced on every link addition. Depth violations counted. Chain context carries `maxDepth` for per-request limits. |
| **Staleness detection** | Chains older than 5 minutes flagged as stale. `cleanupExpiredChains()` expires chains exceeding configurable `maxAgeMs` (default 10 minutes). |
| **Trust floor** | Effective trust recalculated on each link addition. No agent in a chain can exercise capabilities above the chain's trust floor (minimum tier of all participants). |
| **Diagnostics** | `visualizeChain()` generates human-readable chain representation. `exportChain()` provides chain data, visualization, and validation result for analysis. `getStats()` returns aggregate metrics. |

### 5.3 Cross-Agent Attestation

**Source:** `packages/platform-core/src/a2a/attestation.ts`

The `A2AAttestationService` generates and processes attestations for every agent-to-agent interaction:

| Control Aspect | Implementation |
|---------------|----------------|
| **Attestation generation** | `generateAttestation()` produces records with: caller ACI, callee ACI, action, outcome (success/failure/timeout/rejected), response time, trust negotiation status, violations, chain depth, delegation usage. |
| **Trust impact** | `calculateTrustImpact()` computes bidirectional trust score changes. Callers: +1 for success, -1 for failure, -5 for rejection, bonus for deep chain coordination. Callees: +2 for successful service, +1 for fast response (<100ms), -2 for failure, -5 for timeout. |
| **Batch processing** | Attestations batched (configurable size, default 50) and flushed periodically (configurable interval, default 5s) for efficient processing. Callbacks registered for downstream processing. |
| **Analytics** | `generateAnalytics()` produces per-agent statistics: caller/callee breakdown by outcome, top interaction partners, average response time, overall success rate. |
| **Violation tracking** | Violations extracted from response payloads (TRUST_INSUFFICIENT, CAPABILITY_DENIED) and recorded in attestation data. |

### 5.4 Use Case 4 Control Family Mapping

| Control | Description | Multi-Agent Implementation | Source | Status |
|---------|-------------|---------------------------|--------|--------|
| AC-4 (MA) | Inter-Agent Information Flow | Trust negotiation enforces minimum trust tiers for inter-agent communication. Delegation tokens scope allowed targets, blocked targets, time restrictions, and rate limits. | `packages/platform-core/src/a2a/trust-negotiation.ts` | Implemented |
| AC-17 (MA) | Agent Remote Invocation | A2A protocol requires trust proof exchange before invocation. mTLS optionally required (`requireMtls` in trust requirements). Required attestations and capabilities verified pre-invocation. | `packages/platform-core/src/a2a/trust-negotiation.ts` | Implemented |
| AU-2 (MA) | Cross-Agent Audit | Every A2A interaction generates an attestation record: callerAci, calleeAci, action, outcome, chain depth, trust floor, chain links, timestamp, callee signature. Root request ID links nested calls. | `packages/platform-core/src/a2a/attestation.ts` | Implemented |
| AU-10 (MA) | Multi-Agent Non-repudiation | Trust proofs cryptographically signed (HMAC-SHA256). Attestation records include callee signatures. Chain context carries full link history with per-link ACI, tier, score, action, timestamp, and requestId. | `packages/platform-core/src/a2a/trust-negotiation.ts`, `packages/platform-core/src/a2a/attestation.ts` | Implemented |
| CA-9 (MA) | Agent-to-Agent Connections | Trust negotiation validates both parties. Chain-of-trust service validates chain context (depth, loops, trust floor consistency). Bidirectional requirements merging ensures both parties' security requirements are met. | `packages/platform-core/src/a2a/chain-of-trust.ts`, `packages/platform-core/src/a2a/trust-negotiation.ts` | Implemented |
| CM-2 (MA) | Agent Coordination Baseline | Agent registry provides registered profiles with approved capabilities and domains. A2A trust requirements define minimum tier, required capabilities, required attestations, and max chain depth for each callee. | `packages/platform-core/src/agent-registry/service.ts`, `packages/platform-core/src/a2a/types.ts` | Implemented |
| IA-2 (MA) | Inter-Agent Authentication | ACI (Agent Classification Identifier) uniquely identifies agents in A2A calls. Trust proofs include ACI, tier, score, and HMAC signature. Delegation tokens carry delegator/delegate ACIs with cryptographic binding. | `packages/platform-core/src/a2a/trust-negotiation.ts` | Implemented |
| IA-8 (MA) | Cross-Organization Agent Identity | Cross-org communication (CAP-CROSS-ORG at T6+) requires federation approval. Trust proofs include registry identifier for organizational attribution. Cross-org messages constrained to encrypted channels. | `packages/basis/src/trust-capabilities.ts` | Implemented |
| IR-AI-2 (proposed) | Multi-Agent Incident | Chain-of-trust failure causes chain state to transition to 'failed'. Failed chains logged with reason, depth, and all links. Trust impact propagated to both caller and callee. Agent quarantine available for compromised agents. | `packages/platform-core/src/a2a/chain-of-trust.ts`, `packages/platform-core/src/agent-registry/service.ts` | Implemented |
| RA-3 (MA) | Multi-Agent Risk | Chain trust floor prevents privilege escalation through agent chains. Delegation tokens constrain maximum tier, allowed targets, time windows, and usage counts. Significant trust drops between links generate warnings. | `packages/platform-core/src/a2a/trust-negotiation.ts`, `packages/platform-core/src/a2a/chain-of-trust.ts` | Implemented |
| SC-7 (MA) | Agent Boundary Protection | Trust tier gating: agent communication starts at T4 (CAP-AGENT-COMMUNICATE with approved agents, message size limits, rate limiting). Delegation at T5. Spawning at T6. Cross-org at T6. Full lifecycle management at T7. | `packages/basis/src/trust-capabilities.ts` | Implemented |
| SI-AI-2 (proposed) | Multi-Agent Integrity | Chain-of-trust validation ensures: no loops, depth within bounds, trust floor consistency, no stale chains. Attestation violation tracking detects trust-insufficient and capability-denied responses. | `packages/platform-core/src/a2a/chain-of-trust.ts`, `packages/platform-core/src/a2a/attestation.ts` | Implemented |

---

## 6. Coverage Summary

### 6.1 Use Case 3 -- Single Agent Systems

| Control Family | Controls Mapped | Coverage | Key Components |
|---------------|----------------|----------|----------------|
| **AC** (Access Control) | AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-17, AC-24 | **Strong** | Validation Gate, Policy Engine, Trust Capabilities, Agent Registry |
| **AU** (Audit) | AU-1, AU-2, AU-3, AU-6, AU-8, AU-9, AU-10, AU-12 | **Strong** | Proof Plane, Hash Chain, Ed25519 Signatures, Event Store |
| **CA** (Assessment) | CA-2, CA-5, CA-7, CA-9 | **Strong** | Trust Factors, Trust Oracle, Anomaly Detection, Observability |
| **CM** (Configuration) | CM-1, CM-2, CM-3, CM-5, CM-6, CM-7, CM-8 | **Strong** | Policy Engine (versioned), Agent Manifests, Capability Taxonomy |
| **IA** (Identification) | IA-1, IA-2, IA-3, IA-4, IA-5, IA-8 | **Strong** | CAR IDs, Ed25519/HMAC-SHA256, HSM, Key Rotation, WebAuthn |
| **IR** (Incident Response) | IR-1, IR-4, IR-5, IR-6, IR-8 | **Strong** | Incident System, Playbooks, Anomaly Detectors, Alert Rules |
| **RA** (Risk Assessment) | RA-1, RA-3, RA-5, RA-7 | **Strong** | Trust Scoring, Intent Classification, Vulnerability Monitoring |
| **SA** (System Acquisition) | SA-4, SA-9, SA-10, SA-11 | **Moderate** | Agent Registry, Compliance Evidence Pipeline |
| **SC** (Sys/Comms Protection) | SC-3, SC-7, SC-8, SC-12, SC-13, SC-28 | **Strong** | Sandboxing, DLP, HSM, Post-Quantum Crypto, TEE |
| **SI** (Sys/Info Integrity) | SI-1, SI-3, SI-4, SI-7, SI-10, SI-16 | **Strong** | Hash Chains, Injection Detection, Prompt Injection Defense, Monitoring |

### 6.2 Use Case 4 -- Multi-Agent Systems

| Control Area | Controls Mapped | Coverage | Key Components |
|-------------|----------------|----------|----------------|
| **Inter-Agent Access** | AC-4(MA), AC-17(MA) | **Strong** | Trust Negotiation, Delegation Tokens |
| **Cross-Agent Audit** | AU-2(MA), AU-10(MA) | **Strong** | A2A Attestation, Chain-of-Trust Tracking |
| **Agent Connection Validation** | CA-9(MA) | **Strong** | Bidirectional Trust Verification |
| **Coordination Baseline** | CM-2(MA) | **Strong** | Agent Registry Profiles, Trust Requirements |
| **Inter-Agent Identity** | IA-2(MA), IA-8(MA) | **Strong** | ACI, Trust Proofs, Federation |
| **Multi-Agent Incident** | IR-AI-2 | **Strong** | Chain Failure Handling, Agent Quarantine |
| **Multi-Agent Risk** | RA-3(MA) | **Strong** | Chain Trust Floor, Delegation Constraints |
| **Agent Boundaries** | SC-7(MA) | **Strong** | Tiered Agent Communication, Cross-Org Gating |
| **Multi-Agent Integrity** | SI-AI-2 | **Strong** | Loop Detection, Chain Validation, Violation Tracking |

### 6.3 Overall Coverage Matrix

```
Control Family    UC3 Coverage    UC4 Coverage    Overall
-----------------------------------------------------------------
AC                  ████████░░       ████████░░     Strong
AU                  ██████████       ██████████     Strong
CA                  ████████░░       ████████░░     Strong
CM                  ████████░░       ████████░░     Strong
IA                  ████████░░       ████████░░     Strong
IR                  ████████░░       ████████░░     Strong
RA                  ████████░░       ████████░░     Strong
SA                  ██████░░░░       ████░░░░░░     Moderate
SC                  ████████░░       ████████░░     Strong
SI                  ██████████       ████████░░     Strong

Legend: █ = Implemented   ░ = Partial/Planned
```

---

## 7. Gaps and Remediation Plan

### 7.1 Identified Gaps

| ID | Control | Gap Description | Severity | Remediation |
|----|---------|----------------|----------|-------------|
| G-1 | SA-12 (Supply Chain Protection) | No formal third-party agent vetting process beyond registry validation. No software bill of materials (SBOM) for agent dependencies at runtime. | Medium | Implement agent SBOM requirements in CAR manifest. Add third-party agent certification workflow. Target: Q2 2026. |
| G-2 | SA-15 (Development Process) | Agent development lifecycle controls are configuration-dependent. No enforced secure development requirements for agents registering in the platform. | Medium | Add minimum security attestation requirements for agent registration. Define secure agent development checklist. Target: Q2 2026. |
| G-3 | AU-9(1) (Audit Storage Protection -- Hardware) | Hash chain and signatures protect integrity, but audit storage is currently in-memory (default) or application-managed. No hardware-backed immutable storage integration. | Medium | Integrate with append-only ledger services (e.g., Amazon QLDB, Azure Confidential Ledger). CHAIN layer in BASIS spec already contemplates this. Target: Q3 2026. |
| G-4 | IR-10 (Integrated Security Analysis) | Incident response and trust scoring are separate systems. Incident outcomes do not automatically feed into trust score adjustments. | Low | Wire incident resolution outcomes into trust engine as attestation signals. Target: Q2 2026. |
| G-5 | SC-38 (Operations Security) | No formal OPSEC controls for agent operational patterns that could reveal organizational capabilities. | Low | Add operational pattern obfuscation for sensitive agent activities. Target: Q3 2026. |
| G-6 | CA-8 (Penetration Testing) | No automated adversarial testing of agent governance boundaries (e.g., fuzzing trust negotiation, attempting privilege escalation through delegation chains). | Medium | Develop governance boundary penetration testing suite. Include in CI/CD pipeline. Target: Q2 2026. |
| G-7 | AC-4(MA) -- Rate Limiting Enforcement | Trust requirements include `maxChainDepth` and delegation constraints, but per-agent A2A rate limiting is defined in capability constraints ("Rate limited") without a concrete implementation in the A2A protocol layer. | Medium | Implement A2A rate limiter middleware using the existing rate-limiter pattern from `src/security/ai-governance/rate-limiter.ts`. Target: Q2 2026. |

### 7.2 Remediation Priority

| Priority | Items | Target |
|----------|-------|--------|
| **P1 -- High** | G-6 (Governance penetration testing), G-7 (A2A rate limiting) | Q2 2026 |
| **P2 -- Medium** | G-1 (Agent SBOM), G-2 (Secure dev requirements), G-3 (Hardware audit storage) | Q2-Q3 2026 |
| **P3 -- Low** | G-4 (Incident-trust integration), G-5 (OPSEC) | Q3 2026 |

---

## 8. Recommendations to NIST

Based on our experience building and operating an AI governance platform, we respectfully recommend the following additions to the COSAiS framework:

### 8.1 Agent Identity Controls (IA Family)

**Recommendation:** Define a standard agent identification scheme analogous to X.509 certificates for traditional systems. Current controls assume human users or static systems. Agent identification requires:

- **Structured agent identifiers** encoding organization, classification, capability domains, and capability level (similar to the CAR format: `registry.org.class:DOMAINS-Ln@version`).
- **Agent attestation lifecycle** -- agents should carry cryptographic attestations from their registry that can be verified by any interacting party.
- **Trust portability** -- mechanisms for sharing trust assessments across organizational boundaries with cryptographic backing.

### 8.2 Graduated Trust Controls (AC Family)

**Recommendation:** Extend AC controls for AI agents beyond binary allow/deny:

- **Quantified trust scoring** (0-1000 or similar scale) with defined capability tiers that unlock progressively.
- **Trust decay for inactive agents** to prevent stale high-trust entities.
- **Amplified negative signals** -- failures should reduce trust more than successes increase it (e.g., 3:1 ratio) to incentivize reliable behavior.
- **Trust evaluation factors** -- define categories of assessment (competence, reliability, safety, transparency, accountability, security, privacy, identity, observability) with measurement criteria.

### 8.3 Multi-Agent Chain-of-Trust Controls

**Recommendation:** Add dedicated controls for nested agent-to-agent call chains:

- **Chain depth limits** -- define maximum nesting depth for agent-to-agent calls to prevent unbounded recursion.
- **Trust floor enforcement** -- effective trust in a chain must not exceed the minimum trust of any participant (weakest-link principle).
- **Loop detection** -- prevent circular agent-to-agent calls that could create infinite loops or amplification attacks.
- **Delegation scoping** -- delegation tokens must have bounded capabilities, time limits, usage counts, and target restrictions.
- **Trust inheritance modes** -- define standard policies for how trust propagates through agent chains (minimum, weighted, caller-only, root-only).

### 8.4 Governance-Before-Execution Controls (SI Family)

**Recommendation:** Establish a control requiring governance evaluation before any autonomous agent action:

- **Pre-execution validation gates** -- every agent action must pass through a validation layer before execution.
- **Default-deny posture** -- agents must have explicit permission (via trust tier and capability gating) for every action category.
- **Escalation as a decision outcome** -- beyond allow/deny, AI systems should support escalation to human oversight and graceful degradation of capability.

### 8.5 Cryptographic Audit Trail Controls (AU Family)

**Recommendation:** Strengthen audit requirements for AI systems:

- **Hash-chained audit trails** -- each audit event must incorporate the hash of the previous event, creating a tamper-evident chain.
- **Cryptographic signatures on audit events** -- Ed25519 or equivalent digital signatures for non-repudiation.
- **Separate signing keys per subsystem** -- isolate signing authority to prevent compromise of one subsystem from invalidating the entire audit trail.
- **Combined chain + signature verification** -- standard procedures for verifying both chain integrity and individual event authenticity.

### 8.6 Agent Sandboxing Controls (SC Family)

**Recommendation:** Define standard sandboxing tiers for AI agents:

- **Observation-only tier** -- new agents limited to read-only access to public data and response generation.
- **Progressive capability unlocking** -- capabilities granted incrementally based on demonstrated trustworthiness.
- **Shadow mode for new agents** -- actions by untrusted agents recorded but requiring human verification before counting toward trust assessment.
- **Resource constraints per tier** -- explicit limits on compute, memory, network, and time for each trust level.

### 8.7 AI-Specific Incident Response Controls (IR Family)

**Recommendation:** Add controls for AI agent incident response:

- **Agent circuit breakers** -- automated mechanisms to quarantine, suspend, or revoke agents exhibiting anomalous behavior.
- **Trust score suspension** -- policy violations should immediately impact trust scores with defined penalty scales.
- **Multi-agent incident correlation** -- when incidents involve agent chains, the response system should trace the full chain-of-trust to identify the root cause agent.
- **Automated playbooks for AI incidents** -- define standard playbook patterns for compromised agents, trust boundary violations, prompt injection, and data exfiltration.

---

## Appendix A: Source Code References

| Component | Primary Source Path | Lines of Code (approx.) |
|-----------|-------------------|------------------------|
| Validation Gate | `packages/basis/src/validation-gate.ts` | ~660 |
| Trust Factors | `packages/basis/src/trust-factors.ts` | ~395 |
| Trust Capabilities | `packages/basis/src/trust-capabilities.ts` | ~520 |
| Policy Engine | `src/enforce/policy-engine.ts` | ~1,050 |
| Proof Plane | `packages/proof-plane/src/proof-plane/proof-plane.ts` | ~690 |
| Hash Chain | `packages/proof-plane/src/events/hash-chain.ts` | ~100+ |
| Event Signatures | `packages/proof-plane/src/events/event-signatures.ts` | ~100+ |
| A2A Trust Negotiation | `packages/platform-core/src/a2a/trust-negotiation.ts` | ~615 |
| Chain of Trust | `packages/platform-core/src/a2a/chain-of-trust.ts` | ~600 |
| A2A Attestation | `packages/platform-core/src/a2a/attestation.ts` | ~525 |
| Agent Registry | `packages/platform-core/src/agent-registry/service.ts` | ~500+ |
| Anomaly Detection | `src/security/anomaly/` (7 detectors) | ~2,000+ |
| Incident Response | `src/security/incident/` (8 playbooks + executor) | ~3,000+ |
| Injection Detection | `src/security/injection-detector.ts` | ~500+ |
| Prompt Injection Defense | `src/security/ai-governance/prompt-injection.ts` | ~300+ |
| DLP Scanner | `src/security/dlp/scanner.ts` | ~300+ |
| HSM Integration | `src/security/hsm/` (6 providers) | ~1,500+ |
| Post-Quantum Crypto | `src/security/crypto/post-quantum/` | ~500+ |
| Observability Metrics | `packages/platform-core/src/observability/metrics.ts` | ~200+ |
| SIEM Integration | `src/security/siem/` (3 connectors) | ~800+ |

## Appendix B: Standards Cross-Reference

| Standard | Relevant Vorion Document |
|----------|--------------------------|
| NIST SP 800-53 Rev. 5 | This document |
| NIST AI RMF | `docs/spec/BASIS-COMPLIANCE-MAPPING.md` Section 8 |
| NIST Cyber AI Profile (IR 8596) | `docs/nist-cyber-ai-profile-comment-2026-01.md` |
| SOC 2 Type II | `docs/spec/BASIS-COMPLIANCE-MAPPING.md` Section 2 |
| ISO 27001:2022 | `docs/spec/BASIS-COMPLIANCE-MAPPING.md` Section 3 |
| EU AI Act | `docs/spec/BASIS-COMPLIANCE-MAPPING.md` Section 7 |
| GDPR | `docs/spec/BASIS-COMPLIANCE-MAPPING.md` Section 4 |
| BASIS Specification | `docs/spec/BASIS-SPECIFICATION.md` |
| BASIS Threat Model | `docs/spec/BASIS-THREAT-MODEL.md` |

---

*Copyright 2026 Vorion. Prepared for the NIST CAISI RFI submission (deadline March 9, 2026). This document may be shared with NIST staff and reviewers.*
