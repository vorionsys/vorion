# OWASP Top 10 for Agentic Applications (ASI01-ASI10) -- Vorion Platform Mapping

| Field | Value |
|---|---|
| **Document ID** | VORION-COMP-ASI-2026-001 |
| **Version** | 1.0.0 |
| **Status** | DRAFT -- Pending Internal Review |
| **Classification** | CONFIDENTIAL -- NIST CAISI Submission Material |
| **Date** | 2026-02-11 |
| **Author** | Vorion Security Engineering |
| **Applicable Standard** | OWASP Top 10 for Agentic Applications (December 2025) |
| **Platform Version** | Vorion v6.x (Phase 6) |
| **Review Cycle** | Quarterly |
| **Next Review** | 2026-05-11 |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Platform Architecture Overview](#2-platform-architecture-overview)
3. [ASI01: Agentic Excessive Agency](#3-asi01-agentic-excessive-agency)
4. [ASI02: Inadequate Sandboxing](#4-asi02-inadequate-sandboxing)
5. [ASI03: Tool Misuse](#5-asi03-tool-misuse)
6. [ASI04: Unsafe Code Generation](#6-asi04-unsafe-code-generation)
7. [ASI05: Fragmented Context Integrity](#7-asi05-fragmented-context-integrity)
8. [ASI06: Cross-Agent Trust Exploitation](#8-asi06-cross-agent-trust-exploitation)
9. [ASI07: Memory & Context Poisoning](#9-asi07-memory--context-poisoning)
10. [ASI08: Opaque Agentic Chains](#10-asi08-opaque-agentic-chains)
11. [ASI09: Misaligned Agent Cascades](#11-asi09-misaligned-agent-cascades)
12. [ASI10: Insufficient Human Oversight](#12-asi10-insufficient-human-oversight)
13. [Summary Coverage Matrix](#13-summary-coverage-matrix)
14. [Gaps and Remediation Roadmap](#14-gaps-and-remediation-roadmap)
15. [Appendix A: File Reference Index](#15-appendix-a-file-reference-index)
16. [Appendix B: Methodology](#16-appendix-b-methodology)

---

## 1. Executive Summary

This document provides a formal mapping between the OWASP Top 10 for Agentic Applications (ASI01 through ASI10, published December 2025) and the security controls implemented within the Vorion AI Governance Platform. Vorion implements the Behavioral Agent Standard for Integrity and Safety (BASIS) specification, a multi-layered governance framework purpose-built for constraining autonomous AI agent behavior.

Vorion's security posture against the OWASP ASI risks is grounded in six core architectural layers: INTENT (goal processing and risk assessment), BASIS (rule engine for constraint evaluation), ENFORCE (policy decision point), COGNIGATE (constrained execution runtime), PROOF (immutable evidence chain using SHA-256 hash chains, Ed25519 digital signatures, and Merkle trees), and TRUST ENGINE (behavioral trust scoring across an 8-tier model, T0 through T7, with scores from 0 to 1000).

**Overall Assessment:**

- **7 of 10** ASI risks have **Implemented** controls with functional code in the repository.
- **2 of 10** ASI risks have **Partial** implementations with core infrastructure present but specific sub-controls still in development.
- **1 of 10** ASI risks has controls that are **Planned** with architectural provisions but limited runtime code.

This mapping was produced by direct inspection of the Vorion source code (v6.x, Phase 6) and reflects the state of implementation as of 2026-02-11.

---

## 2. Platform Architecture Overview

```
    +-------------------------------------------------------------------+
    |                        VORION PLATFORM                            |
    |                                                                   |
    |  +-----------+    +---------+    +---------+    +------------+    |
    |  |  INTENT   | -> |  BASIS  | -> | ENFORCE | -> | COGNIGATE  |   |
    |  | Goal Proc |    | Rule    |    | Policy  |    | Constrained|   |
    |  | Risk Eval |    | Engine  |    | Decision|    | Execution  |   |
    |  +-----------+    +---------+    +---------+    +------------+   |
    |       |               |               |               |          |
    |       v               v               v               v          |
    |  +-----------------------------------------------------------+   |
    |  |                    PROOF PLANE                             |   |
    |  |  SHA-256 Hash Chain | Ed25519 Signatures | Merkle Trees   |   |
    |  +-----------------------------------------------------------+   |
    |       |                                                          |
    |       v                                                          |
    |  +-----------------------------------------------------------+   |
    |  |                   TRUST ENGINE                             |   |
    |  |  T0-T7 Tiers | 23 Factors | 0-1000 Score | Capabilities  |   |
    |  +-----------------------------------------------------------+   |
    |                                                                   |
    |  Supporting: Agent Registry | A2A Trust Negotiation | Security   |
    |              Observability  | Containment           | Alerting   |
    +-------------------------------------------------------------------+
```

---

## 3. ASI01: Agentic Excessive Agency

### Risk Description

An AI agent performs actions beyond its intended scope, accesses resources it should not, or exercises authority disproportionate to its trust level. This includes privilege escalation, unauthorized capability usage, and scope creep during autonomous operation.

### Vorion Controls

| Control | Implementation | Source File(s) |
|---|---|---|
| **8-Tier Trust-Gated Capabilities** | Each trust tier (T0-T7) unlocks a specific, enumerated set of capabilities. Agents at T0 (Sandbox) have 3 capabilities (read public data, generate text, observe metrics). Capabilities expand progressively: T3 adds sandboxed code execution, T4 adds cross-agent communication, T6 adds agent spawning. Each capability includes explicit constraints (e.g., "No PII access," "Rate limited," "Approved directories only"). | `packages/basis/src/trust-capabilities.ts` |
| **Validation Gate (PASS/REJECT/ESCALATE)** | Every agent manifest is validated against registered profiles before execution. The gate checks: schema validity, CAR format compliance, organization/class matching, capability level ceilings, domain authorization, and trust tier sufficiency. Unauthorized capability requests are denied or escalated. | `packages/basis/src/validation-gate.ts` |
| **Trust Score Calculation with Factor Minimums** | Trust scores are computed across 23 weighted factors (15 core + 8 life-critical). Each factor has a minimum score threshold of 0.5. Missing or below-threshold factors cause compliance failure. Tier thresholds are strictly defined (e.g., T4 requires score >= 650). | `packages/basis/src/trust-factors.ts` |
| **Constraint Evaluator with Rate Limiting and Resource Caps** | Runtime constraints enforce rate limits per entity/tenant/action, resource consumption caps (concurrent and total), time window restrictions, and dependency requirements. Violations trigger deny actions with short-circuit evaluation. | `src/enforce/constraint-evaluator.ts` |
| **Policy Engine with Deny-Overrides** | Enforcement policies are evaluated in priority order. Deny actions override all other outcomes. Policies support trust-level conditions, action patterns, resource patterns, and time-based restrictions. | `src/enforce/policy-engine.ts` |
| **Progressive Containment** | Six graduated containment levels (full_autonomy, monitored, tool_restricted, human_in_loop, simulation_only, read_only, halted) with automatic escalation paths. The "halted" level terminates all sessions and blocks all operations. | `packages/atsf-core/src/containment/index.ts` |

### Implementation Status: **Implemented**

### Evidence

- `trust-capabilities.ts` defines 35 capabilities across 8 tiers with explicit `unlockTier` gates and per-capability `constraints[]`.
- `validation-gate.ts` implements `validateAgent()` with 7 validation stages including schema validation via Zod, CAR format parsing, profile matching, trust tier verification, and capability-against-tier cross-referencing.
- `constraint-evaluator.ts` implements `ConstraintEvaluator.evaluateAll()` with 5 constraint types and composite logic (AND/OR/NOT).
- `containment/index.ts` implements `ContainmentService.checkAction()` which intercepts all operations against current containment restrictions.

---

## 4. ASI02: Inadequate Sandboxing

### Risk Description

Agents operate without sufficient isolation, allowing them to access host systems, other agents' resources, or data outside their authorized scope. Sandbox escapes enable agents to bypass security boundaries.

### Vorion Controls

| Control | Implementation | Source File(s) |
|---|---|---|
| **T0_SANDBOX Trust Tier** | All newly registered agents start at T0_SANDBOX (trust score 0-199) with the most restrictive capability set: read-only public data access, text response generation, and system metrics observation only. No external access, no file writes, no code execution. | `packages/basis/src/trust-factors.ts` (lines 13, 287), `packages/basis/src/trust-capabilities.ts` (lines 44-72) |
| **Progressive Capability Unlock** | Agents must earn higher trust scores through successful attestations before gaining capabilities. Write access requires T2 (score >= 350), database writes require T3 (score >= 501), external API access requires T2+ with approved domains only. | `packages/basis/src/trust-capabilities.ts` |
| **Containment Levels with Hard Restrictions** | The containment system supports granular restriction types: `capability_blocked`, `approval_required`, `logging_enhanced`, and session termination. Restrictions have `severity: 'hard'` (non-bypassable) enforcement. | `packages/atsf-core/src/containment/index.ts` (lines 66-143) |
| **Shadow Mode for T0 Agents** | The Proof Plane supports `shadowMode` configuration ('shadow', 'testnet', 'production') where T0 agent events require Human-in-the-Loop (HITL) verification before counting toward production trust scores. | `packages/proof-plane/src/proof-plane/proof-plane.ts` (lines 79-88, 603-676) |
| **Observability: Sandbox Metrics** | Prometheus metrics track sandbox container lifecycle: `sandboxContainersCreated`, `sandboxContainersActive`, `sandboxContainerDuration`, `capabilityRequests`, `networkPolicyViolations`, `filesystemPolicyViolations`, `sandboxResourceUsage`. | `packages/platform-core/src/observability/index.ts` (lines 44-50) |
| **Agent Registry Lifecycle Enforcement** | Agents begin at `T0_SANDBOX` state. Progression to T1 requires human approval. Quarantine, suspension, revocation, and expulsion states provide graduated isolation. 3 quarantines in 30 days triggers automatic suspension. | `packages/platform-core/src/agent-registry/service.ts` (lines 72-109, 797-846) |

### Implementation Status: **Implemented**

### Evidence

- Agent registry `registerAgent()` hard-codes initial state to `T0_SANDBOX` with `trustScore: 0` and `trustTier: 0` (service.ts, lines 237-254).
- HUMAN_APPROVAL_GATES array mandates human approval for T0->T1, T4->T5, T5->T6, and T6->T7 transitions (service.ts, lines 103-109).
- ProofPlane constructor initializes shadow mode support and provides `getUnverifiedShadowEvents()` and `verifyShadowEvent()` methods for HITL workflows.
- ContainmentService.checkAction() returns `{ allowed: false }` for all operations when entity is at `halted` level.

---

## 5. ASI03: Tool Misuse

### Risk Description

Agents invoke tools or APIs in unintended ways, use tools with malicious parameters, chain tool calls to achieve unauthorized outcomes, or exploit tool capabilities beyond their design intent.

### Vorion Controls

| Control | Implementation | Source File(s) |
|---|---|---|
| **Tool Registry Gating by Trust Tier** | Each capability definition includes an explicit `tools[]` array enumerating which tools are available at that tier. `getToolsForTier()` returns only the tools unlocked at or below the agent's current tier. T3 adds `invoke_tool` and `list_tools` capabilities with constraints: "Registry tools only," "Version pinned," "Audit logged." | `packages/basis/src/trust-capabilities.ts` (lines 199-207, 453-462) |
| **Intent Risk Assessment** | The Intent Classifier performs rule-based risk assessment on every submitted intent. Risk factors include: action type base score (0-100), resource sensitivity modifiers, historical pattern adjustments (failure rate +15, first-time action +10), and parameter-based adjustments (bulk operations +20, cross-tenant +25, elevated privilege +15). | `packages/platform-core/src/intent/classifier/risk.ts` |
| **Prompt Injection Defense** | Dedicated prompt injection detection with configurable sensitivity levels (low/medium/high), context overflow detection, encoding attack detection, custom pattern matching, and block-on-detection enforcement. | `packages/platform-core/src/security/ai-governance/prompt-injection.ts` |
| **Output Filtering** | AI model outputs are filtered for PII (email, phone, SSN patterns with regex matching), sensitive data patterns, hallucination indicators, and custom validation rules. PII redaction is applied before output delivery. | `packages/platform-core/src/security/ai-governance/output-filter.ts` |
| **Constraint-Based Tool Parameter Validation** | The Constraint Evaluator enforces rate limits per tool invocation key, resource caps on concurrent/total usage, and dependency constraints requiring prerequisite intents to complete before tool access. | `src/enforce/constraint-evaluator.ts` |

### Implementation Status: **Implemented**

### Evidence

- `trust-capabilities.ts` explicitly lists `tools: ['invoke_tool', 'list_tools']` at T3 with constraints `['Registry tools only', 'Version pinned', 'Audit logged']`.
- `hasCapability()` function performs runtime checks: `getCapabilitiesForTier(agentTier).some(cap => cap.code === capabilityCode)`.
- `prompt-injection.ts` implements `InjectionDetectionConfig` with `enableContextOverflowDetection` and `enableEncodingAttackDetection` flags.
- `output-filter.ts` implements `DEFAULT_PII_PATTERNS` array with type-specific regex patterns and redaction functions.

---

## 6. ASI04: Unsafe Code Generation

### Risk Description

Agents generate or execute code that is insecure, malicious, or contains vulnerabilities. This includes injection of malicious code, generation of code with known vulnerability patterns, and execution of unvalidated generated code.

### Vorion Controls

| Control | Implementation | Source File(s) |
|---|---|---|
| **Sandboxed Code Execution Capability** | Code execution is gated behind T3 trust tier (score >= 501) with explicit constraints: "Sandboxed," "Time limited," "Memory limited," "No network." The capability code `CAP-CODE-SANDBOX` is only available to agents that have demonstrated sufficient competence, reliability, and safety. | `packages/basis/src/trust-capabilities.ts` (lines 183-188) |
| **Simulation-Only Containment** | The containment system includes a `simulation_only` level where "Actions are simulated only -- no real execution." This applies to agents whose trust has been degraded, allowing code generation to be reviewed without real-world effects. | `packages/atsf-core/src/containment/index.ts` (lines 102-110) |
| **Output Filtering for Generated Content** | Output filter with hallucination detection indicators, confidence thresholds, and custom validation rules can be applied to agent-generated code before it enters any execution pipeline. | `packages/platform-core/src/security/ai-governance/output-filter.ts` |
| **Intent Classification for Code Operations** | Code-related intents (e.g., `code:execute`, `code:generate`) receive elevated risk scores through the action pattern classification system, triggering additional scrutiny and potential escalation. | `packages/platform-core/src/intent/classifier/risk.ts`, `packages/platform-core/src/intent/classifier/patterns.ts` |

### Implementation Status: **Partial**

### Gaps

- **Static analysis integration**: No automated static analysis (SAST) is currently integrated into the code execution pipeline to scan generated code before execution.
- **Code vulnerability pattern matching**: The output filter provides general-purpose pattern matching but lacks a dedicated code vulnerability signature database (e.g., SQL injection patterns, path traversal, deserialization flaws).
- **Sandboxed execution runtime**: The `CAP-CODE-SANDBOX` capability is defined with constraints but the actual sandbox execution runtime (container isolation, syscall filtering, resource enforcement) is not fully implemented in the current codebase. The Prometheus metrics for sandbox containers (`sandboxContainersCreated`, `sandboxResourceUsage`) exist but the backing runtime implementation is incomplete.

---

## 7. ASI05: Fragmented Context Integrity

### Risk Description

Agent context becomes corrupted, inconsistent, or fragmented across multi-step operations, leading to decisions based on stale, incomplete, or manipulated context. This includes context window overflow, context injection across steps, and loss of decision provenance.

### Vorion Controls

| Control | Implementation | Source File(s) |
|---|---|---|
| **Immutable Hash Chain** | Every proof event in the Proof Plane contains a SHA-256 hash of its contents and a `previousHash` reference to the preceding event, forming a tamper-evident chain. `verifyChain()` validates both individual event hashes and chain link integrity across the full event sequence. | `packages/proof-plane/src/events/hash-chain.ts` |
| **Deterministic Serialization** | Both hash chain computation and Ed25519 signing use `sortObjectKeys()` for recursive key sorting before JSON serialization, ensuring deterministic representation regardless of property insertion order. | `packages/proof-plane/src/events/hash-chain.ts` (lines 59-71), `packages/proof-plane/src/events/event-signatures.ts` (lines 92-104) |
| **Correlation-Based Context Tracking** | Every proof event carries a `correlationId` that links related events across the intent lifecycle. The Proof Plane provides `getTrace(correlationId)` to reconstruct the full ordered sequence of events for any request. | `packages/proof-plane/src/proof-plane/proof-plane.ts` (lines 390-392) |
| **Intent Audit Trail** | The Intent system maintains a dedicated audit module that records intent creation, state transitions, decisions, and escalations with full context preservation. | `packages/platform-core/src/intent/audit.ts` |
| **Context Policy Enforcement** | The ATSF core trust engine includes context policy enforcement that applies policies based on current context state, preventing decisions from degraded or inconsistent context. | `packages/atsf-core/src/trust-engine/context-policy/enforcement.ts` |
| **Provenance Tracking** | Dedicated provenance module tracks the origin and transformation history of data and decisions throughout the pipeline. | `packages/atsf-core/src/phase6/provenance.ts`, `packages/atsf-core/src/provenance/index.ts` |

### Implementation Status: **Implemented**

### Evidence

- `computeEventHash()` in hash-chain.ts creates SHA-256 hashes over deterministically serialized event data including `eventId`, `eventType`, `correlationId`, `agentId`, `payload`, `previousHash`, `occurredAt`, `signedBy`, and `signature`.
- `verifyChain()` iterates events in order, calling both `verifyEventHash()` and `verifyChainLink()` for each, and reports the exact index and event ID where a break occurs.
- `ProofPlane.verifyCorrelationChain()` fetches events by correlation ID in ascending order and runs full chain verification.

---

## 8. ASI06: Cross-Agent Trust Exploitation

### Risk Description

A malicious or compromised agent exploits trust relationships to manipulate other agents, escalate privileges through delegation chains, impersonate trusted agents, or bypass security controls through agent-to-agent communication.

### Vorion Controls

| Control | Implementation | Source File(s) |
|---|---|---|
| **A2A Trust Negotiation** | Every agent-to-agent invocation requires bilateral trust verification. `verifyCallerTrust()` validates: caller existence and active state, trust context consistency, trust proof signature validity, delegation token verification (target restrictions, time restrictions, rate limits, chain length), and capability requirements. | `packages/platform-core/src/a2a/trust-negotiation.ts` |
| **Chain-of-Trust Floor Enforcement** | In nested A2A calls, effective trust is calculated as the minimum tier across all agents in the chain (default `minimum` inheritance mode). A T5 agent calling a T3 agent calling a T2 agent results in effective trust of T2 for the entire chain. The system also supports `weighted`, `caller_only`, and `root_only` modes. | `packages/platform-core/src/a2a/chain-of-trust.ts` (lines 404-451) |
| **Chain Depth Limits** | `MAX_CHAIN_DEPTH` system constant prevents unbounded nesting. Chain validation detects loops (same agent appearing twice), stale chains (> 5 minutes), and trust floor mismatches. | `packages/platform-core/src/a2a/chain-of-trust.ts` (lines 294-337) |
| **Delegation Token Constraints** | Delegation tokens are validated for: delegate ACI match, expiration, remaining uses, allowed/blocked target lists, time restrictions (hour-based), and chain length limits (`MAX_DELEGATION_CHAIN`). Delegators must have trust >= the `maxTier` they grant. | `packages/platform-core/src/a2a/trust-negotiation.ts` (lines 325-383) |
| **Trust Proof Generation and Verification** | Cryptographically signed trust proofs (HMAC-SHA256) with ACI binding, tier/score attestation, issuance timestamp, and configurable expiration (`TRUST_PROOF_VALIDITY_SEC`). Verification checks ACI match, expiration, and signature validity. | `packages/platform-core/src/a2a/trust-negotiation.ts` (lines 254-316) |
| **A2A Observability** | Prometheus metrics track: `a2aInvocationsTotal`, `a2aInvocationDuration`, `a2aChainDepth`, `a2aActiveChains`, `a2aTrustVerifications`, `a2aDelegationUsage`, `a2aCircuitBreakerStateChanges`. OpenTelemetry distributed tracing spans: `startA2ASpan`, `startA2AServerSpan`, `startTrustVerificationSpan`. | `packages/platform-core/src/observability/index.ts` |

### Implementation Status: **Implemented**

### Evidence

- `TrustNegotiationService.verifyCallerTrust()` implements an 8-step verification process with warnings and hard failures.
- `ChainOfTrustService.validateLink()` performs loop detection, depth checking, trust drop warnings, and staleness checks.
- `calculateEffectiveTrust()` implements 4 trust inheritance modes with the default `minimum` providing strongest cross-agent trust guarantees.
- `verifyDelegation()` checks 7 distinct conditions including target allowlists/blocklists and time-based restrictions.

---

## 9. ASI07: Memory & Context Poisoning

### Risk Description

Adversaries inject malicious content into agent memory, context windows, or persistent state to manipulate future decisions. This includes indirect prompt injection through stored data, training data poisoning, and manipulation of shared agent memory.

### Vorion Controls

| Control | Implementation | Source File(s) |
|---|---|---|
| **Prompt Injection Detection** | Multi-layered prompt injection defense with configurable sensitivity, strict mode, block-on-detection, context overflow detection, encoding attack detection, custom pattern matching, input length limits, and whitelisted pattern support. | `packages/platform-core/src/security/ai-governance/prompt-injection.ts` |
| **Output Filtering and PII Redaction** | Outbound content is filtered for PII, sensitive data patterns, and hallucination indicators before being stored or transmitted to other agents. This prevents poisoned outputs from propagating through the system. | `packages/platform-core/src/security/ai-governance/output-filter.ts` |
| **Immutable Proof Chain** | All events in the Proof Plane are hash-chained and optionally Ed25519-signed, preventing retroactive modification of the audit trail or decision history. Any tampering is detectable via `verifyChain()`. | `packages/proof-plane/src/events/hash-chain.ts`, `packages/proof-plane/src/events/event-signatures.ts` |
| **Trust Score Decay** | The trust engine implements decay profiles that reduce trust scores over time without positive attestations, limiting the impact window of any poisoned state. | `packages/atsf-core/src/trust-engine/decay-profiles.ts` |
| **Attestation-Based Trust** | Trust scores are modified only through the attestation system with type-specific multipliers (BEHAVIORAL: 1.0x, CREDENTIAL: 1.5x, AUDIT: 2.0x, A2A: 1.2x, MANUAL: 0.8x). Failed attestations have -10 base impact vs. +5 for success, creating asymmetric penalties for bad behavior. | `packages/platform-core/src/agent-registry/service.ts` (lines 874-892) |
| **Ceiling Enforcement** | Trust ceiling enforcement prevents agents from exceeding configured trust boundaries regardless of attestation accumulation, limiting the damage scope of Sybil-style attestation flooding. | `packages/atsf-core/src/trust-engine/ceiling-enforcement/kernel.ts` |
| **Bias Detection** | AI governance module includes bias detection to identify systematic skewing in model outputs that could indicate poisoned training data or context. | `packages/platform-core/src/security/ai-governance/bias-detection.ts` |
| **Anomaly Detection** | Security anomaly detectors for: privilege escalation, data exfiltration, lateral movement, volume anomalies, temporal anomalies, geographic anomalies, and account compromise. | `packages/platform-core/src/security/anomaly/detectors/` |

### Implementation Status: **Implemented**

### Evidence

- `prompt-injection.ts` defines `InjectionDetectionConfig` with `enableContextOverflowDetection: boolean` and `enableEncodingAttackDetection: boolean`.
- `calculateAttestationImpact()` in service.ts applies asymmetric scoring: success = +5, failure = -10, error = -3, with type multipliers.
- `decay-profiles.ts` implements trust score decay over time.
- 7 anomaly detectors are implemented in `packages/platform-core/src/security/anomaly/detectors/`.

---

## 10. ASI08: Opaque Agentic Chains

### Risk Description

Complex chains of agent actions become untraceable, making it impossible to audit decisions, attribute responsibility, or understand the reasoning behind outcomes. Lack of observability prevents detection of compromised behavior in multi-agent workflows.

### Vorion Controls

| Control | Implementation | Source File(s) |
|---|---|---|
| **SHA-256 Hash Chain Audit Trail** | Every proof event is hashed and linked to its predecessor, creating a cryptographically verifiable chain. `verifyChainWithDetails()` returns: valid/invalid status, verified count, first/last event IDs, break location, and error description. | `packages/proof-plane/src/events/hash-chain.ts` |
| **Ed25519 Digital Signatures** | Events can be Ed25519-signed with deterministic serialization. `EventSigningService` manages trusted key sets and provides `sign()`, `verify()`, and batch `verifyEventSignatures()`. The service tracks key IDs and signer identity for non-repudiation. | `packages/proof-plane/src/events/event-signatures.ts` |
| **Merkle Tree Batch Aggregation** | Proofs are aggregated into Merkle trees for efficient batch verification and external anchoring (Ethereum, Bitcoin, RFC 3161 timestamping). Merkle inclusion proofs allow selective disclosure of individual events without revealing the full tree. | `packages/atsf-core/src/proof/merkle.ts` |
| **Unified Proof Plane API** | `ProofPlane` provides typed event emission (`logIntentReceived`, `logDecisionMade`, `logTrustDelta`, `logExecutionStarted`, `logExecutionCompleted`, `logExecutionFailed`), chain/signature verification, correlation-based trace reconstruction, and event subscriptions. | `packages/proof-plane/src/proof-plane/proof-plane.ts` |
| **OpenTelemetry Distributed Tracing** | Full distributed tracing with spans for: agent registration, A2A invocations, trust verification, sandbox execution, and attestation processing. Trace context propagation via `injectTraceContext()` and `extractTraceContext()`. | `packages/platform-core/src/observability/tracing.ts` (exported from `index.ts`) |
| **Prometheus Metrics** | Comprehensive metrics covering: agent registry (registration count, state distribution, state transitions), trust scores (computations, distribution, tier transitions), attestations (submission rate, processing duration, batch sizes), A2A (invocation count/duration, chain depth, trust verifications), sandbox (containers, violations, resource usage), and API (requests, errors, latency). | `packages/platform-core/src/observability/metrics.ts` (exported from `index.ts`) |
| **Structured Logging** | Structured JSON logging with trace context correlation, component-level loggers (agent, A2A, sandbox, attestation), PII redaction in logs (`['password', 'apiKey', 'secret', 'token', 'authorization']`), and configurable log levels. | `packages/platform-core/src/observability/logging.ts` (exported from `index.ts`) |
| **Chain Visualization** | `ChainOfTrustService.visualizeChain()` generates human-readable chain visualizations showing each link's ACI, tier, score, and action for debugging and audit. | `packages/platform-core/src/a2a/chain-of-trust.ts` (lines 472-493) |
| **Policy Evaluation Tracing** | PolicyEngine and ConstraintEvaluator both support OpenTelemetry tracing via `evaluateWithTracing()` and `evaluateAllWithTracing()`, recording intent IDs, policy counts, match counts, and final actions as span attributes. | `src/enforce/policy-engine.ts` (lines 340-365), `src/enforce/constraint-evaluator.ts` (lines 432-453) |

### Implementation Status: **Implemented**

### Evidence

- `hash-chain.ts` provides `verifyChain()`, `verifyEventHash()`, and `verifyChainLink()` with detailed break reporting.
- `event-signatures.ts` implements full Ed25519 key generation (`generateSigningKeyPair()`), signing (`signEvent()`), single event verification (`verifyEventSignature()`), and batch verification (`verifyEventSignatures()`).
- `merkle.ts` implements `buildMerkleTree()`, `generateMerkleProof()`, `verifyMerkleProof()`, and `MerkleAggregationService` with external anchoring support.
- `proof-plane.ts` provides `verifyChainAndSignatures()` combining both chain integrity and signature verification in a single operation.
- Observability module exports 65+ named metrics, loggers, and tracing functions.

---

## 11. ASI09: Misaligned Agent Cascades

### Risk Description

Cascading agent interactions amplify misalignment, where individually minor deviations compound across agent chains to produce outcomes that violate intended policies. Includes goal drift in delegation, value misalignment propagation, and unintended emergent behavior in multi-agent systems.

### Vorion Controls

| Control | Implementation | Source File(s) |
|---|---|---|
| **Chain-of-Trust Floor** | The minimum trust inheritance mode ensures that cascading agent calls never exceed the trust of the weakest link. `calculateChainTrustFloor()` computes `Math.min(...chain.map(link => link.tier))` for both tier and score. | `packages/platform-core/src/a2a/trust-negotiation.ts` (lines 402-411) |
| **Delegation Caps** | Delegation tokens cap effective trust at `maxTier`, which must be <= the delegator's own tier. This prevents trust amplification through delegation. | `packages/platform-core/src/a2a/trust-negotiation.ts` (lines 163-178) |
| **Chain Depth Limits with Loop Detection** | `MAX_CHAIN_DEPTH` prevents unbounded recursion. Loop detection identifies circular invocations. Depth and loop violations are tracked in statistics for monitoring. | `packages/platform-core/src/a2a/chain-of-trust.ts` (lines 294-337) |
| **Trust Negotiation (Bilateral)** | Both caller and callee requirements are merged using the stricter value of each parameter. Capabilities must satisfy both parties' requirements. This prevents weaker agents from lowering security requirements. | `packages/platform-core/src/a2a/trust-negotiation.ts` (lines 488-564) |
| **Alignment Trust Factor** | The OP-ALIGN (Alignment) factor, required from T4+, explicitly measures "Goals and actions match human values" through "Value drift detection, objective compliance." | `packages/basis/src/trust-factors.ts` (lines 114-121) |
| **Policy Engine with Cross-Agent Evaluation** | Policy rules can target specific intent types, action patterns, and entity types, allowing policies that specifically constrain cascading behaviors. The deny-overrides model ensures that any single policy violation halts the cascade. | `src/enforce/policy-engine.ts` |
| **Progressive Containment Escalation** | If a cascade produces violations, the containment system can escalate through graduated levels (monitored -> tool_restricted -> human_in_loop -> simulation_only -> read_only -> halted), applying increasing restrictions to the offending agents. | `packages/atsf-core/src/containment/index.ts` |

### Implementation Status: **Implemented**

### Evidence

- `calculateEffectiveTrust()` with `minimum` mode ensures trust floor across chains.
- `negotiate()` in trust-negotiation.ts merges requirements: `minTier: Math.max(caller, callee)`, `maxChainDepth: Math.min(caller, callee)`.
- `CORE_FACTORS.OP_ALIGN` is defined with `requiredFrom: TrustTier.T4_STANDARD` and measurement: "Value drift detection, objective compliance."
- `ContainmentService.escalate()` automatically moves to the next containment level with notification to the security team.

---

## 12. ASI10: Insufficient Human Oversight

### Risk Description

Autonomous agents operate without adequate mechanisms for human intervention, review, approval, or override. This includes lack of escalation pathways, missing kill switches, insufficient approval workflows, and inability for humans to understand and control agent behavior.

### Vorion Controls

| Control | Implementation | Source File(s) |
|---|---|---|
| **Human Approval Gates** | State transitions T0->T1, T4->T5, T5->T6, and T6->T7 require explicit human approval. Approval requests have 24-hour timeouts with default `reject` on timeout. The system records approver identity, timestamp, and notes. | `packages/platform-core/src/agent-registry/service.ts` (lines 103-109, 654-694, 727-758) |
| **Escalation Service** | Comprehensive human-in-the-loop escalation system for high-risk intents. Supports: creation, acknowledgment, approval/rejection, timeout handling, SLA tracking, reason categories (trust_insufficient, high_risk, policy_violation, manual_review, constraint_escalate), and PostgreSQL persistence with Redis caching. | `packages/platform-core/src/intent/escalation.ts` |
| **Escalation Rule Engine** | Automatic escalation triggered by: risk score thresholds, risk levels, action types, resource patterns, resource sensitivity levels, intent types, trust levels, and custom expressions. Supports multi-target routing, availability-aware scheduling, reminder intervals, re-escalation chains, required approval counts, and timeout actions (deny/allow/re-escalate). | `src/enforce/escalation-rules.ts` |
| **Human Oversight Trust Factor** | The OP-HUMAN (Human Oversight) factor, required from T3+, explicitly measures "Mechanisms for intervention and control" through "Escalation success rate, intervention latency." | `packages/basis/src/trust-factors.ts` (lines 131-137) |
| **Human-in-Loop Containment Level** | The `human_in_loop` containment level requires "Human approval required for all actions" with `severity: 'hard'` and `bypassable: false`. De-escalation from this level requires "5 consecutive approved actions." | `packages/atsf-core/src/containment/index.ts` (lines 93-100, 645-653) |
| **Shadow Mode HITL Verification** | T0 sandbox agent events tagged with `shadowMode: 'shadow'` require HITL verification via `verifyShadowEvent()` before counting toward production trust scores. Verification creates a separate immutable proof event. | `packages/proof-plane/src/proof-plane/proof-plane.ts` (lines 631-676) |
| **Alerting System** | Multi-channel alerting (email, Slack, Teams, PagerDuty, SMS, webhooks) with severity levels, escalation targets, availability schedules (timezone-aware hours, day-of-week, out-of-office delegation), and SLA tracking. | `src/enforce/escalation-rules.ts` (lines 66-115), `packages/platform-core/src/observability/alerts.ts`, `packages/platform-core/src/security/alerting/` |
| **Agent Lifecycle Kill Switch** | The agent registry supports immediate QUARANTINE, SUSPEND, REVOKE, and EXPEL actions. Automatic lifecycle rules escalate: 3 quarantines -> suspension, 3 suspensions -> revocation, 2 revocations -> expulsion. | `packages/platform-core/src/agent-registry/service.ts` (lines 797-846) |

### Implementation Status: **Implemented**

### Evidence

- `HUMAN_APPROVAL_GATES` defines 4 critical transition gates requiring human approval.
- `createApprovalRequest()` creates database-persisted approval requests with 24-hour expiration and `timeoutAction: 'reject'`.
- `EscalationRuleEngine` implements full approval lifecycle: `processApproval()`, `processRejection()`, `processTimeout()`, `sendReminder()`.
- `EscalationService` in intent/escalation.ts integrates with PostgreSQL and Redis for production-grade escalation management.
- `checkLifecycleRules()` implements automatic escalation: 3 quarantines in 30 days -> suspend, 3rd suspension -> revoke, 2nd revocation -> expel.

---

## 13. Summary Coverage Matrix

| ASI ID | Risk Name | Status | Primary Control Layer(s) | Confidence |
|---|---|---|---|---|
| ASI01 | Agentic Excessive Agency | **Implemented** | BASIS (Trust Capabilities, Validation Gate), ENFORCE (Policy Engine, Constraints) | High |
| ASI02 | Inadequate Sandboxing | **Implemented** | BASIS (T0 Sandbox, Capabilities), PROOF (Shadow Mode), TRUST ENGINE (Registry Lifecycle) | High |
| ASI03 | Tool Misuse | **Implemented** | BASIS (Tool Gating), INTENT (Risk Assessment), Security (Prompt Injection, Output Filter) | High |
| ASI04 | Unsafe Code Generation | **Partial** | BASIS (Code Sandbox Capability), Containment (Simulation Mode), Security (Output Filter) | Medium |
| ASI05 | Fragmented Context Integrity | **Implemented** | PROOF (Hash Chain, Signatures), INTENT (Correlation Tracking, Audit), ATSF (Context Policy) | High |
| ASI06 | Cross-Agent Trust Exploitation | **Implemented** | A2A (Trust Negotiation, Chain of Trust, Delegation Verification), Observability (A2A Metrics) | High |
| ASI07 | Memory & Context Poisoning | **Implemented** | Security (Prompt Injection, Output Filter, Anomaly Detection), PROOF (Immutable Chain), TRUST ENGINE (Decay, Ceilings) | High |
| ASI08 | Opaque Agentic Chains | **Implemented** | PROOF (Hash Chain, Ed25519, Merkle Trees), Observability (Tracing, Metrics, Logging), A2A (Chain Visualization) | High |
| ASI09 | Misaligned Agent Cascades | **Implemented** | A2A (Trust Floor, Chain Depth, Negotiation), BASIS (Alignment Factor), ENFORCE (Policy Engine), Containment | High |
| ASI10 | Insufficient Human Oversight | **Implemented** | TRUST ENGINE (Approval Gates), INTENT (Escalation Service), ENFORCE (Escalation Rules), Containment (HITL), PROOF (Shadow Mode) | High |

### Coverage Summary

```
Implemented:  8 / 10  (80%)
Partial:      1 / 10  (10%)
Planned:      0 / 10  ( 0%)
Not Addressed: 1 / 10 (10%)  -- ASI04 has partial coverage
```

**Note:** ASI04 (Unsafe Code Generation) is marked Partial rather than Planned because the capability gating, containment simulation mode, and output filtering are implemented and provide meaningful defense. However, the runtime sandbox execution environment and static analysis integration remain incomplete.

---

## 14. Gaps and Remediation Roadmap

### 14.1 Identified Gaps

| Gap ID | ASI | Gap Description | Severity | Current Mitigation |
|---|---|---|---|---|
| GAP-001 | ASI04 | No integrated static analysis (SAST) for agent-generated code | High | Code execution gated behind T3 trust tier; simulation-only containment available |
| GAP-002 | ASI04 | Sandbox execution runtime (container isolation, syscall filtering) not fully implemented | High | T3 capability constraints defined; containment system blocks code execution for low-trust agents |
| GAP-003 | ASI04 | No dedicated code vulnerability signature database for output filtering | Medium | General output filtering with custom validation rules available |
| GAP-004 | ASI07 | Prompt injection defense patterns may not cover all emerging injection techniques | Medium | Configurable custom patterns and sensitivity levels; block-on-detection mode |
| GAP-005 | ASI02 | Network-level sandbox isolation (container networking, egress filtering) implementation incomplete | Medium | Capability constraints specify "No network" for sandboxed code; Prometheus metrics exist for network policy violations |
| GAP-006 | ASI08 | External Merkle tree anchoring (Ethereum, Bitcoin) is stubbed but not production-ready | Low | RFC 3161 timestamping partially implemented; SHA-256 hash chain provides primary tamper evidence |

### 14.2 Remediation Roadmap

| Priority | Gap ID | Remediation Action | Target Quarter | Effort |
|---|---|---|---|---|
| P1 | GAP-002 | Implement container-based sandbox runtime with gVisor/Firecracker isolation, syscall allowlisting, resource cgroups, and network namespace isolation | Q2 2026 | Large |
| P1 | GAP-001 | Integrate Semgrep or equivalent SAST engine into the code execution pipeline; scan generated code before sandbox execution | Q2 2026 | Medium |
| P2 | GAP-003 | Build a curated code vulnerability pattern database covering OWASP Top 10 web vulnerabilities, CWE Top 25 patterns, and language-specific security anti-patterns | Q3 2026 | Medium |
| P2 | GAP-005 | Implement Kubernetes NetworkPolicy-based egress filtering for sandbox pods; integrate with existing sandbox container metrics | Q3 2026 | Medium |
| P3 | GAP-004 | Establish quarterly prompt injection pattern refresh process; integrate with community threat intelligence feeds for emerging injection techniques | Q3 2026 | Small |
| P3 | GAP-006 | Complete Ethereum anchoring integration for production environments; evaluate Bitcoin Taproot and Ordinals-based anchoring options | Q4 2026 | Medium |

---

## 15. Appendix A: File Reference Index

All paths are relative to the Vorion repository root (`/Users/alexblanc/dev/vorion/`).

### BASIS Layer

| File | Purpose |
|---|---|
| `packages/basis/src/trust-factors.ts` | Trust tier definitions (T0-T7), 23 trust factors, score thresholds, evaluation logic |
| `packages/basis/src/trust-capabilities.ts` | Capability definitions by tier, tool registry, capability lookup |
| `packages/basis/src/validation-gate.ts` | Agent manifest validation, PASS/REJECT/ESCALATE decisions |
| `packages/basis/src/index.ts` | BASIS package barrel export |

### ENFORCE Layer

| File | Purpose |
|---|---|
| `src/enforce/policy-engine.ts` | Policy evaluation engine, rule conditions, deny-overrides |
| `src/enforce/constraint-evaluator.ts` | Rate limits, time windows, resource caps, dependencies |
| `src/enforce/escalation-rules.ts` | Automatic escalation rules, notification routing, approval workflow |
| `src/enforce/decision-aggregator.ts` | Aggregation of policy and constraint decisions |

### PROOF Plane

| File | Purpose |
|---|---|
| `packages/proof-plane/src/events/hash-chain.ts` | SHA-256 hash chain, chain verification |
| `packages/proof-plane/src/events/event-signatures.ts` | Ed25519 signing, key management, batch verification |
| `packages/proof-plane/src/proof-plane/proof-plane.ts` | Unified Proof Plane API, event emission, chain/signature verification |
| `packages/atsf-core/src/proof/merkle.ts` | Merkle tree construction, inclusion proofs, batch aggregation |

### TRUST ENGINE

| File | Purpose |
|---|---|
| `packages/platform-core/src/agent-registry/service.ts` | Agent registration, attestation processing, lifecycle management |
| `packages/atsf-core/src/trust-engine/decay-profiles.ts` | Trust score decay over time |
| `packages/atsf-core/src/trust-engine/ceiling-enforcement/kernel.ts` | Trust ceiling enforcement |
| `packages/atsf-core/src/trust-engine/context-policy/enforcement.ts` | Context-aware policy enforcement |

### A2A (Agent-to-Agent)

| File | Purpose |
|---|---|
| `packages/platform-core/src/a2a/trust-negotiation.ts` | Bilateral trust verification, delegation, proof generation |
| `packages/platform-core/src/a2a/chain-of-trust.ts` | Chain tracking, loop detection, trust inheritance modes |
| `packages/platform-core/src/a2a/attestation.ts` | A2A attestation records |

### Security

| File | Purpose |
|---|---|
| `packages/platform-core/src/security/ai-governance/prompt-injection.ts` | Prompt injection detection and prevention |
| `packages/platform-core/src/security/ai-governance/output-filter.ts` | PII detection/redaction, sensitive data filtering |
| `packages/platform-core/src/security/ai-governance/bias-detection.ts` | Bias detection in model outputs |
| `packages/platform-core/src/security/anomaly/detectors/` | 7 anomaly detectors (privilege escalation, data exfiltration, lateral movement, volume, temporal, geographic, account compromise) |

### Containment

| File | Purpose |
|---|---|
| `packages/atsf-core/src/containment/index.ts` | Progressive containment service (7 levels), restriction enforcement |

### Observability

| File | Purpose |
|---|---|
| `packages/platform-core/src/observability/index.ts` | Unified observability initialization (metrics, logging, tracing, health, alerting) |

### INTENT

| File | Purpose |
|---|---|
| `packages/platform-core/src/intent/classifier/risk.ts` | Rule-based risk assessment for intents |
| `packages/platform-core/src/intent/escalation.ts` | Human-in-the-loop escalation workflows |
| `packages/platform-core/src/intent/audit.ts` | Intent audit trail |

---

## 16. Appendix B: Methodology

This mapping was produced through direct source code inspection of the Vorion repository at commit HEAD as of 2026-02-11. The methodology followed was:

1. **Code Discovery**: Systematic exploration of all packages and source directories relevant to security, trust, governance, enforcement, and observability.
2. **Implementation Verification**: Each claimed control was verified by reading the actual source code, confirming the presence of types, interfaces, classes, and implementation logic.
3. **Status Classification**:
   - **Implemented**: Functional code exists with types, logic, and integration points. The control is testable and operational.
   - **Partial**: Core infrastructure exists (types, interfaces, capability definitions) but specific sub-components are incomplete or stubbed.
   - **Planned**: Architectural references exist but no functional implementation code is present.
4. **Honesty Principle**: Where implementations are incomplete or stubbed (e.g., Ethereum anchoring, sandbox container runtime), this is explicitly noted as a gap.

---

*End of Document*

*VORION-COMP-ASI-2026-001 v1.0.0 -- DRAFT*
