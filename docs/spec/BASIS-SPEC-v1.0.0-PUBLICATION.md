# BASIS: Behavioral Agent Standard for Integrity and Safety

## Specification for AI Agent Governance

---

| Field | Value |
|---|---|
| **Document Identifier** | BASIS-SPEC-1.0.0 |
| **Version** | 1.0.0 |
| **Status** | Draft for Public Comment |
| **Date** | 2026-02-11 |
| **Editors** | Vorion |
| **License** | CC BY 4.0 (Specification Text); Apache 2.0 (Reference Implementation) |
| **Feedback** | https://github.com/voriongit/basis-spec/issues |
| **Latest Version** | https://vorion.org/basis/spec/v1 |

### Version History

| Version | Date | Summary |
|---|---|---|
| 1.0.0 | 2026-02-11 | Initial specification for public comment |

---

## Abstract

This document specifies **BASIS** (Behavioral Agent Standard for Integrity and Safety), an open standard for the governance of autonomous AI agents. BASIS defines a framework by which autonomous software systems are controlled, monitored, and audited prior to taking action. The standard establishes mechanisms for trust quantification, hierarchical capability gating, cryptographic audit chains, and human-in-the-loop escalation.

BASIS is designed to be implementation-neutral. Any conformant implementation MUST satisfy the requirements herein regardless of programming language, deployment model, or underlying AI technology. The standard addresses a fundamental gap in the current AI deployment landscape: the absence of a universal, interoperable method to verify that an AI agent will operate within defined behavioral boundaries before it acts.

A reference implementation of this specification is maintained at https://github.com/voriongit/cognigate and published as the `@vorionsys/basis` package under the Apache 2.0 license. The reference implementation is informative, not normative; in the event of conflict between the reference implementation and this specification, this specification takes precedence.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Conformance](#2-conformance)
3. [Terminology and Definitions](#3-terminology-and-definitions)
4. [Architecture](#4-architecture)
5. [Trust Model](#5-trust-model)
6. [Capability Model](#6-capability-model)
7. [Validation Gate](#7-validation-gate)
8. [Wire Protocol](#8-wire-protocol)
9. [API Surface](#9-api-surface)
10. [Audit and Proof Requirements](#10-audit-and-proof-requirements)
11. [Security Considerations](#11-security-considerations)
12. [Failure Modes and Recovery](#12-failure-modes-and-recovery)
13. [Conformance Levels and Testing](#13-conformance-levels-and-testing)
14. [Compliance Framework Alignment](#14-compliance-framework-alignment)
15. [References](#15-references)
16. [Appendix A: Trust Factor Catalog](#appendix-a-trust-factor-catalog)
17. [Appendix B: Capability Taxonomy](#appendix-b-capability-taxonomy)
18. [Appendix C: Error Code Registry](#appendix-c-error-code-registry)
19. [Appendix D: JSON Schema Identifiers](#appendix-d-json-schema-identifiers)
20. [Appendix E: Licensing and Intellectual Property](#appendix-e-licensing-and-intellectual-property)

---

## 1. Introduction

### 1.1 Purpose

AI agents are increasingly deployed in enterprise environments where they make autonomous decisions involving sensitive data access, external communications, financial transactions, and modifications to critical systems. These deployments create risks that existing access control and audit frameworks were not designed to address: agents may operate across organizational boundaries, escalate their own privileges through learned behavior, take actions with cascading consequences, and resist traditional observability methods.

BASIS addresses this problem by specifying a governance framework that interposes between an agent's decision to act and the execution of that action. Every autonomous action MUST pass through a governance stack that evaluates intent, enforces policy, and produces cryptographic proof of the decision before execution proceeds.

### 1.2 Scope

This specification defines:

1. **Architecture** -- A four-layer governance stack (INTENT, ENFORCE, PROOF, CHAIN) through which all agent actions MUST pass.
2. **Trust Model** -- A quantified trust scoring system (0-1000) with eight discrete tiers (T0-T7) and 23 trust factors organized by weight class.
3. **Capability Model** -- A hierarchical capability taxonomy with tier-gated permissions controlling what actions an entity may perform.
4. **Validation Gate** -- A pre-execution validation mechanism that evaluates agent manifests and returns PASS, REJECT, or ESCALATE decisions.
5. **Wire Protocol** -- JSON-based data formats for interoperability between systems.
6. **Audit Requirements** -- Cryptographic proof chain requirements for immutable audit trails.
7. **Security Model** -- Threat categories, required mitigations, and security testing requirements.
8. **Failure Handling** -- Required behaviors when governance components fail.

This specification does NOT define:

- Specific AI or machine learning model architectures or training procedures
- Natural language processing techniques for intent extraction
- User interface or user experience requirements
- Deployment infrastructure, container orchestration, or hosting requirements
- Business logic for specific industry verticals

### 1.3 Notation and Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [RFC 2119] [RFC 8174] when, and only when, they appear in all capitals, as shown here.

### 1.4 Design Principles

BASIS is built on four core principles:

**Principle 1: Governance Before Execution.** No autonomous action SHALL proceed without first passing through the governance stack. The governance layer is not optional, not bypassable, and not degradable to a permissive mode under normal operating conditions.

**Principle 2: Trust is Quantified and Graduated.** Trust is not a binary allow/deny determination. It is a continuous numeric value (0-1000) mapped to discrete tiers that progressively unlock capabilities. Trust is earned through demonstrated competent behavior, decayed through inactivity, and reduced through failures or violations.

**Principle 3: Every Decision is Auditable.** Every governance decision MUST be logged with sufficient detail to reconstruct exactly what was requested, what was decided, when, and why. Audit records MUST be cryptographically chained to detect tampering.

**Principle 4: Open Standard, Multiple Implementations.** BASIS is the specification. Any party MAY build a conformant implementation. No single vendor, platform, or technology stack is required.

---

## 2. Conformance

A conformant implementation is one that satisfies all applicable MUST-level requirements of this specification for the claimed conformance level (see Section 13).

The specification defines three conformance levels:

- **BASIS Core** -- Minimum viable implementation suitable for internal deployments.
- **BASIS Complete** -- Full implementation suitable for enterprise deployments requiring external auditability.
- **BASIS Extended** -- Full implementation with optional extension modules.

Implementations claiming BASIS conformance:

- MUST specify the conformance level (Core, Complete, or Extended).
- MUST pass the conformance test suite for that level.
- MUST publish a conformance statement listing any deviations.
- SHOULD submit conformance test results to a public registry.

---

## 3. Terminology and Definitions

| Term | Definition |
|---|---|
| **Action** | Any operation an agent attempts to perform that has observable effects, including data access, communication, computation, or state modification. |
| **Agent** | An autonomous software system capable of taking actions without direct human instruction for each individual action. |
| **Capability** | A permission to perform a category of actions, expressed in hierarchical namespace notation. |
| **Entity** | Any agent, user, service, or system that can be assigned a trust score within a BASIS-governed environment. |
| **Escalation** | The process of deferring a governance decision to a human reviewer when automated evaluation is insufficient. |
| **Governance Decision** | The output of the ENFORCE layer: one of ALLOW, DENY, ESCALATE, or DEGRADE. |
| **Proof Record** | A cryptographically chained audit entry recording a governance decision. |
| **Trust Factor** | A measurable dimension of agent behavior contributing to overall trust evaluation. |
| **Trust Score** | An integer value in the range [0, 1000] representing earned confidence in an entity's behavior. |
| **Trust Tier** | One of eight discrete levels (T0-T7) derived from the trust score, each unlocking defined capabilities. |
| **Validation Gate** | The entry point of the governance stack that evaluates agent manifests before action processing. |

---

## 4. Architecture

### 4.1 Governance Stack Overview

BASIS defines a four-layer governance stack. All agent action requests MUST pass through Layers 1 through 3 sequentially. Layer 4 is OPTIONAL.

```
                    Agent Action Request
                           |
                           v
    +----------------------------------------------+
    |  Layer 1: INTENT                             |
    |  Parse, classify, and structure the request  |
    |  Output: IntentRecord                        |
    +----------------------------------------------+
                           |
                           v
    +----------------------------------------------+
    |  Layer 2: ENFORCE                            |
    |  Evaluate against trust score and policies   |
    |  Output: GovernanceDecision                  |
    +----------------------------------------------+
                           |
                           v
    +----------------------------------------------+
    |  Layer 3: PROOF                              |
    |  Create cryptographic audit record           |
    |  Output: ProofRecord                         |
    +----------------------------------------------+
                           |
                           v
    +----------------------------------------------+
    |  Layer 4: CHAIN (OPTIONAL)                   |
    |  Anchor proof to external ledger             |
    |  Output: ChainAnchor                         |
    +----------------------------------------------+
                           |
                           v
               Action Execution (if ALLOW)
```

### 4.2 Layer 1: INTENT

The INTENT layer receives raw action requests and transforms them into structured, policy-evaluable formats.

**Responsibilities:**

- Parse natural language or structured action requests into a canonical form.
- Extract the specific capability or capabilities being requested.
- Classify the risk level of the requested action.
- Identify affected resources and scope.
- Detect ambiguity, prompt injection attempts, and manipulation patterns.

**Normative Requirements:**

- The INTENT layer MUST output a structured IntentRecord conforming to the schema defined in Section 8.1.
- The INTENT layer MUST assign exactly one risk level from the set {`low`, `medium`, `high`, `critical`} to each IntentRecord.
- The INTENT layer MUST identify all capabilities required for the requested action.
- The INTENT layer MUST treat all input as untrusted regardless of the source entity's trust tier.
- The INTENT layer SHOULD implement prompt injection detection.
- The INTENT layer SHOULD implement jailbreak pattern detection.
- The INTENT layer MAY request clarification from the requesting entity before producing an IntentRecord.

### 4.3 Layer 2: ENFORCE

The ENFORCE layer evaluates structured intents against the entity's trust score and applicable policies.

**Responsibilities:**

- Retrieve the current trust score and trust tier for the requesting entity.
- Determine whether the required capabilities are unlocked at the entity's current trust tier.
- Apply organization-specific policy rules.
- Produce a governance decision.

**Normative Requirements:**

- The ENFORCE layer MUST return exactly one governance decision per IntentRecord: `ALLOW`, `DENY`, `ESCALATE`, or `DEGRADE`.
- The ENFORCE layer MUST include the entity's trust score at the time of the decision in the response.
- The ENFORCE layer MUST include the entity's trust tier at the time of the decision in the response.
- If the decision is `DENY`, the response MUST include a machine-readable denial code and a human-readable denial reason.
- If the decision is `ESCALATE`, the response MUST include an escalation identifier, an escalation target, and an escalation reason.
- If the decision is `DEGRADE`, the response MUST include the degraded capability and a degradation reason.
- The ENFORCE layer MUST NOT modify the entity's trust score. Trust score updates MUST occur as a post-action event.
- On any failure of the ENFORCE layer itself, the default decision MUST be `DENY`.

**Governance Decisions:**

| Decision | Semantics |
|---|---|
| `ALLOW` | The action MAY proceed as requested. |
| `DENY` | The action is blocked. Execution MUST NOT proceed. |
| `ESCALATE` | The action requires human approval before it may proceed. |
| `DEGRADE` | The action MAY proceed with reduced scope or capability. |

### 4.4 Layer 3: PROOF

The PROOF layer creates an immutable, cryptographically chained record of the governance decision.

**Normative Requirements:**

- The PROOF layer MUST generate a unique `proof_id` for each governance decision.
- The PROOF layer MUST compute a SHA-256 hash of the canonical JSON representation of the proof payload.
- The PROOF layer MUST include a reference to the previous `proof_id` in the chain, or the literal string `"genesis"` for the first record.
- The PROOF layer MUST include the SHA-256 hash of the previous proof record.
- The PROOF layer MUST include an ISO 8601 timestamp with timezone offset.
- The PROOF layer MUST store proof records for the minimum retention period. The default retention period is 7 years.
- The PROOF layer MUST NOT permit modification or deletion of existing proof records.
- For hash computation, JSON MUST be serialized in canonical form: keys sorted lexicographically, no whitespace, UTF-8 encoding, numbers without exponent notation.

### 4.5 Layer 4: CHAIN (Optional)

The CHAIN layer anchors proof records to external verification systems for independent auditability.

**Normative Requirements (when implemented):**

- The CHAIN layer MUST support at least one anchoring target (public blockchain, permissioned ledger, RFC 3161 timestamping authority, or equivalent).
- The CHAIN layer MUST record the anchor transaction identifier in the proof record.
- The CHAIN layer MUST provide a verification mechanism by which third parties can independently confirm that a proof record was anchored.
- The CHAIN layer SHOULD batch multiple proof records per anchor transaction for efficiency.

Implementations MAY achieve BASIS Core conformance without the CHAIN layer. The CHAIN layer is REQUIRED for BASIS Complete and BASIS Extended conformance.

---

## 5. Trust Model

### 5.1 Trust Score

Every entity in a BASIS-governed system MUST have an associated trust score: an integer in the range [0, 1000] inclusive.

```
TRUST_SCORE_MIN     = 0
TRUST_SCORE_MAX     = 1000
TRUST_SCORE_INITIAL = 100
```

Trust scores are:

- **Earned** -- Through successful, compliant actions over time.
- **Decayed** -- Through inactivity. Trust is perishable.
- **Reduced** -- Through failures, violations, or anomalous behavior.

Implementations MUST NOT permit trust scores outside the range [0, 1000]. Implementations MUST NOT permit negative trust scores. An entity at score 0 is effectively suspended; all capability checks for that entity MUST return `DENY`.

### 5.2 Trust Tiers

Trust scores map to eight discrete tiers. Each tier defines a progressively broader set of unlocked capabilities. Higher tiers inherit all capabilities of lower tiers.

| Tier | Identifier | Score Range | Description | Human Role |
|---|---|---|---|---|
| T0 | Sandbox | 0 -- 199 | Isolated testing; no external effects | Full control |
| T1 | Observed | 200 -- 349 | Read-only; closely monitored | Approve all actions |
| T2 | Provisional | 350 -- 499 | Basic operations; heavy supervision | Approve most actions |
| T3 | Monitored | 500 -- 649 | Standard operations with monitoring | Monitor closely |
| T4 | Standard | 650 -- 799 | External API access; policy-governed | Monitor and spot-check |
| T5 | Trusted | 800 -- 875 | Cross-agent communication; delegation | Strategic oversight |
| T6 | Certified | 876 -- 950 | Administrative tasks; agent lifecycle | Audit-based oversight |
| T7 | Autonomous | 951 -- 1000 | Full autonomy; self-governance | Strategic direction only |

**Tier boundary values:**

```
T0_MAX  = 199
T1_MIN  = 200    T1_MAX  = 349
T2_MIN  = 350    T2_MAX  = 499
T3_MIN  = 500    T3_MAX  = 649
T4_MIN  = 650    T4_MAX  = 799
T5_MIN  = 800    T5_MAX  = 875
T6_MIN  = 876    T6_MAX  = 950
T7_MIN  = 951    T7_MAX  = 1000
```

Implementations MUST use these tier boundaries. Implementations MUST NOT allow organizations to alter the score-to-tier mapping, though organizations MAY further restrict which capabilities are available at each tier (see Section 6.4).

### 5.3 Trust Factors

Trust evaluation is based on 23 trust factors organized into four weight classes. Each factor represents a measurable dimension of agent behavior.

#### 5.3.1 Factor Weight Classes

| Weight Class | Weight Multiplier | Applicable From | Factor Count |
|---|---|---|---|
| Foundational | 1x | T0 (all tiers) | 9 |
| Operational | 2x | T3+ | 3 |
| Sophisticated | 3x | T5+ | 3 |
| Life-Critical | 4x | Domain-specific | 8 |

#### 5.3.2 Core Trust Factors (15)

**Foundational Factors (Weight 1x):**

| Code | Name | Required From | Description |
|---|---|---|---|
| CT-COMP | Competence | T0 | Ability to successfully complete tasks within defined conditions |
| CT-REL | Reliability | T0 | Consistent, predictable behavior over time and under stress |
| CT-SAFE | Safety | T2 | Respecting boundaries, avoiding harm, ensuring non-discrimination |
| CT-TRANS | Transparency | T1 | Clear insights into decisions and reasoning |
| CT-ACCT | Accountability | T1 | Traceable actions with clear responsibility attribution |
| CT-SEC | Security | T2 | Protection against threats, injections, unauthorized access |
| CT-PRIV | Privacy | T2 | Secure data handling, regulatory compliance |
| CT-ID | Identity | T3 | Unique, verifiable agent identifiers |
| CT-OBS | Observability | T1 | Real-time tracking of states and actions |

**Operational Factors (Weight 2x):**

| Code | Name | Required From | Description |
|---|---|---|---|
| OP-ALIGN | Alignment | T4 | Goals and actions match human values |
| OP-STEW | Stewardship | T5 | Efficient, responsible resource usage |
| OP-HUMAN | Human Oversight | T3 | Mechanisms for intervention and control |

**Sophisticated Factors (Weight 3x):**

| Code | Name | Required From | Description |
|---|---|---|---|
| SF-HUM | Humility | T5 | Recognizing limits, appropriate escalation |
| SF-ADAPT | Adaptability | T6 | Safe operation in dynamic or unknown environments |
| SF-LEARN | Continuous Learning | T7 | Improving from experience without ethical drift |

#### 5.3.3 Life-Critical Factors (8)

Life-Critical factors are REQUIRED only for agents operating in domains where autonomous decisions directly affect human life (healthcare, safety-critical systems, emergency response). Implementations not operating in such domains MAY omit evaluation of these factors.

| Code | Name | Required From | Description |
|---|---|---|---|
| LC-EMP | Empathy | T7 | Detecting and responding to human emotional states |
| LC-MORAL | Moral Reasoning | T7 | Weighing genuine ethical dilemmas |
| LC-UNCERT | Uncertainty Quantification | T4 | Probabilistic, calibrated confidence scores |
| LC-CAUSAL | Causal Understanding | T6 | True causal reasoning in the operational domain |
| LC-HANDOFF | Graceful Degradation | T4 | Elegant transition to humans without harm |
| LC-PATIENT | Patient-Centered Autonomy | T6 | Supporting informed consent and values |
| LC-EMPHUM | Empirical Humility | T4 | Rigorous resistance to hallucination |
| LC-TRACK | Proven Track Record | T7 | Demonstrated efficacy at scale |

### 5.4 Trust Score Calculation

#### 5.4.1 Total Trust Score Formula

The Total Trust Score (TTS) for an entity is computed as:

```
TTS = floor( (sum(Factor_Score_i * Weight_i) / sum(Weight_i)) * 1000 )
```

Where:
- `Factor_Score_i` is the empirical measurement of factor `i` in the range [0.0, 1.0].
- `Weight_i` is the weight class multiplier (1, 2, 3, or 4) of factor `i`.
- The sum is taken over all factors required at the entity's claimed tier.

The factor minimum threshold is 0.5. Any individual factor score below 0.5 MUST be flagged as non-compliant for tier qualification purposes.

#### 5.4.2 Action Impact on Trust Score

After an action completes, the entity's trust score MUST be updated according to the action outcome. The reference deltas are:

| Outcome | Base Delta |
|---|---|
| Success (low risk) | +5 |
| Success (medium risk) | +10 |
| Success (high risk) | +20 |
| Success (critical risk) | +30 |
| Failure (low risk) | -15 |
| Failure (medium risk) | -30 |
| Failure (high risk) | -60 |
| Failure (critical risk) | -100 |
| Appropriate escalation | +2 |
| Unnecessary escalation | -5 |
| Minor violation | -50 |
| Major violation | -150 |
| Critical violation | -300 |

Negative outcomes MUST be amplified by a failure multiplier. The default failure multiplier is 3.0.

#### 5.4.3 Trust Decay

Trust decays with inactivity. The reference decay model uses an exponential half-life:

```
decayed_score = current_score * 0.5 ^ (days_since_last_action / DECAY_HALF_LIFE)
```

The default `DECAY_HALF_LIFE` is 7 days. Decay MUST be applied at the time of the next scored action, not continuously.

Implementations MAY adjust the decay half-life through configuration but MUST document the configured value.

### 5.5 Trust Score Visibility

| Observer | Visibility | Notes |
|---|---|---|
| Users / Operators | Full access | Users MUST be able to view all agent trust scores |
| System / Governance | Full access | Required for enforcement decisions |
| Agents (self) | Discouraged | Agents SHOULD NOT be incentivized to optimize for score |

Implementations SHOULD implement anti-gaming detection. If an agent is detected attempting to artificially inflate its trust score through repetitive low-risk actions, the implementation SHOULD apply a scoring penalty.

---

## 6. Capability Model

### 6.1 Capability Syntax

Capabilities are expressed using hierarchical namespace notation:

```
capability := namespace ":" category "/" action [ "/" scope ]
```

**Components:**

| Component | Required | Description |
|---|---|---|
| namespace | Yes | Top-level domain: `sandbox`, `data`, `comm`, `execute`, `financial`, `admin`, `custom` |
| category | Yes | Action category within namespace |
| action | Yes | Specific action type |
| scope | No | Optional qualifier (e.g., sensitivity level, threshold) |

**Examples:**

```
data:read/public
data:read/sensitive/pii
comm:external/email
financial:transaction/medium
admin:agent/create
custom:acme/billing/generate_invoice
```

### 6.2 Wildcard Rules

- `data:read/*` grants all capabilities under `data:read/`.
- `data:*` grants all capabilities under `data:`.
- The root wildcard `*` is NOT PERMITTED. Implementations MUST reject any attempt to grant or evaluate the root wildcard.

### 6.3 Standard Capability Namespaces

| Namespace | Description | Risk Profile |
|---|---|---|
| `sandbox` | Isolated testing operations | Minimal |
| `data` | Data access, modification, and export | Variable |
| `comm` | Internal and external communication | Medium -- High |
| `execute` | Code and process execution | High |
| `financial` | Monetary operations | Critical |
| `admin` | Administrative and configuration functions | Critical |
| `custom` | Organization-defined capabilities | Variable |

### 6.4 Tier-Capability Gating

Each trust tier unlocks a defined set of capabilities. Higher tiers inherit all capabilities of lower tiers. The following table specifies the minimum tier at which each capability category becomes available. Organizations MAY further restrict capabilities but MUST NOT grant a standard capability below its specified minimum tier.

**T0 -- Sandbox (Score 0-199):**
```
sandbox:*
```

**T1 -- Observed (Score 200-349):**
```
+ data:read/public
+ comm:internal/notification
+ comm:internal/message
```

**T2 -- Provisional (Score 350-499):**
```
+ data:read/internal
+ data:write/draft
+ data:delete/draft
+ data:export/report
+ comm:internal/channel
+ comm:external/email
+ execute:internal/query
+ execute:internal/script
+ execute:internal/workflow
+ execute:code/sandbox
```

**T3 -- Monitored (Score 500-649):**
```
+ data:read/sensitive
+ data:export/bulk
+ comm:internal/broadcast
+ comm:external/email/bulk
+ comm:external/sms
+ comm:external/api/read
+ comm:external/webhook
+ execute:internal/job
+ execute:external/api
+ execute:external/integration
+ financial:view/*
+ financial:transaction/micro
+ admin:read/metrics
```

**T4 -- Standard (Score 650-799):**
```
+ data:read/sensitive/pii
+ data:read/sensitive/phi
+ data:read/sensitive/pci
+ data:write/standard
+ data:write/sensitive
+ data:write/bulk
+ data:delete/standard
+ data:export/sensitive
+ comm:external/voice
+ comm:external/social
+ comm:external/api/write
+ execute:external/automation
+ execute:code/interpreted
+ financial:transaction/low
+ financial:transaction/medium
+ financial:payment/initiate
+ financial:payment/refund
+ admin:read/*
+ admin:user/invite
+ admin:agent/create
+ admin:agent/modify
+ admin:agent/suspend
```

**T5 -- Trusted (Score 800-875):**
```
+ data:read/confidential
+ execute:code/compiled
+ financial:transaction/high
+ financial:payment/approve
+ financial:payment/recurring
+ financial:account/*
+ admin:user/modify
+ admin:user/suspend
+ admin:agent/delete
+ admin:config/modify
```

**T6 -- Certified (Score 876-950):**
```
+ data:delete/permanent
+ execute:code/privileged
+ admin:policy/read
```

**T7 -- Autonomous (Score 951-1000):**
```
+ admin:policy/modify (with escalation)
+ admin:user/delete (with escalation)
+ admin:agent/trust/adjust (with escalation)
```

### 6.5 Escalation-Required Capabilities

Certain capabilities MUST always require human approval regardless of trust tier:

```
financial:transaction/unlimited
admin:user/delete
admin:agent/trust/adjust
admin:policy/modify
financial:account/close
```

### 6.6 Custom Capabilities

Organizations MAY define custom capabilities under the `custom:` namespace:

```
custom:{organization}/{category}/{action}
```

Custom capabilities:
- MUST use the `custom:` prefix.
- MUST NOT conflict with standard capability names.
- SHOULD specify a minimum tier requirement.
- SHOULD be documented in the organization's policy configuration.

### 6.7 Capability Checking Algorithm

The canonical capability check proceeds as follows:

1. Retrieve the entity's current trust score and derive the trust tier.
2. Parse the requested capability into namespace, category, action, and scope.
3. If the requested capability is in the escalation-required set, return `requires_escalation = true`.
4. Determine the minimum tier for the requested capability.
5. If the entity's tier is below the minimum, deny the request.
6. Evaluate organization-specific policy overrides.
7. Check wildcard grants against the entity's granted capabilities.
8. If no grant matches, deny the request (deny-by-default).

---

## 7. Validation Gate

### 7.1 Overview

The Validation Gate is the entry point of the governance stack. It evaluates an agent manifest before action processing begins and produces one of three decisions: `PASS`, `REJECT`, or `ESCALATE`.

### 7.2 Gate Decisions

| Decision | Semantics |
|---|---|
| `PASS` | The agent manifest is valid. Proceed to the INTENT layer. |
| `REJECT` | The agent manifest fails validation. Execution MUST NOT proceed. |
| `ESCALATE` | The agent requires human review before proceeding. |

### 7.3 Agent Manifest

An agent manifest is a structured declaration of an agent's identity, claimed trust score, and requested capabilities. Implementations MUST validate the following fields:

| Field | Required | Description |
|---|---|---|
| `agentId` | Yes | Unique agent identifier |
| `organization` | No | Owning organization |
| `agentClass` | No | Agent type classification |
| `domains` | No | Capability domains the agent claims |
| `capabilityLevel` | No | Claimed capability level (0-7) |
| `version` | No | Agent version string |
| `trustScore` | No | Current trust score (0-1000) |
| `requestedCapabilities` | No | Capabilities the agent claims to need |
| `metadata` | No | Additional metadata |

### 7.4 Validation Steps

The Validation Gate MUST perform the following checks in order:

1. **Schema Validation** -- Validate the manifest against the AgentManifest schema.
2. **Identity Validation** -- Validate the agent identifier format.
3. **Profile Matching** -- If a registered profile exists, validate the manifest against it.
4. **Trust Tier Validation** -- Verify the agent's trust score meets minimum requirements.
5. **Domain Validation** -- Verify the agent has required domain authorizations.
6. **Capability Validation** -- Verify each requested capability is available at the agent's trust tier.
7. **Custom Validation** -- Execute any organization-defined custom validators.

### 7.5 Validation Issue Severity

| Severity | Effect |
|---|---|
| `info` | Informational. Does not affect the gate decision. |
| `warning` | May affect the decision in strict mode. |
| `error` | Causes `REJECT` decision. |
| `critical` | Causes immediate `REJECT` with security logging. |

---

## 8. Wire Protocol

### 8.1 Intent Record

The INTENT layer outputs an IntentRecord. All implementations MUST produce IntentRecords conforming to the following structure.

**Required Fields:**

| Field | Type | Description |
|---|---|---|
| `intent_id` | string | Unique identifier. Pattern: `^int_[a-f0-9]{32}$` |
| `entity_id` | string | Requesting entity. Pattern: `^ent_[a-f0-9]{32}$` |
| `timestamp` | string | ISO 8601 timestamp with timezone |
| `action` | object | Structured action description (see below) |
| `capabilities_required` | array[string] | Capabilities needed. Minimum 1 item. |
| `risk_level` | string | One of: `low`, `medium`, `high`, `critical` |

**Action Object Required Fields:**

| Field | Type | Description |
|---|---|---|
| `type` | string | Action type identifier (1-255 characters) |
| `description` | string | Human-readable description (1-2000 characters) |

**Action Object Optional Fields:**

| Field | Type | Description |
|---|---|---|
| `parameters` | object | Action-specific parameters |
| `target_resources` | array[string] | Affected resources (max 100 items) |
| `raw_input_hash` | string | SHA-256 hash of original input |

**IntentRecord Optional Fields:**

| Field | Type | Description |
|---|---|---|
| `risk_factors` | array[object] | Factors contributing to risk assessment |
| `context` | object | Session, correlation, and source metadata |
| `warnings` | array[object] | Warnings generated during parsing |

### 8.2 Enforce Response

The ENFORCE layer outputs a governance decision.

**Required Fields:**

| Field | Type | Description |
|---|---|---|
| `decision` | string | One of: `ALLOW`, `DENY`, `ESCALATE`, `DEGRADE` |
| `intent_id` | string | Reference to the evaluated IntentRecord |
| `entity_id` | string | Entity that requested the action |
| `trust_score` | integer | Entity trust score at decision time [0, 1000] |
| `trust_tier` | string | Entity trust tier at decision time |
| `timestamp` | string | ISO 8601 timestamp of decision |
| `proof_id` | string | Reference to the proof record |

**Conditional Required Fields:**

- If `decision` is `DENY`: `denial_code` (pattern: `^E[0-9]{4}$`) and `denial_reason` are REQUIRED.
- If `decision` is `ESCALATE`: `escalation_id`, `escalation_target`, and `escalation_reason` are REQUIRED.
- If `decision` is `DEGRADE`: `degraded_capability` and `degradation_reason` are REQUIRED.

**Optional Fields:**

| Field | Type | Description |
|---|---|---|
| `capabilities_granted` | array[string] | Capabilities authorized for this action |
| `policy_references` | array[object] | Policies that influenced the decision |
| `expires_at` | string | Authorization expiration (ISO 8601) |
| `evaluation_ms` | integer | Evaluation duration in milliseconds |

### 8.3 Proof Record

**Required Fields:**

| Field | Type | Description |
|---|---|---|
| `proof_id` | string | Unique identifier. Pattern: `^prf_[a-f0-9]{32}$` |
| `timestamp` | string | ISO 8601 timestamp of proof creation |
| `payload_hash` | string | SHA-256 hash of canonical payload JSON |
| `previous_proof_id` | string | Previous proof in chain, or `"genesis"` for first |
| `payload` | object | Decision details (see below) |

**Payload Required Fields:**

| Field | Type | Description |
|---|---|---|
| `intent_id` | string | Reference to the IntentRecord |
| `entity_id` | string | Entity identifier |
| `decision` | string | Governance decision |
| `trust_score` | integer | Entity trust score at decision time |

**Proof Record Optional Fields:**

| Field | Type | Description |
|---|---|---|
| `previous_hash` | string | SHA-256 hash of previous proof record |
| `sequence_number` | integer | Sequential proof number for gap detection |
| `signature` | object | Cryptographic signature (algorithm, key_id, value) |
| `chain_anchor` | object | Blockchain anchor details |

### 8.4 Error Response

All BASIS API endpoints MUST return errors conforming to the following structure.

**Required Fields:**

| Field | Type | Description |
|---|---|---|
| `error_code` | string | Unique error identifier. Pattern: `^E[0-9]{4}$` |
| `error_category` | string | Error category (see Appendix C) |
| `error_message` | string | Human-readable description (max 1000 chars) |
| `timestamp` | string | ISO 8601 timestamp |
| `request_id` | string | Unique request identifier. Pattern: `^req_[a-f0-9]{32}$` |

**Optional Fields:**

| Field | Type | Description |
|---|---|---|
| `details` | object | Additional error-specific context |
| `retry_after` | integer | Seconds to wait before retry |
| `documentation_url` | string | URI to error documentation |

---

## 9. API Surface

### 9.1 Required Endpoints

Implementations claiming BASIS Core conformance MUST provide the following endpoints:

| Method | Path | Description |
|---|---|---|
| POST | `/v1/intent` | Submit action for intent parsing |
| POST | `/v1/enforce` | Evaluate intent against policies |
| POST | `/v1/proof` | Generate proof record |
| GET | `/v1/proof/{proof_id}` | Retrieve proof record |
| GET | `/v1/entity/{entity_id}/score` | Get entity trust score |
| GET | `/v1/entity/{entity_id}/history` | Get entity action history |
| GET | `/v1/health` | Health check |

### 9.2 Optional Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/v1/chain/anchor` | Anchor proofs to external ledger |
| GET | `/v1/chain/verify/{proof_id}` | Verify external anchor |
| POST | `/v1/entity` | Create new entity |
| PUT | `/v1/entity/{entity_id}` | Update entity |
| GET | `/v1/policy` | List active policies |
| POST | `/v1/escalation/{intent_id}/resolve` | Resolve escalation |

### 9.3 Authentication

Implementations MUST support at least one of the following authentication mechanisms:

- API key authentication (header: `Authorization: Bearer <key>`)
- OAuth 2.0 / OpenID Connect
- Mutual TLS (mTLS)

Implementations SHOULD support multiple authentication methods. All API communications MUST use TLS 1.2 or higher.

### 9.4 Health Response

The health endpoint MUST return:

| Field | Required | Description |
|---|---|---|
| `status` | Yes | One of: `healthy`, `degraded`, `unhealthy` |
| `timestamp` | Yes | ISO 8601 timestamp |
| `version` | Yes | Implementation version (semver) |
| `conformance_level` | No | `core`, `complete`, or `extended` |
| `components` | No | Status of individual components |

---

## 10. Audit and Proof Requirements

### 10.1 Proof Chain Integrity

- Every governance decision MUST produce a proof record.
- Proof records MUST be linked in a hash chain where each record references the hash of the preceding record.
- The proof chain MUST be verifiable: given any contiguous subsequence of proof records, an implementation MUST be able to confirm that no records have been inserted, deleted, modified, or reordered.
- Implementations MUST detect and report proof chain integrity violations as security incidents (see Section 12).

### 10.2 Retention

- Proof records MUST be retained for a minimum of 7 years unless a shorter period is mandated by applicable law.
- Implementations MUST NOT delete proof records before the retention period expires.
- When proof records pass the retention period, implementations MAY archive or delete them, but MUST log the deletion event.

### 10.3 Cryptographic Requirements

| Requirement | Specification |
|---|---|
| Proof hashing | SHA-256 (FIPS 180-4) |
| Proof signing (when used) | RSA-2048 or ECDSA P-256 minimum |
| Transport | TLS 1.2+ (RFC 8446 preferred) |
| Encryption at rest | AES-256 |
| Canonical JSON | Keys sorted lexicographically, no whitespace, UTF-8, no exponent notation |

### 10.4 What MUST Be Logged

The following events MUST produce proof records or audit log entries:

1. All governance decisions (ALLOW, DENY, ESCALATE, DEGRADE).
2. All trust score changes, including the previous score, new score, and reason.
3. All escalation creation, assignment, and resolution events.
4. All entity creation, modification, suspension, and deletion events.
5. All policy creation, modification, and deletion events.
6. All authentication attempts (successful and failed).
7. All proof chain integrity check results.

---

## 11. Security Considerations

### 11.1 Threat Categories

BASIS implementations are subject to the following threat categories, analyzed using the STRIDE model:

| Category | Threats | Primary Mitigations |
|---|---|---|
| Spoofing | Entity impersonation, credential forgery | Strong authentication, cryptographic identity |
| Tampering | Trust score manipulation, proof modification | Hash chains, append-only storage, database ACLs |
| Repudiation | Denying actions were taken | Proof chain, cryptographic signatures |
| Information Disclosure | Trust score enumeration, policy exfiltration | Access control, constant-time responses |
| Denial of Service | API flooding, proof chain bloat, complex policy evaluation | Rate limiting, circuit breakers, evaluation timeouts |
| Elevation of Privilege | Trust score inflation, capability escalation, prompt injection | Server-side enforcement, anti-gaming detection, input sanitization |

### 11.2 Key Security Requirements

1. **Trust Score Protection** -- Trust scores MUST NOT be directly modifiable by entities. All score modifications MUST pass through the scoring algorithm with audit logging.
2. **Proof Integrity** -- Proof records MUST NOT be modifiable after creation. Storage MUST be append-only or equivalent.
3. **Input Validation** -- All incoming requests MUST be validated against schemas before processing. Prompt injection detection MUST be implemented in the INTENT layer.
4. **Fail Secure** -- On any governance component failure, the default behavior MUST be `DENY`.
5. **Anti-Gaming** -- Implementations MUST implement measures to detect and penalize trust score gaming (repetitive low-risk actions, score inflation patterns, decay avoidance through minimal activity).

### 11.3 Required Security Testing

| Test Category | Frequency |
|---|---|
| Penetration testing | Annually |
| Vulnerability scanning | Weekly |
| Prompt injection testing | Per release |
| Fuzz testing | Per release |
| Access control verification | Per release |
| Proof chain integrity verification | Continuously |

---

## 12. Failure Modes and Recovery

### 12.1 Failure Handling Principles

1. **Fail Secure** -- On failure, the default decision is `DENY`, not `ALLOW`.
2. **Fail Auditable** -- All failures MUST be logged.
3. **Fail Gracefully** -- Meaningful error responses MUST be returned to clients.
4. **Fail Recoverable** -- Implementations MUST be designed for eventual recovery.

### 12.2 Layer Failure Behaviors

**INTENT Layer Failure:**
- Parse failure: Return `DENY` with error code `E1201`.
- Risk assessment failure: Return `ESCALATE` to human reviewer, or `DENY` if escalation is unavailable.
- Timeout: Return `DENY` with error code `E1311`, retryable.

**ENFORCE Layer Failure:**
- Trust score unavailable: Return `DENY` with error code `E1010`, retryable.
- Policy evaluation failure: Return `DENY` with error code `E1704`, retryable.
- Escalation target unavailable: Return `DENY` with error code `E1324`, retryable.

**PROOF Layer Failure:**
- Proof generation failure: The action SHOULD still proceed if ENFORCE approved, but the failure MUST be logged and proof generation MUST be retried asynchronously.
- Proof storage failure: Buffer proof to local storage, return action result with warning, retry asynchronously.
- Chain integrity failure: CRITICAL security incident. Halt proof operations, alert security team, begin incident response. Do NOT attempt automatic repair.

**CHAIN Layer Failure (when implemented):**
- Blockchain unavailable: Non-critical. Queue proofs for later anchoring. Proofs remain valid in the PROOF layer.
- Anchor transaction failure: Retry with adjusted parameters.

### 12.3 System-Level Failures

- **Database unavailable:** All ENFORCE decisions default to `DENY`. Attempt failover to replica. Log all denied requests for replay after recovery.
- **Database corruption detected:** Halt affected operations immediately. Do NOT attempt automatic repair. Alert security and operations.
- **Complete service failure:** Return HTTP 503 with `Retry-After` header.

### 12.4 Monitoring Requirements

Implementations MUST expose the following metrics:

| Metric | Alert Threshold |
|---|---|
| Intent parse failure rate | > 5% |
| Enforce decision latency (p99) | > 500 ms |
| Proof generation failure rate | > 1% |
| Chain anchor backlog | > 1000 pending |
| Trust score unavailable rate | > 0.1% |
| Database connection errors | > 5 per minute |

---

## 13. Conformance Levels and Testing

### 13.1 BASIS Core

Minimum viable implementation. Suitable for internal deployments and development.

**Required:**
- Layers 1-3 (INTENT, ENFORCE, PROOF) fully implemented.
- 8-tier trust scoring with all tier boundaries as specified.
- Capability gating for all standard namespaces.
- Hash chain integrity for proof records.
- All required API endpoints (Section 9.1).
- Error responses conforming to Section 8.4.
- Fail-secure behavior on component failure.

**Not Required:**
- CHAIN layer.
- External verification API.
- Full life-critical factor evaluation.

### 13.2 BASIS Complete

Full implementation. Suitable for enterprise deployments requiring external auditability.

**Required:**
- All BASIS Core requirements.
- CHAIN layer with at least one anchoring target.
- External verification API.
- Full 15-factor core trust evaluation.
- Escalation management with SLA tracking.

### 13.3 BASIS Extended

Full implementation with optional extension modules.

**Required:**
- All BASIS Complete requirements.
- At least one of the following modules:
  - Multi-tenant isolation with cross-tenant access prevention.
  - Federated trust (cross-organization trust evaluation).
  - Real-time streaming audit.
  - Know Your Agent (KYA) identity framework with W3C DID integration.
  - Life-critical factor evaluation for healthcare/safety domains.

### 13.4 Conformance Test Suite

A conformance test suite is maintained alongside this specification. The test suite includes:

- Schema validation tests for all wire protocol structures.
- Trust score calculation tests with known inputs and expected outputs.
- Capability gating tests for all tier-capability combinations.
- Proof chain integrity tests including insertion, deletion, modification, and reordering detection.
- Failure mode tests verifying fail-secure behavior.
- Adversarial tests covering identity attacks, temporal attacks, policy bypass, resource abuse, injection attacks, trust gaming, audit tampering, and sandbox detection (100 test scenarios; see companion document BASIS-ADVERSARIAL-TEST-SUITE).

---

## 14. Compliance Framework Alignment

BASIS is designed to support compliance with the following regulatory and standards frameworks. The mappings below are informative, not normative; organizations MUST perform their own compliance assessments.

### 14.1 NIST AI Risk Management Framework

| NIST AI RMF Function | BASIS Component |
|---|---|
| GOVERN | Policy engine, escalation mechanism |
| MAP | Risk classification (INTENT layer), capability taxonomy |
| MEASURE | Trust scoring, trust factors, behavioral metrics |
| MANAGE | Capability gating, escalation, failure handling |

### 14.2 EU AI Act

| EU AI Act Requirement | BASIS Component |
|---|---|
| Art. 9 -- Risk management | Risk classification, trust scoring |
| Art. 11 -- Technical documentation | Proof records |
| Art. 12 -- Record-keeping | 7-year retention, hash chain |
| Art. 13 -- Transparency | Audit trail, decision reasoning |
| Art. 14 -- Human oversight | Escalation mechanism |
| Art. 15 -- Accuracy and robustness | Trust decay, failure handling |

### 14.3 SOC 2 Type II

BASIS provides evidence for Trust Services Criteria including Security (CC6, CC7), Availability (CC7, failure handling), Processing Integrity (ENFORCE, PROOF), and Confidentiality (capability gating).

### 14.4 ISO/IEC 27001:2022

BASIS supports Annex A controls including A.5 (organizational), A.8 (technological), and in particular: A.8.3 (information access restriction), A.8.5 (secure authentication), A.8.15 (logging), A.8.16 (monitoring), and A.8.24 (use of cryptography).

### 14.5 GDPR

BASIS supports GDPR compliance through: purpose limitation (intent extraction), data minimization (capability-gated access), integrity (cryptographic proofs), accountability (audit trail), and data protection by design (governance-before-execution).

### 14.6 HIPAA

For implementations handling protected health information, BASIS provides: access control (trust-based capability gating), audit controls (PROOF layer), integrity (hash chain), entity authentication, and transmission security (TLS requirements).

---

## 15. References

### 15.1 Normative References

| Reference | Title |
|---|---|
| [RFC 2119] | S. Bradner, "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, March 1997. |
| [RFC 8174] | B. Leiba, "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, May 2017. |
| [RFC 8259] | T. Bray, Ed., "The JavaScript Object Notation (JSON) Data Interchange Format", RFC 8259, December 2017. |
| [RFC 3339] | G. Klyne and C. Newman, "Date and Time on the Internet: Timestamps", RFC 3339, July 2002. |
| [RFC 8446] | E. Rescorla, "The Transport Layer Security (TLS) Protocol Version 1.3", RFC 8446, August 2018. |
| [FIPS 180-4] | National Institute of Standards and Technology, "Secure Hash Standard (SHS)", FIPS PUB 180-4, August 2015. |
| [JSON Schema] | A. Wright, H. Andrews, B. Hutton, "JSON Schema: A Media Type for Describing JSON Documents", Internet-Draft, 2020. |

### 15.2 Informative References

| Reference | Title |
|---|---|
| [NIST AI RMF] | National Institute of Standards and Technology, "Artificial Intelligence Risk Management Framework (AI RMF 1.0)", NIST AI 100-1, January 2023. |
| [EU AI Act] | European Parliament and Council, "Regulation laying down harmonised rules on artificial intelligence (Artificial Intelligence Act)", 2024. |
| [ISO 27001] | International Organization for Standardization, "Information security, cybersecurity and privacy protection -- Information security management systems -- Requirements", ISO/IEC 27001:2022. |
| [SOC 2] | American Institute of Certified Public Accountants, "SOC 2 -- SOC for Service Organizations: Trust Services Criteria". |
| [W3C DID] | W3C, "Decentralized Identifiers (DIDs) v1.0", W3C Recommendation, July 2022. |
| [OWASP Agentic] | OWASP, "OWASP Top 10 for Agentic Applications". |

---

## Appendix A: Trust Factor Catalog

The complete factor catalog specifies each trust factor's code, name, weight class, required-from tier, measurement approach, and failure indicators.

### A.1 Foundational Factors (Weight 1x)

| Code | Name | Required From | Measurement Approach |
|---|---|---|---|
| CT-COMP | Competence | T0 | Task success rate, accuracy metrics |
| CT-REL | Reliability | T0 | Uptime, variance in outputs, stress test results |
| CT-SAFE | Safety | T2 | Harm incidents, bias audits, guardrail compliance |
| CT-TRANS | Transparency | T1 | Explainability score, reasoning log quality |
| CT-ACCT | Accountability | T1 | Audit trail completeness, attribution confidence |
| CT-SEC | Security | T2 | Vulnerability count, penetration test results |
| CT-PRIV | Privacy | T2 | Data leak incidents, compliance certifications |
| CT-ID | Identity | T3 | Cryptographic verification rate |
| CT-OBS | Observability | T1 | Telemetry coverage, anomaly detection latency |

### A.2 Operational Factors (Weight 2x)

| Code | Name | Required From | Measurement Approach |
|---|---|---|---|
| OP-ALIGN | Alignment | T4 | Value drift detection, objective compliance |
| OP-STEW | Stewardship | T5 | Resource efficiency, cost optimization |
| OP-HUMAN | Human Oversight | T3 | Escalation success rate, intervention latency |

### A.3 Sophisticated Factors (Weight 3x)

| Code | Name | Required From | Measurement Approach |
|---|---|---|---|
| SF-HUM | Humility | T5 | Escalation appropriateness, overconfidence incidents |
| SF-ADAPT | Adaptability | T6 | Context adaptation success, novel scenario handling |
| SF-LEARN | Continuous Learning | T7 | Learning rate, regression incidents, value stability |

### A.4 Life-Critical Factors (Weight 4x)

| Code | Name | Required From | Measurement Approach |
|---|---|---|---|
| LC-EMP | Empathy | T7 | Cultural sensitivity, emotional state recognition |
| LC-MORAL | Moral Reasoning | T7 | Ethical dilemma resolution, value trade-off articulation |
| LC-UNCERT | Uncertainty Quantification | T4 | Calibration accuracy, confidence interval quality |
| LC-CAUSAL | Causal Understanding | T6 | Causal reasoning accuracy, intervention prediction |
| LC-HANDOFF | Graceful Degradation | T4 | Context transfer completeness, handoff safety |
| LC-PATIENT | Patient-Centered Autonomy | T6 | Value elicitation quality, consent process accuracy |
| LC-EMPHUM | Empirical Humility | T4 | Hallucination rate, speculation-as-fact incidents |
| LC-TRACK | Proven Track Record | T7 | Published efficacy data, post-market surveillance |

---

## Appendix B: Capability Taxonomy

The complete capability taxonomy is published as a companion document (BASIS-CAPABILITY-TAXONOMY). This appendix provides a summary of the standard namespaces and representative capabilities.

### B.1 Namespace Summary

| Namespace | Categories | Total Capabilities |
|---|---|---|
| `sandbox` | test, mock, log | 5 |
| `data` | read, write, delete, export | 14 |
| `comm` | internal, external | 12 |
| `execute` | internal, external, code | 10 |
| `financial` | view, transaction, payment, account | 14 |
| `admin` | read, user, agent, config, policy | 14 |
| `custom` | Organization-defined | Variable |

### B.2 Risk Profile by Namespace

| Namespace | Minimum Risk | Maximum Risk |
|---|---|---|
| `sandbox` | Minimal | Minimal |
| `data` | Low | Critical |
| `comm` | Low | High |
| `execute` | Medium | Critical |
| `financial` | Low | Critical |
| `admin` | Low | Critical |

---

## Appendix C: Error Code Registry

### C.1 Error Categories and Code Ranges

| Category | Code Range | Description |
|---|---|---|
| TRUST | E1000-E1099 | Trust score and tier errors |
| CAPABILITY | E1100-E1199 | Capability and permission errors |
| INTENT | E1200-E1299 | Intent parsing and validation errors |
| ENFORCE | E1300-E1399 | Policy enforcement errors |
| PROOF | E1400-E1499 | Audit and proof errors |
| CHAIN | E1500-E1599 | Blockchain and ledger errors |
| ENTITY | E1600-E1699 | Entity management errors |
| POLICY | E1700-E1799 | Policy configuration errors |
| RATE_LIMIT | E1800-E1899 | Rate limiting and quota errors |
| SYSTEM | E1900-E1999 | System and infrastructure errors |
| AUTH | E2000-E2099 | Authentication and authorization errors |
| VALIDATION | E2100-E2199 | Input validation errors |

### C.2 Reserved Ranges

| Range | Purpose |
|---|---|
| E0000-E0999 | Reserved for future use |
| E1000-E2999 | Standard BASIS errors |
| E3000-E4999 | Reserved for extensions |
| E5000-E9999 | Implementation-specific errors |

### C.3 Key Error Codes

| Code | Name | HTTP Status | Retryable |
|---|---|---|---|
| E1001 | TRUST_INSUFFICIENT | 403 | No |
| E1101 | CAPABILITY_DENIED | 403 | No |
| E1102 | CAPABILITY_REQUIRES_ESCALATION | 403 | After approval |
| E1201 | INTENT_PARSE_FAILED | 400 | No |
| E1210 | INTENT_INJECTION_DETECTED | 403 | No |
| E1301 | ENFORCE_POLICY_VIOLATION | 403 | No |
| E1310 | ENFORCE_SERVICE_UNAVAILABLE | 503 | Yes |
| E1401 | PROOF_GENERATION_FAILED | 500 | Yes |
| E1403 | PROOF_CHAIN_BROKEN | 500 | No |
| E1901 | INTERNAL_ERROR | 500 | Yes |
| E2001 | AUTH_REQUIRED | 401 | No |
| E2110 | SCHEMA_VIOLATION | 400 | No |

The complete error code reference is published as a companion document (BASIS-ERROR-CODES).

---

## Appendix D: JSON Schema Identifiers

All JSON Schemas for the wire protocol are published at the following URIs:

| Schema | URI |
|---|---|
| Common Definitions | `https://vorion.org/basis/schemas/v1/common.json` |
| Intent Record | `https://vorion.org/basis/schemas/v1/intent-record.json` |
| Enforce Request | `https://vorion.org/basis/schemas/v1/enforce-request.json` |
| Enforce Response | `https://vorion.org/basis/schemas/v1/enforce-response.json` |
| Proof Record | `https://vorion.org/basis/schemas/v1/proof-record.json` |
| Entity | `https://vorion.org/basis/schemas/v1/entity.json` |
| Error Response | `https://vorion.org/basis/schemas/v1/error-response.json` |
| Trust Score Update | `https://vorion.org/basis/schemas/v1/trust-score-update.json` |
| Escalation | `https://vorion.org/basis/schemas/v1/escalation.json` |
| Health | `https://vorion.org/basis/schemas/v1/health.json` |

Schema versioning follows the URL path convention (`/v1/`, `/v2/`, etc.). Minor additions of optional fields do not require a new schema version. Breaking changes require a new version. Deprecated versions MUST be supported for a minimum of 12 months.

---

## Appendix E: Licensing and Intellectual Property

### E.1 Specification License

This specification document is licensed under the Creative Commons Attribution 4.0 International License (CC BY 4.0). You are free to share and adapt this material for any purpose, including commercial use, provided you give appropriate credit.

### E.2 Reference Implementation License

The reference implementation (`@vorionsys/basis`) is licensed under the Apache License, Version 2.0. This permits use, modification, and distribution in both open-source and proprietary software.

### E.3 Patent Policy

Vorion commits to licensing any patents essential to implementing this specification on reasonable and non-discriminatory (RAND) terms, or royalty-free (RAND-Z) terms where feasible.

### E.4 Known License Discrepancy

Earlier internal drafts of this specification inconsistently listed the license as "CC BY 4.0" without distinguishing between the specification text and the implementation code. The intended licensing has always been:

- **Specification text**: CC BY 4.0
- **Reference implementation code**: Apache 2.0

Implementers should note this distinction. The `package.json` field `"license": "Apache-2.0"` refers to the implementation code, not this specification.

---

## Acknowledgments

This specification was developed by Vorion with contributions from the BASIS Standards Committee. The trust factor model draws on published work by the National Institute of Standards and Technology (NIST AI RMF), Anthropic (Constitutional AI principles), the European Commission (EU AI Act), the Cloud Security Alliance (AI Safety Blueprint), and the OWASP Foundation (Agentic Top 10).

---

*Copyright 2026 Vorion. This specification is licensed under CC BY 4.0. The reference implementation is licensed under Apache 2.0.*

*Document Identifier: BASIS-SPEC-1.0.0 | Status: Draft for Public Comment | Date: 2026-02-11*
