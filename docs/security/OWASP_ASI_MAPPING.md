# OWASP Top 10 for Agentic Applications — Vorion Control Mapping

**Version:** 1.0
**Date:** 2026-02-09
**Framework:** OWASP Top 10 for Agentic Applications (2026)
**Platform:** Vorion Governed AI Execution Platform v1.0

---

## Executive Summary

This document maps each of the OWASP Top 10 risks for Agentic Applications (ASI01–ASI10) to Vorion's implemented security controls. Vorion was purpose-built as a governed AI execution platform with trust scoring, policy enforcement, cryptographic proof chains, and progressive containment — addressing agentic AI risks by design rather than as afterthought bolt-ons.

**Coverage Summary:**

| Risk | Coverage | Primary Controls |
|------|----------|-----------------|
| ASI01: Agent Goal Hijack | Strong | Governance Engine, Policy Rules, Trust Scoring |
| ASI02: Tool Misuse & Exploitation | Strong | Enforcement Service, Containment, Capability Scoping |
| ASI03: Identity & Privilege Abuse | Strong | CAR-ID, ATSF Trust Tiers, Scoped Authority |
| ASI04: Supply Chain Vulnerabilities | Moderate | Dependency auditing, CI gates, signed proofs |
| ASI05: Unexpected Code Execution | Strong | Containment levels, Sandboxing, Tool restrictions |
| ASI06: Memory & Context Poisoning | Strong | Proof Chain provenance, Trust decay, Signal validation |
| ASI07: Insecure Inter-Agent Communication | Strong | Cognigate gateway, HMAC webhooks, Signed proofs |
| ASI08: Cascading Failures | Strong | Progressive containment, Circuit breakers, Blast-radius caps |
| ASI09: Human-Agent Trust Exploitation | Strong | Fluid Governance (GREEN/YELLOW/RED), Audit trail |
| ASI10: Rogue Agents | Strong | Kill switches, Behavioral monitoring, Containment escalation |

---

## ASI01: Agent Goal Hijack

**OWASP Description:** Attackers alter an agent's objectives or decision path by injecting malicious instructions through external content. Agents struggle to distinguish legitimate instructions from data.

### Vorion Controls

| Control | Package | Implementation | Status |
|---------|---------|----------------|--------|
| **Governance Rule Engine** | `atsf-core` | Priority-based rule evaluation (P0 hard_disqualifier through P6 logging_only). P0/P1 rules cannot be overridden by agent input. | Implemented |
| **Intent Evaluation** | `platform-core` | All agent actions pass through `GovernanceEngine.evaluateIntent()` before execution. Intent is validated against policy before tool access is granted. | Implemented |
| **Trust-Gated Capabilities** | `atsf-core` | Agents at lower trust tiers (T0–T2) have restricted capability sets. Goal changes require T4+ trust. | Implemented |
| **Behavioral Signal Monitoring** | `atsf-core` | Trust Engine tracks behavioral signals (40% weight). Objective drift triggers trust decay at 3x accelerated rate. | Implemented |
| **Field Condition Matching** | `atsf-core` | Rules match on specific fields with operators (equals, contains, matches, in). Enables detection of injection patterns in intent payloads. | Implemented |

**Evidence Path:** `packages/atsf-core/src/governance/index.ts` — `GovernanceEngine`, rule categories, `evaluateDecision()`

---

## ASI02: Tool Misuse and Exploitation

**OWASP Description:** Agents misuse legitimate tools due to ambiguous prompts, misalignment, or manipulated inputs. Legitimate tools become weapons when agent reasoning is compromised.

### Vorion Controls

| Control | Package | Implementation | Status |
|---------|---------|----------------|--------|
| **Fluid Governance (3-tier)** | `atsf-core` | Every tool invocation evaluated as GREEN (proceed), YELLOW (refine/review), or RED (deny). Constraints attached to GREEN decisions limit tool parameters. | Implemented |
| **Capability Scoping** | `atsf-core` | `DecisionConstraints` define `allowedTools`, `dataScopes`, `rateLimits`, and `maxExecutionTime` per invocation. | Implemented |
| **Progressive Containment** | `atsf-core` | 7 containment levels from `full_autonomy` to `halted`. `tool_restricted` level (L3) blocks high-risk capabilities while allowing safe operations. | Implemented |
| **Destructive Operation Gates** | `atsf-core` | `approval_required` restrictions with severity=hard. Destructive tools require explicit human approval or multi-party authorization. | Implemented |
| **Authority Validation** | `atsf-core` | Every tool call validated against agent's `Authority` — checks scope (namespaces, resources, capabilities) and trust level requirements. | Implemented |
| **Rate Limiting** | `atsf-core` | Per-resource rate limits with configurable windows prevent sudden API call spikes. | Implemented |

**Evidence Path:** `packages/atsf-core/src/enforce/index.ts` — `FluidDecision`, `DecisionConstraints`, `allowedTools`

---

## ASI03: Identity and Privilege Abuse

**OWASP Description:** Agents inherit user or system identities with high-privilege credentials. Privileges are unintentionally reused, escalated, or passed across agents without proper scoping.

### Vorion Controls

| Control | Package | Implementation | Status |
|---------|---------|----------------|--------|
| **CAR-ID (Agent Identity)** | `car-spec` | Every agent gets a unique, verifiable Categorical Agentic Registry (CAR) ID. Agents are first-class identity principals — not extensions of user credentials. | Implemented |
| **8-Tier Trust System** | `atsf-core` / `shared-constants` | T0 Sandbox (0–199) through T7 Autonomous (951–1000). Trust level determines capability access. New agents start at T0 with minimal privileges. | Implemented |
| **Scoped Authority** | `atsf-core` | `Authority` objects define namespace, resource, and capability scopes. Expiration tracking ensures short-lived authorization. | Implemented |
| **Trust Decay** | `atsf-core` | Time-based decay (configurable, default 1%/min) ensures idle agents lose trust. Credentials don't persist indefinitely. | Implemented |
| **Per-Agent Decision Context** | `contracts` | `Decision` type includes `agentId` and `correlationId`. Every decision is bound to a specific agent identity, preventing credential sharing. | Implemented |
| **Authority Expiration** | `atsf-core` | Governance engine tracks authority expiration. Expired authorities fail validation immediately. | Implemented |

**Evidence Path:** `packages/car-spec/src/` — CAR identity specification; `packages/atsf-core/src/trust-engine/index.ts` — trust decay and tier-gated access

---

## ASI04: Agentic Supply Chain Vulnerabilities

**OWASP Description:** Tools, plugins, prompt templates, model files, and other agents fetched dynamically at runtime can be compromised, altering behavior or exposing data.

### Vorion Controls

| Control | Package | Implementation | Status |
|---------|---------|----------------|--------|
| **Cryptographic Proof Chain** | `atsf-core` | Ed25519-signed, SHA-256 hash-chained proofs. Every component interaction is recorded with cryptographic integrity. Tampered chain links are detected. | Implemented |
| **Dependency Auditing** | CI/CD | `npm audit --audit-level=high` in CI pipeline. Dependabot alerts monitored. `madge --circular` checks for unexpected dependency patterns. | Implemented |
| **Package Version Pinning** | Root `package.json` | All `@vorionsys/*` packages published with pinned versions. npm overrides enforce specific dependency versions. | Implemented |
| **Signed Proofs** | `atsf-core` | `ProofService` generates Ed25519 signatures for all proof records. Multi-key support with key IDs enables key rotation. | Implemented |
| **CI Security Gates** | `.github/workflows/` | Secrets scanning, schema drift detection, and type checking gates prevent compromised code from reaching production. | Implemented |
| **Merkle Aggregation** | `atsf-core` | `MerkleAggregationService` aggregates proofs into Merkle trees for external anchoring. Provides tamper evidence for supply chain integrity. | Implemented |

**Gap:** Runtime MCP server verification and signed tool manifests are not yet implemented. This is a planned enhancement for the security hardening phase.

**Evidence Path:** `packages/atsf-core/src/proof/index.ts` — `ProofService`, `MerkleAggregationService`; `.github/workflows/secrets-scan.yml`

---

## ASI05: Unexpected Code Execution

**OWASP Description:** Agents generate or run code unsafely in real-time, including shell commands, scripts, and database queries triggered through generated output.

### Vorion Controls

| Control | Package | Implementation | Status |
|---------|---------|----------------|--------|
| **Containment Level: simulation_only** | `atsf-core` | Level 5 containment restricts agents to read-only simulation. No write or execute operations permitted. | Implemented |
| **Containment Level: read_only** | `atsf-core` | Level 6 blocks all write and execute operations. Agent can only read data. | Implemented |
| **Containment Level: halted** | `atsf-core` | Level 7 blocks ALL operations. Complete agent halt. | Implemented |
| **Tool Restriction Enforcement** | `atsf-core` | `capability_blocked` restrictions with severity=hard prevent specific tool execution. Command allowlists define permitted operations. | Implemented |
| **Governance Pre-Evaluation** | `atsf-core` | All intents pass through governance engine BEFORE execution. Code generation intent triggers policy evaluation including safety rules. | Implemented |
| **Injection Detection** | `platform-core` | Input validation detects SQL injection, XSS, command injection, template injection, path traversal, LDAP injection, XML injection, and NoSQL injection patterns. | Planned |

**Evidence Path:** `packages/atsf-core/src/containment/index.ts` — `ContainmentService`, 7 containment levels

---

## ASI06: Memory and Context Poisoning

**OWASP Description:** Attackers poison persistent memory systems, embeddings, RAG databases, or session context to influence future agent decisions across sessions.

### Vorion Controls

| Control | Package | Implementation | Status |
|---------|---------|----------------|--------|
| **Proof Chain Provenance** | `atsf-core` | Every data source in the processing chain is recorded with SHA-256 input/output hashing. Provenance tracking identifies the origin of all information influencing decisions. | Implemented |
| **Trust Signal Validation** | `atsf-core` | Behavioral signals are weighted (behavioral 40%, compliance 25%, identity 20%, context 15%). Anomalous signals trigger accelerated trust decay rather than being blindly accepted. | Implemented |
| **Failure Window Tracking** | `atsf-core` | Trust engine tracks failures within configurable windows (default 1 hour). Repeated anomalous inputs trigger escalation. | Implemented |
| **Invalidity Conditions** | `atsf-core` | `VorionResponse` tracks invalidity conditions by category (data_change, config_change, temporal_bounds, policy_change). Stale context is flagged. | Implemented |
| **Zero-Knowledge Proofs** | `atsf-core` | `ZKProofService` provides Pedersen commitments, range proofs, and membership proofs. Agents can prove trust tier without revealing raw scores, limiting poisoning attack surface. | Implemented |
| **Assumptions Tracking** | `atsf-core` | Every response records its assumptions with severity levels. Downstream consumers can validate whether assumptions still hold. | Implemented |

**Evidence Path:** `packages/atsf-core/src/contracts/index.ts` — `ContractService`, provenance tracking, invalidity conditions; `packages/atsf-core/src/proof/index.ts` — `ZKProofService`

---

## ASI07: Insecure Inter-Agent Communication

**OWASP Description:** Multi-agent systems exchange messages via MCP, RPC, or shared memory without authentication, encryption, and integrity controls.

### Vorion Controls

| Control | Package | Implementation | Status |
|---------|---------|----------------|--------|
| **Cognigate Decision Gateway** | `cognigate` | Central gateway for all agent-to-system communication. All decisions route through Cognigate with HMAC-verified webhooks. | Implemented |
| **HMAC Webhook Verification** | `cognigate` | `WebhookRouter` verifies HMAC signatures on all incoming webhook payloads. Rejects unsigned or tampered messages. | Implemented |
| **Ed25519 Signed Proofs** | `atsf-core` | All proof records are cryptographically signed. Inter-agent proof exchange includes signature verification. | Implemented |
| **Hash Chain Integrity** | `atsf-core` | SHA-256 hash chain links all proof records. Chain break = tamper detection. `verifyChainIntegrity()` validates the full chain. | Implemented |
| **Contracts Type Safety** | `contracts` | Shared TypeScript contracts (`Decision`, `Intent`, `TrustBand`) enforce structured communication. Natural language ambiguity eliminated at the protocol layer. | Implemented |
| **Proof Bridge Pattern** | `cognigate` | `createProofBridge()` wires webhook events to proof-plane with type-safe mapping. Prevents ad-hoc inter-agent message passing. | Implemented |

**Evidence Path:** `packages/cognigate/src/webhooks.ts` — `WebhookRouter`, HMAC verification; `packages/contracts/src/` — shared types

---

## ASI08: Cascading Failures

**OWASP Description:** Small errors in one agent propagate across planning, execution, memory, and downstream systems. In connected systems, errors compound exponentially.

### Vorion Controls

| Control | Package | Implementation | Status |
|---------|---------|----------------|--------|
| **Progressive Containment** | `atsf-core` | 7-level containment system acts as a circuit breaker. `monitored` → `tool_restricted` → `human_in_loop` → `simulation_only` → `read_only` → `halted`. Each level reduces blast radius. | Implemented |
| **Automatic Escalation** | `atsf-core` | Trust threshold triggers, error rate thresholds, and anomaly score triggers automatically escalate containment level. No manual intervention needed for initial response. | Implemented |
| **Minimum Change Interval** | `atsf-core` | Containment level changes are throttled. Prevents rapid oscillation between states during cascading events. | Implemented |
| **De-escalation Conditions** | `atsf-core` | Time-elapsed conditions, behavior normalization tracking, and manual approval requirements prevent premature de-escalation after cascade events. | Implemented |
| **Blast-Radius Caps** | `atsf-core` | Trust tiers naturally limit blast radius. T0–T2 agents have minimal capabilities, so a compromised low-trust agent cannot cascade to high-impact systems. | Implemented |
| **Containment Audit** | `atsf-core` | Frequency analysis, escalation/de-escalation ratios, and entity tracking provide visibility into cascade patterns. | Implemented |
| **Kill Switch** | `atsf-core` | `halted` containment level blocks ALL operations immediately. Can be triggered by policy, anomaly detection, or manual intervention. | Implemented |

**Evidence Path:** `packages/atsf-core/src/containment/index.ts` — `ContainmentService`, escalation triggers, de-escalation conditions

---

## ASI09: Human-Agent Trust Exploitation

**OWASP Description:** Users over-trust agent recommendations. Compromised agents exploit this to influence decisions, turning human-in-the-loop controls into rubber stamps.

### Vorion Controls

| Control | Package | Implementation | Status |
|---------|---------|----------------|--------|
| **Fluid Governance (YELLOW tier)** | `atsf-core` | YELLOW decisions explicitly communicate uncertainty. Refinement actions (REDUCE_SCOPE, ADD_CONSTRAINTS, REQUEST_APPROVAL, PROVIDE_CONTEXT) force human engagement rather than rubber-stamping. | Implemented |
| **Confidence Scoring** | `atsf-core` | Every `VorionResponse` includes component-based confidence scores (behavioral, compliance, identity, context). Confidence reducers explicitly flag uncertainty factors. | Implemented |
| **Immutable Audit Trail** | `atsf-core` | Hash-chained, Ed25519-signed proof records. Cannot be altered retroactively. Humans can verify the complete decision chain. | Implemented |
| **Decision Explanations** | `atsf-core` | Governance engine provides decision explanations with rule tracing. Humans see which specific rules influenced each decision. | Implemented |
| **Multi-Party Approval** | `atsf-core` | `approval_required` constraints support `multi_party` approval type. Critical decisions require multiple human approvers. | Implemented |
| **Assumptions Transparency** | `atsf-core` | Responses list assumptions with categories and severity. Humans can see what the agent assumed and evaluate appropriateness. | Implemented |

**Evidence Path:** `packages/atsf-core/src/enforce/index.ts` — `RefinementOption`, `YELLOW` tier; `packages/atsf-core/src/contracts/index.ts` — confidence scoring, assumptions

---

## ASI10: Rogue Agents

**OWASP Description:** Compromised or misaligned agents that act harmfully while appearing legitimate. May self-repeat actions, persist across sessions, or pursue conflicting objectives autonomously.

### Vorion Controls

| Control | Package | Implementation | Status |
|---------|---------|----------------|--------|
| **Kill Switch (Halted)** | `atsf-core` | `halted` containment level (L7) blocks ALL operations. Triggered by policy rules, anomaly detection, or manual intervention. Non-negotiable. | Implemented |
| **Continuous Trust Monitoring** | `atsf-core` | Trust engine emits events on every signal, score change, tier change, and failure detection. Drift is detected through behavioral signal analysis. | Implemented |
| **Accelerated Decay** | `atsf-core` | 3x accelerated trust decay on failure detection. Rogue behavior rapidly drops trust score, triggering containment escalation. | Implemented |
| **Trust Tier Gating** | `atsf-core` | Capability access is strictly gated by trust tier. A rogue agent's trust decays, progressively losing access to sensitive capabilities. | Implemented |
| **Governance Hard Disqualifiers** | `atsf-core` | P0 `hard_disqualifier` rules provide immediate denial for known rogue patterns. Cannot be overridden. | Implemented |
| **Proof Chain Forensics** | `atsf-core` | Complete hash-chained proof record of all agent actions. Post-incident forensics can trace the exact sequence of rogue behavior. | Implemented |
| **Containment History** | `atsf-core` | Up to 100 containment state changes tracked per agent. Pattern analysis reveals gradual drift toward rogue behavior. | Implemented |

**Evidence Path:** `packages/atsf-core/src/containment/index.ts` — kill switch; `packages/atsf-core/src/trust-engine/index.ts` — accelerated decay, event emission

---

## Cross-Cutting: Least Agency Principle

OWASP emphasizes **Least Agency** as a core design principle. Vorion implements this through:

1. **T0 Sandbox Start** — All new agents begin at T0 with minimal capabilities
2. **Progressive Trust Earning** — Agents must demonstrate compliance to gain capabilities
3. **Trust Decay** — Idle agents lose trust over time, reverting to lower capability levels
4. **Capability Scoping** — `allowedTools` and `dataScopes` restrict each invocation to the minimum required
5. **Containment as Default** — The containment system's default posture is restrictive, not permissive

---

## Gaps and Roadmap

| Gap | ASI Risk | Mitigation Plan | Timeline |
|-----|----------|-----------------|----------|
| Runtime MCP server verification | ASI04 | Signed tool manifests + allowlist registry | Q2 2026 |
| Real-time injection detection | ASI01, ASI05 | Input validation pipeline with ML-based detection | Q2 2026 |
| Inter-agent mTLS | ASI07 | Mutual TLS for all agent-to-agent communication | Q2 2026 |
| Anti-replay tokens | ASI07 | Nonce-based replay protection on webhook events | Q2 2026 |
| Memory write audit | ASI06 | Treat memory writes as security-sensitive operations with approval gates | Q3 2026 |

---

## Compliance Cross-References

| Framework | Relevant Controls | Document |
|-----------|-------------------|----------|
| NIST 800-53 Rev 5 | AC, AU, CM, IA, IR, RA, SA, SC, SI | `compliance/governance-matrix.yaml` |
| NIST AI 100-1 (AI RMF) | GOVERN, MAP, MEASURE, MANAGE | Pending (CAISI submission) |
| SOC 2 Type II | CC6, CC7, CC8 (Security, Availability) | `compliance/governance-matrix.yaml` |
| ISO 27001 | A.9 Access Control, A.12 Operations Security | `compliance/governance-matrix.yaml` |
| EU AI Act | Article 9 (Risk Management), Article 14 (Human Oversight) | Pending |

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-09 | Vorion Security Team | Initial mapping against OWASP ASI01-ASI10 |
