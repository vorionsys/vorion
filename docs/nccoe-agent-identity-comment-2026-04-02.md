# NCCoE Concept Paper Response: Software and AI Agent Identity and Authorization
## "Accelerating the Adoption of Software and AI Agent Identity and Authorization"

**To:** AI-Identity@nist.gov
**Re:** Comment on NCCoE Concept Paper — Software and AI Agent Identity and Authorization
**Organization:** Vorion
**Contact:** Alex Blanc and Ryan Cason — contact@vorion.org | https://vorion.org
**Submission Date:** March 2026
**Comment Deadline:** April 2, 2026

---

## Introduction

Vorion submits this comment to the NCCoE's concept paper on AI agent identity and authorization from the perspective of an organization that has built and deployed a working reference implementation of agent identity, trust-based authorization, and non-repudiation. The BASIS Standard (basis.vorion.org) and the Vorion platform (github.com/vorionsys/vorion) constitute, to our knowledge, the most complete open-source implementation of the patterns the NCCoE paper explores. We address each of the paper's feedback categories with implementation evidence rather than design proposals.

---

## 1. Use Cases: How Vorion Uses AI Agent Identity Today

**The central use case that drove our architecture:** In enterprise deployments, AI agents routinely act with elevated permissions — accessing databases, calling external APIs, writing files, triggering workflows — while using credentials inherited from human user sessions. When things go wrong, no audit trail distinguishes "the human did this" from "the human's agent did this on the human's behalf without their direct involvement." This ambiguity is a liability, compliance, and attribution problem simultaneously.

**Our deployed use cases for agent identity:**

| Use Case | Agent Identity Need | Vorion's Approach |
|----------|--------------------|--------------------|
| Enterprise workflow automation | Distinguish agent vs. human actions in audit logs | CAR-ID: unique agent ID never derived from user session |
| Multi-agent orchestration | Verify which agent in a chain produced which output | Ed25519 signatures on every governance decision record |
| Regulated industry deployments (finance, healthcare) | Demonstrate to auditors that agent actions were authorized | Proof chains tied to specific agent identities + trust tiers |
| Trust-based access control | Authorization level that adapts to observed behavior | Trust tier (T0–T7) as a dynamic authorization scope |
| Cross-agent delegation | Track authority chains in multi-agent systems | Explicit delegation records with provenance in proof chain |

---

## 2. Challenges: What AI Agents Require That Existing Identity Frameworks Do Not Provide

Existing identity standards (SAML, OAuth 2.0, OIDC, FIDO2) were designed for three actor types: humans, services, and devices. AI agents break all three analogies:

**Why AI agents are not humans:**
- Agents act continuously without authentication events — there is no "login" moment that triggers session establishment
- Multiple agent instances may operate simultaneously, sharing identity attributes but requiring distinct audit trails
- Agents may be ephemeral (created, run, destroyed within a single workflow)

**Why AI agents are not service accounts:**
- Services have static, well-defined behavior; agents have emergent, variable behavior
- A service's permissions are fixed at deployment; an agent's authorized scope should change based on observed behavioral history
- Services fail in defined ways; agents introduce novel failure modes (drift, misalignment) that static identity controls cannot detect

**Why AI agents are not devices:**
- Devices have physical identity anchors (TPM, hardware attestation); agents have no equivalent
- Device identity is stable; agent "identity" in the sense of capability and trustworthiness changes over time

**The three identity gaps that must be addressed:**

1. **Persistent, portable identity** — An agent needs an identifier that persists across sessions, deployments, and infrastructure changes. It cannot be tied to a container ID, process ID, or API key (all of which change). Our CAR-ID (Categorical Agentic Registry ID) is a UUID permanently assigned to an agent logical entity, valid for the lifetime of the agent regardless of where or how it runs.

2. **Behavioral attestation** — Identity alone is insufficient for agents. What matters for authorization is not just *who* the agent is, but *how it has behaved*. Our trust tier (T0–T7) is effectively a behavioral attestation: a statement that this agent has accumulated a specific history of successful compliance with governance constraints. Authorization decisions use the tier as the primary access control variable.

3. **Cryptographic non-repudiation of agent actions** — When an agent takes an action, there must be a tamper-evident record linking that action to the specific agent identity at a specific moment in time. Our proof chains use Ed25519 signatures to bind each governance decision to the agent's CAR-ID, creating non-repudiation records that survive agent redeployment, infrastructure migration, and time.

---

## 3. Standards: Current and Emerging Standards Relevant to Agent Identity

**Standards we build on:**

| Standard | How We Apply It | Gap for AI Agents |
|----------|----------------|------------------|
| **OAuth 2.0 / OIDC** | Agent identity tokens follow JWT structure; CAR-ID is included as a custom claim | No standard claim for agent trust tier or behavioral history |
| **NIST SP 800-63 (Digital Identity Guidelines)** | Agent identity lifecycle (provisioning, maintenance, revocation) follows SP 800-63 assurance levels | No IAL/AAL/FAL equivalent for agents; no guidance on behavioral assurance |
| **NIST SP 800-53 (Security Controls)** | IA (Identification and Authentication) family applied to agent identity | IA controls assume human or service actors; no agent-specific controls |
| **FIDO2 / WebAuthn** | Inspired our Ed25519 signing model; we use the same curve | Hardware binding inapplicable; agents have no physical authenticator |
| **W3C DID (Decentralized Identifiers)** | CAR-ID design considered DID compatibility | DID resolution infrastructure not yet appropriate for high-frequency agent interactions |
| **IETF RFC 9700 (Best Current Practices for OAuth)** | Token expiry and minimal scope principles applied | Does not address behavior-contingent scope expansion/contraction |

**Emerging standards we recommend the NCCoE examine:**

1. **Model Context Protocol (MCP) by Anthropic** — Defines tool-use APIs for agents but currently has no identity or credential specification. A NIST profile for MCP identity would have broad immediate impact given MCP's adoption rate.

2. **Google A2A Protocol (Agent-to-Agent)** — Defines inter-agent communication but authentication is API-key-based with no trust tier or behavioral context. An identity extension for A2A is a high-value standards gap.

3. **The BASIS Standard (Vorion, Apache-2.0)** — An open standard specifying agent trust scoring, governance, and identity (CAR-ID) with a reference implementation. We offer this to the NCCoE as input material for the project.

---

## 4. Technologies: What Vorion Uses in Production

**Agent identity infrastructure:**

```
CAR-ID (UUID v4)
  └── Assigned at agent registration
  └── Persistent across deployments and infrastructure changes
  └── Never derived from human session credentials
  └── Bound via Ed25519 signature to all governance records

Trust Score (0–1000)
  └── Computed from behavioral signals (Behavioral 40%, Compliance 25%,
      Identity 20%, Context 15%)
  └── Asymmetric: failures apply tier-scaled 7–10× penalty; recoveries are deliberately smaller
  └── Time-decays with 182-day half-life (idle agents lose authority)
  └── Determines trust tier (T0 Sandbox → T7 Autonomous)
  └── Trust tier = effective authorization scope

Proof Chain
  └── SHA-256 forward chain with SHA3-256 parallel integrity anchor
  └── Ed25519 signature per record, keyed to CAR-ID
  └── Periodic Merkle aggregation for external anchoring
  └── Every governance decision produces a signed proof record
  └── Chain completeness verified on every append
```

**Authorization model:**

We use trust tier as the primary access control dimension instead of role assignments. Each trust tier unlocks a capability envelope:

| Tier | Score | Effective Authorization |
|------|-------|------------------------|
| T0 Sandbox | 0–199 | Read-only; all actions require human approval |
| T1 Observed | 200–349 | Basic tool access; enhanced logging |
| T2 Provisional | 350–499 | Standard tools; rate-limited; sensitive ops require review |
| T3 Monitored | 500–649 | Full standard toolset; continuous monitoring |
| T4 Standard | 650–799 | Extended tools + external APIs; most operations proceed automatically |
| T5 Trusted | 800–875 | Cross-namespace access; elevated scope |
| T6 Certified | 876–950 | Administrative operations; can countersign others' intent approvals |
| T7 Autonomous | 951–1000 | Unrestricted within policy; self-governing |

When an agent's trust score drops (e.g., due to policy violation), its tier drops and its authorization scope contracts automatically — no policy rule update required. This is the key advantage over static RBAC for dynamic systems.

---

## 5. Detailed Questions on Identification, Authorization, Auditing, Non-Repudiation, and Prompt Injection

### 5a. Identification of AI Agents

**Core recommendation:** Agent identity must be a first-class concept, not derived from user sessions or service accounts. The NCCoE project should specify:

1. A persistent agent identifier format (we recommend UUID or DID) that survives infrastructure changes
2. A provisioning process analogous to SP 800-63 enrollment, including verification of agent purpose, tool scope, and initial trust tier
3. An agent registry (analogous to a certificate authority) that maintains active agent catalog, revocation lists, and behavioral history anchors
4. Decommissioning procedures that revoke identity tokens but preserve audit records

**The "junior employee" pattern:** We have found the most useful mental model is treating agent identity like a new employee: they get issued credentials on their first day (CAR-ID), they start with limited access (T0 Sandbox), and they earn expanded authority through demonstrated reliable behavior. Their employee record persists even after they leave (audit retention). This pattern maps cleanly to existing HR and identity lifecycle processes most enterprises already have.

### 5b. Authorization of AI Agents

**Core recommendation:** Authorization for AI agents must be dynamic and behavior-contingent, not static and role-based. The NCCoE project should specify:

1. A trust tier system (or equivalent behavioral signal) that adjusts authorization scope based on observed compliance
2. Per-decision authorization constraints (not just per-role): each approved action should specify exact tools allowed, data scopes, rate limits, and expiry
3. A three-tier decision model (approve with constraints / refine scope / deny) rather than binary allow/deny — the middle tier is essential for reducing false-positive denials in high-accuracy agents
4. Delegation chain specifications: when Agent A delegates to Agent B, the delegation must be explicit, recorded, and bounded by Agent A's authorization scope (no privilege escalation through delegation)

**YAML policy example (from our implementation):**
```yaml
intent_approval:
  agent_id: "car-id-550e8400-e29b-41d4-a716"
  trust_tier: T3
  decision: GREEN
  constraints:
    allowed_tools: ["search", "read_document", "draft_response"]
    data_scopes: ["namespace:client-A", "namespace:public"]
    rate_limits: [{resource: "external_api", limit: 50, window: "1h"}]
    max_execution_time: 60000
    reversibility: preferred
    expiry: "2026-03-09T18:00:00Z"
```

### 5c. Auditing of AI Agent Actions

**Core recommendation:** Every agent action that produces external state change must produce a signed audit record linked to the agent's persistent identity. The audit record must be:

1. **Tamper-evident** — hash-chained so any modification is detectable
2. **Non-deniable** — signed with the agent's identity key so the agent (or the system operating it) cannot disavow the action
3. **Contextual** — including the agent's trust tier at time of action, the policy rules evaluated, the decision rendered, and any constraints applied
4. **Retention-compliant** — structured to support redaction of PII while preserving chain integrity (we achieve this via pseudonymization: proof records reference CAR-IDs, not user identities)

**Audit system performance:** In our reference implementation, proof logging runs at ~10ms typical (target <50ms). High-throughput deployments use batched Merkle anchoring rather than per-action external verification, achieving linear scaling.

### 5d. Non-Repudiation

Non-repudiation for AI agents requires answering three questions that traditional non-repudiation does not:

1. **Did this agent take this action?** → Ed25519 signatures on proof records, keyed to CAR-ID
2. **Was the agent authorized to take it at that time?** → Trust tier recorded at time of action; policy evaluation record included in proof
3. **Has the record been modified since?** → SHA-256 forward chain with SHA3-256 parallel anchor; Merkle tree for batch verification

**The unique challenge:** Unlike human non-repudiation (where the signatory controls their own key), agent key management requires an organizational key custody model. We recommend the NCCoE project specify key escrow procedures for agent identity keys, including how keys are rotated when an agent is updated (model version change, prompt update, tool change) without losing historical chain validity.

### 5e. Prompt Injection Mitigations at the Identity Layer

Most prompt injection defenses are implemented at the model or input-filtering layer. We recommend the NCCoE project also specify identity-layer mitigations that do not require solving prompt injection at the model level:

1. **Trust penalty on injection attempts** — When an agent produces an output that triggers a governance RED decision (probable injection indicator), the agent's trust score is decremented as if it had acted on the injected instruction. This creates behavioral evidence of injection susceptibility without requiring injection detection.

2. **Scope containment as injection defense** — An agent operating under T0–T2 constraints cannot cause material harm even if successfully injected, because the governance layer blocks execution of the injected instruction. Least-privilege authorization is the most robust injection mitigation available today.

3. **Instruction source attestation** — Agent identity systems should support tagging instructions by source (human-provided system prompt vs. retrieved content vs. tool output). Instructions from unverified sources should be evaluated under stricter governance rules regardless of content. This is analogous to network packet source validation — we should not assume equal trustworthiness of all inputs.

4. **Behavioral fingerprinting** — Baseline each agent's tool usage patterns and flag deviations as potential injection indicators. An agent that suddenly attempts to access data scopes it has never accessed before, or calls tools in unusual sequences, should trigger elevated review regardless of whether injection is confirmed.

---

## Recommendations for the NCCoE Project

Based on our implementation experience, we recommend the NCCoE project focus on three deliverables with high immediate impact:

1. **An agent identity credential profile** — A NIST-defined JWT/credential format that includes: persistent agent ID, trust tier or behavioral assurance level, issued-at timestamp, key reference for signature verification, and tool scope declaration. This profile could be an extension to OIDC that existing IAM vendors implement.

2. **An agent authorization model reference architecture** — Specifically addressing the behavioral authorization gap: how authorization scope contracts and expands based on observed behavior, and what policies govern scope changes. This should produce an implementation guide compatible with existing policy engines (OPA, Cedar, XACML).

3. **An inter-agent trust chain specification** — How agents verify each other's identity and trust level before accepting delegated instructions. This is the multi-agent authentication gap that poses the greatest current risk as MCP and A2A deployments scale.

We offer the entire Vorion reference implementation (Apache-2.0) and the BASIS Standard (Apache-2.0) as input materials for the project, and welcome participation in the NCCoE's community of interest for this effort.

---

**Respectfully submitted,**

Vorion
https://vorion.org
contact@vorion.org

---

*Prepared: March 2026*
*For submission to: AI-Identity@nist.gov*
*Re: NCCoE Concept Paper — Accelerating the Adoption of Software and AI Agent Identity and Authorization*
*Comment deadline: April 2, 2026*
