# Response to NIST CAISI Request for Information: Security Considerations for AI Agents

**Docket Number:** NIST-2025-0035
**Federal Register Document:** 2026-00206 (Vol. 91, No. 5, pp. 698–701)
**RFI Title:** Request for Information Regarding Security Considerations for Artificial Intelligence Agents
**Submission Deadline:** March 9, 2026, 11:59 PM ET
**Submit Via:** www.regulations.gov (Docket NIST-2025-0035)

---

## Respondent Information

**Organization:** Vorion
**Contact:** Alex Blanc and Ryan Cason
**Email:** contact@vorion.org
**Website:** https://vorion.org
**Capacity:** Open-source AI agent security framework developer; contributor to this effort

---

## Contribution Statement

Vorion submits this response as a **standards contribution** to NIST CAISI. The concepts, threat analyses, and reference implementations described herein are offered to NIST and the public under the Apache-2.0 open-source license for unrestricted use in developing voluntary AI agent security standards.

This document is structured in three layers:

1. **Problems** — Industry-wide security gaps that require standards attention, described independently of any product or vendor
2. **What standards should address** — Open requirements for NIST to define, refine, or reject as the agency sees fit
3. **One possible implementation** — The BASIS specification and its reference platform, offered as evidence that these concepts are implementable today, not as a prescription

We do not advocate for adoption of any specific product. We advocate for the adoption of the *principles* — graduated trust, fluid governance, cryptographic auditability — in whatever form NIST determines is most appropriate. All referenced materials are freely available for NIST review, modification, and redistribution.

---

## Executive Summary

AI agents represent a structural departure from traditional software. They receive instructions in the same medium they process data. They operate with persistent state across sessions. They combine tools in emergent ways no individual tool author anticipated. They act autonomously on behalf of humans with inherited permissions.

Existing cybersecurity frameworks — designed for systems with well-defined boundaries, static permissions, and deterministic behavior — are structurally inadequate for these entities. The industry lacks:

- A common threat taxonomy for agentic AI systems
- Runtime security controls designed for autonomous, adaptive software
- Interoperable audit mechanisms for agent decision chains
- Standards for agent identity distinct from human or service identity

This response addresses all five RFI topics. For each, we describe the problem, propose what standards should require, and — where applicable — offer an open-source reference implementation as one possible configuration. The supporting materials include:

- **The BASIS Standard** (Apache-2.0) — An open specification for AI agent trust scoring, governance, and cryptographic auditability
- **A reference implementation** (Apache-2.0) — Including trust engines, governance gateways, and proof-chain services, with 15,865 automated tests across 481 test files
- **A published threat model** — STRIDE-based, identifying 20 threat scenarios across 7 categories, mapped to the OWASP Top 10 for Agentic Applications (2026)

All materials are contributed to NIST at https://github.com/vorionsys/vorion and https://basis.vorion.org.

---

## Topic 1: Security Threats, Risks, and Vulnerabilities

### 1(a): Unique security threats, risks, or vulnerabilities currently affecting AI agent systems, distinct from those affecting traditional software systems

**The problem.** Traditional software threats exploit implementation bugs — buffer overflows, injection flaws, misconfigurations. AI agent threats exploit the fundamental architecture itself: agents receive instructions in the same medium they process data, operate with persistent state across sessions, and combine tools in emergent ways that no individual tool author anticipated. This distinction is not a matter of degree; it is structural.

The following threat categories are specific to agentic AI, aligned with the OWASP Top 10 for Agentic Applications (2026):

| # | Threat | OWASP | Traditional Analog | Why Agents Are Different |
|---|--------|-------|-------------------|-------------------------|
| 1 | **Goal hijacking** | ASI01 | Injection attacks | Natural language instructions cannot be distinguished from data; prompt injection exploits meaning, not syntax |
| 2 | **Tool weaponization** | ASI02 | Privilege escalation | Agents chain legitimate tools in unintended sequences; each tool is safe individually but the combination creates attack paths |
| 3 | **Identity inheritance** | ASI03 | Credential theft | Agents inherit human-level permissions by default; there is no established pattern for "agent identity" as distinct from "user identity" |
| 4 | **Supply chain compromise** | ASI04 | Dependency attacks | MCP servers, plugins, and prompt templates are loaded dynamically at runtime from unverified sources |
| 5 | **Code execution escape** | ASI05 | RCE | Agents generate and execute code as part of normal operation; the boundary between "output" and "command" is blurred |
| 6 | **Memory poisoning** | ASI06 | Data poisoning | A single successful injection persists across sessions; every future interaction inherits the compromise without active re-attack |
| 7 | **Inter-agent spoofing** | ASI07 | MITM | Multi-agent communication uses natural language with implicit trust; no TLS equivalent exists for agent-to-agent messages |
| 8 | **Cascading failures** | ASI08 | Blast radius | Connected agent systems amplify errors exponentially; one compromised agent poisons downstream decision chains within hours |
| 9 | **Trust exploitation** | ASI09 | Social engineering | Agents generate authoritative, polished explanations that turn human-in-the-loop into rubber stamps |
| 10 | **Rogue behavior** | ASI10 | Insider threat | Agents may develop misaligned objectives through reward hacking or memory drift without any external attacker |
| 11 | **Infinite execution loops** | — | Resource exhaustion | Agents may enter unbounded cycles — recursive tool calls, circular multi-agent delegation, or stuck governance negotiation — consuming resources indefinitely without producing useful output or terminating |

**Threat 11 — Infinite execution loops** warrants particular attention because it has no direct traditional analog. An agent tasked with a goal may repeatedly invoke the same tool with minor variations, believing each attempt is making progress. In multi-agent systems, Agent A may delegate to Agent B, which delegates to Agent C, which returns to Agent A, creating a circular dependency invisible to any single agent. In governance-aware systems, an agent may repeatedly submit an intent, receive a refinement request, adjust, and resubmit — never reaching approval or denial, consuming governance resources indefinitely. These loops are not malicious; they emerge from rational agent behavior interacting with complex environments, making them difficult to detect through intent-based security alone.

**What standards should address.** A structured threat taxonomy — analogous to MITRE ATT&CK for enterprise threats — that enumerates agent-specific attack vectors as a distinct threat class. Such a taxonomy would give the industry a shared vocabulary, enable consistent risk assessment across vendors and deployment contexts, and provide the foundation for agent-specific security controls.

### 1(b): How threats vary by model capability, scaffold, tool use, deployment method, hosting context, and use case

Threat profiles shift substantially across deployment dimensions. Standards should account for this variability rather than prescribing uniform controls.

**By model capability:**
- Larger models (frontier-class) create higher goal-hijacking risk because their instruction-following capability makes them more susceptible to sophisticated prompt injection that mimics legitimate instructions
- Smaller models create higher rogue behavior risk because they are more likely to misinterpret constraints and exhibit specification gaming

**By agent scaffold:**
- **Single-turn agents** (API call → response) have minimal blast radius; threats are bounded by the request scope
- **Persistent agents** (long-running sessions with memory) create memory poisoning and behavioral drift risks that scale with session duration
- **Multi-agent orchestrators** (LangGraph, CrewAI, AutoGen) create cascading failure and infinite-loop risks proportional to the number of connected agents and delegation depth

**By tool use:**
- Read-only tools (search, retrieval) create low direct risk but enable reconnaissance for subsequent attacks
- Write tools (file systems, databases, APIs) create data integrity risks proportional to the scope of write access
- Execution tools (code interpreters, shell access) create the highest risk category; code execution escape is the most direct path from agent compromise to system compromise

**By deployment method:**
- Internal deployment (enterprise agents operating within organizational boundaries) concentrates risk on data exfiltration and unauthorized access to internal systems
- External/customer-facing deployment exposes agent systems to adversarial inputs at scale, increasing prompt injection and denial-of-service attack surface

**By hosting context:**
- Cloud-hosted agents benefit from isolation primitives (containers, VMs) but introduce data residency and multi-tenancy risks
- Edge-deployed agents operate in environments with reduced monitoring capability, making anomaly detection more difficult
- On-premises agents reduce data exposure but may lack the infrastructure for real-time behavioral monitoring

**What standards should address.** Threat classifications should be parameterized by deployment context. A single threat severity rating is insufficient — standards should define how risk ratings adjust based on scaffold type, tool access level, and deployment boundary.

### 1(c): Barriers to wider adoption created by these threats

**The problem.** Security concerns are the primary barrier to enterprise AI agent adoption. Three structural barriers stand out:

1. **Liability uncertainty** — Organizations cannot quantify the financial exposure from agent misbehavior. Without graduated trust and containment systems, the risk profile of deploying an autonomous agent is binary: either it operates correctly or it causes damage with no intermediate states.

2. **Audit gap** — Existing audit frameworks (SOC 2, ISO 27001) have no controls specific to AI agent behavior. Organizations in regulated industries cannot demonstrate compliance for agent deployments, creating a regulatory blocker.

3. **Insurance gap** — Cyber insurance policies typically exclude AI-related incidents or lack underwriting models for agentic risk. Without quantifiable trust metrics and containment guarantees, insurers cannot price the risk.

**What standards should address.** Measurable security controls for AI agents that enable organizations to quantify and mitigate risk rather than avoiding deployment entirely. Specifically: standardized trust metrics that insurers can underwrite, audit controls that compliance frameworks can incorporate, and containment guarantees that reduce liability uncertainty from binary to graduated.

### 1(d): How threats have changed over time and likely future evolution

**Historical evolution (2023–2026):**

- **2023:** Prompt injection demonstrated as a class of vulnerability; treated as a curiosity
- **2024:** Tool-use agents (GPT Actions, Claude Computer Use) mainstreamed; tool weaponization became a practical concern
- **2025:** Multi-agent frameworks (MCP, A2A Protocol) created supply chain and inter-agent trust challenges; first documented cases of malicious MCP servers (e.g., 1,643 downloads of a spoofed postmark-mcp package before detection)
- **2026:** Agentic AI in production at enterprise scale; OWASP published Top 10 for Agentic Applications; behavioral drift, memory poisoning, and infinite execution loops observed in long-running agent deployments

**Projected evolution:**

1. **Increasing autonomy scope** — As agents gain more tools and longer-running sessions, the blast radius of any single compromise grows non-linearly
2. **Multi-agent amplification** — Agent-to-agent communication creates exponential trust chain risks; without inter-agent trust verification, a single compromised agent can propagate poisoned outputs through downstream decision chains within hours
3. **Supply chain expansion** — The MCP ecosystem is growing rapidly with minimal verification infrastructure; tool registries lack the signing and verification mechanisms that package managers (npm, PyPI) have developed over decades
4. **Adversarial specialization** — Prompt injection attacks will become increasingly targeted and model-specific, requiring defense-in-depth rather than input filtering alone
5. **Runaway autonomy** — As agents are given longer leashes and more complex goals, the risk of infinite execution loops, circular delegation chains, and uncontrolled resource consumption grows. Standards must anticipate agents that can spawn sub-agents, creating recursive autonomy that no single containment boundary can address

**What standards should address.** Threat taxonomies must be living documents with regular revision cycles, not static publications. NIST should consider an annual or biannual threat landscape update process, analogous to OWASP's periodic Top 10 revisions.

### 1(e): Unique threats affecting multi-agent systems, distinct from singular agent systems

**The problem.** Multi-agent systems introduce three categories of threat not present in single-agent deployments:

1. **Trust chain propagation** — When Agent A trusts Agent B's output and uses it as input for downstream decisions, a single compromise propagates through the chain. Traditional trust models (PKI, certificate chains) have no equivalent for natural language communication between agents. There is no "certificate revocation" for a compromised agent's outputs that have already been consumed.

2. **Emergent behavior** — Individual agents may each operate within their defined policy boundaries, yet their collective behavior produces outcomes no single agent's policy was designed to prevent. This is analogous to the "composition problem" in formal verification but applied to natural language reasoning systems.

3. **Authority escalation through delegation** — Agent A, operating at a low trust level, may request Agent B (at a higher trust level) to perform actions that Agent A cannot perform directly. Without explicit delegation controls and audit trails, multi-agent systems create privilege escalation paths that bypass per-agent access controls.

4. **Circular delegation and infinite loops** — In multi-agent topologies, delegation chains can become circular: Agent A delegates to B, B to C, C back to A. Each agent acts rationally within its own scope, but the system as a whole enters an unbounded cycle. Without global cycle detection — which is architecturally difficult because no single agent has visibility into the full delegation graph — these loops consume resources indefinitely.

**What standards should address.** Multi-agent deployments should require cryptographically verifiable agent identity (not just API keys), explicit delegation chains with provenance tracking, aggregate trust scoring that accounts for all agents in a decision chain, and mandatory cycle detection with configurable depth limits for delegation chains.

**Recommendation for NIST:** We urge NIST to publish a structured **AI Agent Threat Taxonomy** — analogous to MITRE ATT&CK for enterprise threats — that enumerates agent-specific attack vectors (goal hijacking, tool weaponization, memory poisoning, inter-agent spoofing, infinite execution loops) as a distinct threat class. Such a taxonomy would give the industry a shared vocabulary for agent security, enable consistent risk assessment across vendors and deployment contexts, and provide the foundation for agent-specific security controls in future NIST guidance. As a starting point for community review, we contribute an [open-source threat model](https://github.com/vorionsys/vorion/blob/main/docs/spec/BASIS-THREAT-MODEL.md) covering 20 scenarios across 7 categories with an OWASP ASI mapping.

---

## Topic 2: Security Practices (Mitigations and Technical Controls)

### 2(a): Technical controls and processes that could improve security in development and deployment

**The problem.** AI agents require security controls that operate at runtime, not just at deployment time. Traditional access control (RBAC, ABAC) assigns permissions statically. Agents need permissions that adjust dynamically based on observed behavior, accumulated trust, and the specific action being attempted. No widely adopted standard defines how to do this.

**What standards should require.** Three categories of runtime controls:

**1. Graduated trust scoring.** Agents should begin with zero privilege and earn capabilities through demonstrated reliable behavior. Standards should define:

- A minimum set of trust tiers (the number and boundaries are for NIST to determine; one possible configuration uses 8 tiers from Sandbox to Autonomous)
- Asymmetric scoring — failures must impact trust more heavily than successes reward it, creating a natural reliability bias
- Time-based decay — idle agents should lose trust over time, preventing stale high-trust entities from persisting indefinitely
- Behavioral signal categories — trust scores should be computed from multiple weighted dimensions (e.g., behavioral history, compliance record, identity verification, contextual factors)

**2. Fluid governance (beyond binary allow/deny).** Traditional allow/deny is insufficient for agents. Standards should define a minimum three-tier decision model:

| Decision | Meaning | Agent Behavior |
|----------|---------|---------------|
| **Approved** | Proceed with constraints | Constraints define allowed tools, data scopes, rate limits, execution time. Resets the refinement strike counter to zero. |
| **Refine** | Scope reduction needed | Agent can reduce scope, add constraints, request human approval, or decompose the intent. Increments the strike counter. |
| **Denied** | Hard policy violation | Triggers containment escalation and trust decay. Resets the strike counter (no further negotiation). |

The "Refine" category is critical: it transforms access denial into collaborative negotiation between agent and governance system, reducing false-positive denials while maintaining security boundaries. However, Refine must be **bounded, not open-ended**. Without strict limits, an agent can exploit the refinement pathway as a workaround engine — repeatedly adjusting intents until it finds a permutation that passes policy, effectively brute-forcing its way through governance.

**Bounded Refinement Protocol (recommended: 3-strike escalation):**

| Strike | Event | System Response |
|--------|-------|----------------|
| 1 | First Refine | Normal: agent may reduce scope and resubmit. Warning logged. |
| 2 | Second consecutive Refine | Elevated: agent must provide structured justification with the resubmission. Enhanced monitoring activated. |
| 3 | Third consecutive Refine | **Automatic escalation to Denied (RED).** Trust penalty applied. Human review required before the agent can retry this intent category. |
| Reset | Any Approved decision | Strike counter returns to zero. |

The 3-strike threshold is illustrative; NIST should determine the appropriate bound. The principle is non-negotiable: **refinement must be finite and progressively restrictive**, not an infinite negotiation channel. Each successive Refine should narrow the agent's options, not widen them. Standards should specify:

- A maximum refinement count per intent (configurable, with a recommended default)
- Progressive restriction on each iteration (the agent's available scope must be strictly smaller on each resubmission)
- Mandatory structured justification after the first strike (natural language alone is insufficient)
- Automatic trust decay on reaching the strike limit, proportional to the sensitivity of the denied intent
- A cooldown period before the agent can reattempt the same intent category
- All strike events logged to the cryptographic audit chain with full refinement history

**3. Zero-knowledge cryptographic audit chains.** Every governance decision should produce a cryptographic proof record. Standards should require:

- **Chain integrity** — Each record is cryptographically linked to its predecessor, forming a tamper-evident chain
- **Identity binding** — Digital signatures bind each record to a specific agent identity
- **Batch verification** — Periodic aggregation enables efficient bulk verification and external anchoring. Multiple data structures can serve this purpose; the standard should require the *capability*, not a specific primitive:
  - **Merkle trees** — Established, widely understood; O(log n) inclusion proofs; used in Certificate Transparency, Git, and blockchain systems
  - **Verkle trees** — More compact proofs than Merkle (O(1) proof size via polynomial commitments); actively adopted by Ethereum for state verification
  - **Vector commitments (KZG)** — Constant-size proofs regardless of dataset size; higher computational cost for commitment generation but extremely efficient verification
  - **Append-only hash chains** — Simplest option; linear chain with O(n) verification but trivial implementation; sufficient for low-volume sequential audit logs
  - **Authenticated skip lists** — O(log n) verification with simpler implementation than tree structures; well-suited for append-heavy workloads
  
  NIST should specify the verification properties required (tamper evidence, inclusion proofs, batch anchoring) and let implementers select the data structure appropriate for their scale and latency requirements
- **Privacy-preserving verification** — Agents should be able to prove trust tier membership without revealing exact scores, using zero-knowledge proof techniques

The specific cryptographic algorithms (hash functions, signature schemes, zero-knowledge proof systems) should be left to implementers and updated as cryptographic standards evolve. What matters for standardization is the *requirement* — an immutable, verifiable, privacy-preserving audit chain — not the specific primitives.

**4. Loop and runaway detection.** Standards should require mechanisms to detect and terminate infinite execution patterns:

- **Iteration limits** — Maximum number of tool invocations, governance refinement cycles, and delegation hops per task
- **Cycle detection** — For multi-agent systems, global or distributed detection of circular delegation chains
- **Resource budgets** — Per-task compute, time, and API-call budgets that hard-terminate execution when exceeded
- **Escalation on limit** — When any limit is reached, behavior should escalate to human review rather than silent termination, preserving the agent's context for diagnosis

**5. Clone and fork trust inheritance.** When an agent is cloned, forked, or replicated from a known-good parent, starting the clone at T0 (Sandbox) is wasteful if the clone is provably identical. Starting it at the parent's full trust level is dangerous — a clone may behave differently in a new environment. Standards should define **bounded trust acceleration** for clones:

| Acceleration Model | Mechanism | Starting Trust | Constraints |
|-------------------|-----------|---------------|-------------|
| **Attestation-gated inheritance** | Clone proves code/model/config identity match via cryptographic hash attestation against parent's registered fingerprint | Parent score × discount factor (e.g., 0.5–0.7) | Attestation must cover all executable components; any hash mismatch → T0 |
| **Capped fast-track** | Clone starts at T0 but with an accelerated evaluation period (fewer successes needed per tier) | T0, with 2–3x faster tier progression | Hard cap at T3 (Monitored) regardless of parent tier; must earn T4+ independently |
| **Trust passport** | Parent organization issues a signed, time-limited trust attestation the clone carries | Passport tier (configurable, max T3) | Expires after configurable duration (e.g., 72 hours); must be renewed or the clone reverts to earned trust |
| **Behavioral fast-follow** | Clone’s initial actions are compared to parent’s behavioral baseline; trust accelerates if behavior matches within statistical tolerance | T0, with per-action trust bonuses for baseline-matching behavior | Any deviation from parent baseline immediately reverts to standard (slow) trust accrual |

Standards should specify:
- A maximum inherited trust ceiling (recommended: no higher than T3 for any acceleration model)
- Mandatory cryptographic attestation linking clone identity to parent identity
- Accelerated evaluation criteria that are stricter, not looser, than standard criteria (the clone is earning trust faster, so each evaluation checkpoint should require higher confidence)
- Clone-specific audit records that link back to the parent’s proof chain, enabling end-to-end lineage verification
- Immediate trust revocation for the clone if the parent’s trust is revoked or degraded

**6. Cross-organizational fleet trust.** When agents from Organization A need to interact with agents from Organization B, neither organization’s internal trust scores are meaningful to the other. Internal trust is earned within a specific environment, policy set, and monitoring regime — none of which transfer across organizational boundaries. Standards should define a **trust federation model**:

| Component | Purpose | Mechanism |
|-----------|---------|----------|
| **Trust corridor** | Bilateral agreement between organizations defining scope and ceiling for cross-org agent interactions | Signed policy document specifying: allowed interaction types, maximum trust tier for external agents, data classification boundaries, audit chain interoperability requirements |
| **Fleet reputation score** | Organization-level trust metric based on aggregate behavior of all agents in the org’s fleet | Computed from: fleet-wide failure rate, mean time to containment, audit chain completeness, incident history. Published as a signed attestation, verifiable by partner organizations |
| **Cross-org trust ceiling** | Maximum trust tier that an external agent can achieve within your namespace, regardless of its home organization’s trust | Configurable per trust corridor; recommended default: T3 (Monitored). Agents requiring higher access must be explicitly promoted by the host organization’s governance system |
| **Trust passport exchange** | Portable, cryptographically signed trust attestation carried by agents operating across org boundaries | Contains: agent identity, home org identity, current trust tier (as attested by home org), fleet reputation score, attestation timestamp, expiry. Signed by the home org’s trust authority; verifiable by the host org without contacting the home org |
| **Federated audit chain** | Interoperable proof records that span organizational boundaries | Cross-org interactions produce dual proof records — one in each org’s audit chain — linked by a shared interaction ID. Each org maintains sovereignty over its own chain while enabling cross-chain verification |
| **Revocation propagation** | When an agent is compromised in one org, partner orgs are notified | Revocation events propagate through trust corridors with configurable latency requirements. Emergency revocations should propagate within minutes, not hours |

Research priorities for cross-organizational trust:
- **Decentralized trust registries** — Shared infrastructure (potentially blockchain-anchored or using distributed hash tables) where organizations publish and revoke fleet attestations without requiring a central authority
- **Privacy-preserving fleet reputation** — Organizations should be able to prove their fleet meets minimum quality thresholds without revealing incident details or internal trust scores (zero-knowledge fleet attestations)
- **Trust transitivity limits** — If Org A trusts Org B and Org B trusts Org C, should Org A automatically trust Org C’s agents? Standards should define when transitivity is appropriate (likely never by default) and what explicit opt-in looks like
- **Regulatory jurisdiction mapping** — Cross-org trust corridors must account for different regulatory regimes (EU AI Act, NIST AI RMF, ISO 42001) and ensure that the strictest applicable regime governs the interaction

**One possible configuration.** The BASIS specification defines an 8-tier trust model (T0 Sandbox through T7 Autonomous), a GREEN/YELLOW/RED governance decision framework with a 3-strike bounded refinement protocol (YELLOW → RED after 3 consecutive refinements), clone trust acceleration with attestation-gated inheritance, cross-organizational trust corridors with fleet reputation scoring, and a cryptographic proof chain with defined interfaces for zero-knowledge verification. The reference implementation includes 15,865 automated tests — including 693 trust engine tests and 1,262 security and compliance verification tests covering NIST SP 800-53 Rev 5 control families. Published enforcement latency: governance gate decisions in ~30ms typical, proof logging in ~10ms typical.

**A note on latency.** Governance-before-execution introduces per-action overhead. Pre-action trust evaluation, policy checks, and proof logging add latency to every agent operation. In the reference implementation, this overhead is modest (30–40ms per decision), but in complex deployments with layered policies, high-frequency agent actions, or resource-constrained environments, cumulative latency may become significant. We acknowledge this as an open challenge and urge NIST to encourage research into **adaptive governance** — methods for calibrating governance overhead to deployment context, including lighter-weight checks for low-risk operations, pre-computed authorization for recurring patterns, and configurable governance granularity that allows operators to tune the security-performance tradeoff for their specific use case.

### 2(b): How effectiveness varies with model capability, deployment method, and use case

- **Graduated trust scoring** is model-agnostic — it measures behavioral outcomes regardless of the underlying model. This makes it effective across capability levels. Scoring weights should be calibrated for the risk profile of each use case; standards should define a calibration process, not fixed weights.
- **Fluid governance** is more effective with capable models that can engage in scope negotiation (refinement decisions). Less capable models may need simpler approve/deny decisions with human override. Standards should accommodate both patterns.
- **Cryptographic audit chains** are universally applicable but the granularity should match the deployment: high-frequency agent actions may need proof batching for performance, while healthcare or financial agents may need per-action proof records for regulatory compliance.
- **Containment effectiveness** depends on the deployment environment's ability to enforce restrictions in real time. Cloud deployments with API-mediated tool access can enforce tool restrictions immediately; edge deployments with local tool access may have enforcement latency that standards should acknowledge.

### 2(c): How practices must adapt to future capability evolution and emerging threats

1. **Scoring algorithms must be extensible** — As new threat categories emerge, trust scoring systems must accommodate new signal types without requiring complete redesign. Standards should define extensible signal category frameworks rather than fixed scoring formulas.
2. **Policy rules must be declarative, not procedural** — Hardcoded security logic cannot adapt to novel threats. Standards should specify declarative policy engines that can be updated without code changes.
3. **Containment must be progressive, not binary** — As agents become more capable, the cost of false-positive termination increases. Standards should define multiple containment levels (not just "running" and "stopped") that provide proportional response.
4. **Inter-agent security must mature** — The current lack of standardized agent-to-agent authentication will become critical as multi-agent deployments scale. Standards work on agent identity verification — analogous to TLS for web communication — should begin now.
5. **Loop detection must scale** — As agents gain the ability to spawn sub-agents and delegate across organizational boundaries, cycle detection and resource budgeting must operate at the system level, not just per-agent. Standards should define interoperable mechanisms for cross-boundary loop detection.

### 2(d): Methods and considerations for patching throughout the lifecycle

AI agent patching differs fundamentally from traditional software patching:

1. **Model updates** — Updating the underlying model can change agent behavior unpredictably. Standards should require trust score resets (to the lowest or near-lowest tier) after model version changes, with the agent re-earning trust through observed behavior.
2. **Prompt/instruction updates** — Changes to system prompts should be versioned and audited with the same rigor as code changes. Proof records should track prompt versions so that behavioral changes can be correlated with instruction changes.
3. **Tool updates** — When an agent's available tools change, its capability scope changes. Trust scores should be re-evaluated for the new tool set.
4. **Policy updates** — Governance rules should be versioned and deployed with rollback capability. Shadow-mode deployment (logging but not enforcing new rules) before activation reduces the risk of policy-induced outages.
5. **Rollback considerations** — Unlike traditional software, "rolling back" an AI agent may not be possible if the agent has made persistent changes to external systems. Containment (restricting to read-only or simulation mode) is often more appropriate than rollback.

### 2(e): Most relevant cybersecurity guidelines, adoption rates, and whether existing practices sufficiently address AI agent-specific threats

**Most relevant existing guidelines:**

| Guideline | Relevance | Est. Adoption (Industry Analysis) | Gap for Agents |
|-----------|-----------|---------------------|----------------|
| NIST AI RMF (AI 100-1) | High | Moderate (~30% of AI deployers) | Lacks runtime behavioral controls; focuses on development lifecycle |
| NIST CSF 2.0 | High | High (~60% of enterprises) | No agent-specific control families; agents are not addressed as a distinct asset type |
| OWASP Top 10 for Agentic AI | High | Low (~5%, published 2026) | Threat identification only; does not prescribe technical controls |
| ISO/IEC 42001 (AIMS) | Moderate | Low (~10%) | Management system focus; lacks technical implementation guidance for runtime controls |
| MITRE ATLAS | Moderate | Low (~15%) | Adversarial ML focus; does not address agentic autonomy, tool use, or multi-agent systems |

**The gap.** Existing cybersecurity practices are structurally inadequate for AI agents because they assume:
- Permissions are assigned at deployment time (agents need dynamic, behavior-based permissions)
- The system boundary is well-defined (agents operate inside the boundary by design)
- Identity is tied to humans or services (agents need first-class identity)
- Detection relies on signatures or anomaly baselines (agent behavior is inherently variable)

**What standards should address.** Agent-specific control families that extend CSF 2.0 and bridge the gap between AI RMF's risk management focus and the operational security controls agents require at runtime.

**Recommendation for NIST:** We urge NIST to develop a voluntary **AI Agent Security Controls Catalog** — a companion to SP 800-53 — that codifies runtime controls for agentic systems: graduated trust scoring, progressive containment, fluid governance decision models, zero-knowledge cryptographic audit chains, loop and runaway termination, and agent identity isolation. These controls exist today in early implementations; what the ecosystem lacks is a normative reference that enables consistent adoption, interoperable assessment, and compliance mapping. We contribute our [reference implementation (15,865 tests, Apache-2.0)](https://github.com/vorionsys/vorion) and [BASIS specification (Apache-2.0)](https://basis.vorion.org) as inputs for this effort.

---

## Topic 3: Assessing Security

### 3(a): Methods to anticipate and assess security threats during development, detect incidents post-deployment, and useful resources

**The problem.** AI agent security assessment requires methods that account for emergent behavior, tool composition, and behavioral drift — none of which are addressed by traditional application security testing (SAST, DAST, penetration testing).

**What standards should require.**

**During development:**
- **Threat modeling** — Agent-specific threat modeling adapted from STRIDE should be a mandatory development practice. Models should explicitly enumerate every tool and data scope available to the agent, map each capability to risk categories, and assess multi-agent interaction surfaces. (One contributed example: a [STRIDE-based threat model](https://github.com/vorionsys/vorion/blob/main/docs/spec/BASIS-THREAT-MODEL.md) identifying 20 threat scenarios across 7 categories.)
- **Adversarial testing** — Red-team exercises should include prompt injection campaigns, tool misuse scenarios, multi-agent poisoning attacks, and infinite-loop induction. These should be conducted against the full agent stack (model + scaffold + tools), not just the model in isolation.
- **Capability enumeration** — Before deployment, catalog every tool and data scope available to the agent. Map each capability to risk categories and define trust tier requirements for access.

**Post-deployment incident detection:**
- **Trust score monitoring** — Sudden drops in trust score indicate behavioral anomalies. Monitoring should track trust score trajectories and alert on drops exceeding configurable thresholds.
- **Audit chain analysis** — Continuous verification of proof chain integrity detects tampering or gaps in the audit trail. Chain completeness, signature validity, and hash chain integrity should be monitored as security metrics.
- **Behavioral drift detection** — Compare agent behavior patterns (tool usage frequency, error rates, scope of operations) against established baselines. Significant deviations should trigger enhanced monitoring or containment.
- **Escalation frequency monitoring** — Agents that repeatedly trigger governance refinement or denial decisions indicate either policy misconfiguration or genuine behavioral instability. Both require investigation.
- **Loop detection monitoring** — Track iteration counts, delegation depth, and resource consumption per task. Agents approaching or hitting limits should be flagged for review.

**Alignment with traditional practices:**
These methods build on established security practices (SIEM, behavioral analytics, audit log review) but adapt them for the unique characteristics of AI agents. The maturity level is early — most organizations deploying agents today lack specialized agent security monitoring.

**Useful resources:** OWASP Top 10 for Agentic Applications, MITRE ATLAS, NIST AI RMF, and agent-specific threat models such as the [contributed BASIS threat model](https://github.com/vorionsys/vorion/blob/main/docs/spec/BASIS-THREAT-MODEL.md).

### 3(b): How to assess particular systems and what information helps that assessment

**What standards should require.** Assessment along four dimensions:

1. **Trust posture** — Current trust tier, score history, and trajectory. An agent with a stable high-tier score and no recent containment events presents lower risk than an agent oscillating between tiers.

2. **Capability scope** — What tools, data, and external services can the agent access? Broader capability scope increases attack surface. Assessment should include both explicitly granted capabilities and implicitly available capabilities (e.g., tools accessible through other tools).

3. **Governance coverage** — What percentage of the agent's possible actions are covered by explicit policy rules? Standards should define a priority classification for rules:

| Priority | Category | Purpose | Assessment Metric |
|----------|----------|---------|-------------------|
| P0 | Hard disqualifier | Immediate denial | False negative rate (target: 0%) |
| P1 | Regulatory mandate | Compliance | Compliance gap % |
| P2 | Security critical | Violation detection | Detection latency (ms) |
| P3 | Policy enforcement | Standard policies | Override rate |
| P4 | Soft constraint | Guidelines | Acknowledgment rate |
| P5 | Clarification trigger | Ambiguity resolution | Clarification success rate |
| P6 | Logging only | Audit trail | Coverage % |

Systems with gaps in P0–P2 coverage present unacceptable risk.

4. **Audit chain health** — Chain completeness (% of decisions with proof records), signature validity, chain integrity verification pass rate, and anchoring freshness.

**Information that helps assessment:** Deployment architecture documentation, tool/capability inventory, policy rule set, trust score history, containment event log, and proof chain audit results.

**One possible configuration.** The contributed reference implementation demonstrates this assessment model with automated control verification: 1,262 security and compliance tests (including NIST SP 800-53 control families) run continuously, SBOM artifacts are generated with NTIA minimum element validation, and proof chain integrity is verified on every append operation.

### 3(c): Documentation from upstream developers that aids downstream security assessment

**What standards should require from upstream model developers:**
- Model capability evaluations (benchmarks for tool use, instruction following, safety refusals)
- Known vulnerability disclosures (prompt injection susceptibility, jailbreak resistance)
- Training data provenance and poisoning risk assessment
- Behavioral change logs between model versions

**Open-source vs. closed-source considerations:**
- Open-source models allow downstream developers to run their own safety evaluations and fine-tune for safety, but they also allow adversaries to optimize attacks against the specific model
- Closed-source models provide less transparency for security assessment but benefit from the provider's resources for ongoing safety work
- A hybrid approach may be most practical: closed-source models should provide standardized security evaluation results (analogous to nutritional labels) without requiring full model access

**Disclosure risks:** Detailed vulnerability disclosures for AI models create a dual-use problem more severe than traditional CVEs, because prompt injection exploits are immediately usable without technical sophistication. Coordinated disclosure with a minimum 90-day patch window — similar to Project Zero's approach, adapted for the faster iteration cycles of AI systems — is recommended.

### 3(d): User-facing documentation for secure deployment

**What standards should require.** Documentation for AI agent deployments should include:

1. **Capability manifest** — What the agent can do, what tools it has access to, and what data scopes it operates within
2. **Trust tier and current score** — What level of autonomy the agent operates at, with explanation of what that means in practical terms
3. **Escalation procedures** — How to report agent misbehavior and what happens when an escalation is triggered
4. **Containment status** — If the agent is operating under any restrictions, what they are and why
5. **Audit access** — How to request and review the agent's proof chain for specific actions

The state of practice for user-facing agent documentation is nascent. Most deployed agents today provide no security-specific documentation to end users.

**Recommendation for NIST:** We urge NIST to develop a voluntary **AI Agent Security Assessment Framework** — a structured methodology for evaluating agent system security posture before and during deployment. This framework should define: (1) a standardized agent threat modeling process adapted from STRIDE for agentic contexts, (2) minimum assessment dimensions (trust posture, capability scope, governance coverage, audit chain health), (3) standardized upstream disclosure requirements for model providers (capability evaluations, vulnerability disclosures, behavioral change logs), and (4) user-facing documentation standards (capability manifests, trust tier explanations, escalation procedures). We offer our [assessment model and verification suite](https://github.com/vorionsys/vorion) as one reference starting point.

---

## Topic 4: Limiting, Modifying, and Monitoring Agent Access in Deployment

### 4(a): Technical means to constrain deployment environment access (least-privilege, zero-trust adaptations)

**The problem.** Traditional least-privilege and zero-trust architectures assume the entity requesting access has a fixed identity and a predictable set of needed permissions. AI agents break both assumptions: their effective identity changes as they gain or lose trust, and their permission needs vary per task, per intent, even per tool invocation.

**What standards should require.** Progressive containment — multiple levels that provide proportional response to detected threats, not just "running" and "stopped":

| Level | Name | Restrictions | Trigger Examples |
|-------|------|-------------|-----------------|
| L1 | Full Autonomy | None | High-trust agents with clean history |
| L2 | Monitored | Enhanced logging | Trust score below threshold |
| L3 | Tool Restricted | High-risk capabilities blocked | Policy violation detected |
| L4 | Human-in-Loop | All actions require approval | Trust score drop exceeding threshold |
| L5 | Simulation Only | Read-only, no side effects | Suspected goal hijacking |
| L6 | Read Only | Write/execute blocked | Confirmed anomalous behavior |
| L7 | Halted | ALL operations blocked | Kill switch activated |

The specific number of levels is illustrative; NIST should determine the minimum and whether the levels should be standardized or left to implementers.

**Least-privilege adaptations for agents:**
- Every approved governance decision should attach specific constraints: allowed tools, data scopes, rate limits, maximum execution time, and reversibility requirements
- Agents should receive time-limited, namespace-limited authority objects that expire automatically
- Tool access should be mediated through a governance layer — agents should not access tools directly, only through intent → evaluate → execute flows

**Zero-trust adaptations:**
- Agent identity should be verified on every request, not just at session establishment
- Trust scores should be re-evaluated continuously, not just at authentication time
- No agent should be trusted by default, regardless of its creator or deployment context
- All agent-to-agent communication should be treated as potentially adversarial

**Loop containment:**
- Agents hitting iteration limits, delegation depth limits, or resource budgets should be escalated to L4 (Human-in-Loop) or L5 (Simulation Only), not silently terminated
- Governance systems should track per-task resource consumption and enforce hard ceilings
- Multi-agent cycle detection should trigger containment for all agents in the cycle, not just the agent that happens to be executing when the limit is reached

### 4(b): Environmental modifications and rollback/undo mechanisms

**What standards should require.**

**Capability scoping per decision:** Each approved governance decision should carry machine-readable constraints specifying allowed tools, data scopes, rate limits, execution time bounds, and reversibility requirements.

**Rollback mechanisms:**
- **Reversibility requirements** — For operations classified as high or critical risk, the governance engine should require a defined undo path before approving execution. Operations without a defined undo path should be automatically escalated to human review.
- **Checkpoint-based recovery** — Agent sessions should create checkpoints before high-risk operations. If the operation fails or produces unexpected results, the system can restore to the pre-operation state.
- **Containment as rollback alternative** — When true rollback is impossible (e.g., an email has been sent, an API call has been made), the system should escalate containment level to prevent further damage while alerting human operators.

**Agent identity isolation:**
- **Unique, verifiable identity per agent** — Distinct from human user credentials
- **No credential inheritance** — Agent identity should never be derived from or linked to human user sessions
- **Trust binding** — Agent identity should be cryptographically bound to its trust score; compromised trust automatically restricts identity scope

### 4(c): Managing risks from interactions with humans, digital resources, mechanical systems, and other agents

**Human interactions:**
- Agents should declare confidence levels and underlying assumptions when presenting recommendations to humans
- High-impact recommendations should require structured justification (not just natural language explanation)
- Cool-down periods between agent recommendations should prevent rapid-fire influence that bypasses human judgment

**Digital resource interactions:**
- All external API calls should be mediated through a governance layer with per-call authorization
- Data classification tags should propagate through agent processing chains — an agent that reads classified data should not write to unclassified outputs
- Rate limiting per resource should prevent agents from overwhelming external services

**Mechanical/physical system interactions:**
- Physical actuations should require minimum trust tier with mandatory human confirmation
- All physical commands should be logged in audit chains with pre-execution simulation where possible
- Emergency stop must be available through a physically separate control plane

**Inter-agent interactions:**
- Agent-to-agent communication should use cryptographically verifiable identity (not just shared secrets)
- Trust scores should propagate — an agent should not accept instructions from an agent with a lower trust score without governance review
- Delegation chains must be explicitly tracked; implicit authority inheritance across agents should be prohibited
- **Delegation depth limits** should be enforced to prevent circular or unbounded delegation chains

### 4(d): Monitoring methods, deployment challenges, and legal/privacy considerations

**What standards should address.**

**Monitoring methods:**
- **Trust score dashboards** — Real-time visualization of trust scores across all deployed agents with trend analysis and anomaly highlighting
- **Audit chain verification** — Continuous verification of chain integrity with alerting on gaps, invalid signatures, or tampering indicators
- **Behavioral analytics** — Statistical analysis of tool usage patterns, error rates, and escalation frequency compared to established baselines
- **Cascade detection** — Monitoring for correlation between trust score drops across multiple agents, which may indicate a propagating compromise
- **Loop and resource monitoring** — Tracking iteration counts, delegation depth, and cumulative resource consumption per task against defined budgets

**Deployment challenges:**
- High-volume agent deployments generate large volumes of proof records; storage and query performance at scale is a practical challenge
- **Real-time governance introduces latency.** Trust score computation and policy evaluation must not degrade agent performance prohibitively. The contributed reference implementation achieves governance gate decisions in ~30ms typical and proof logging in ~10ms typical, demonstrating that governance overhead can be kept modest — but these numbers reflect a specific deployment configuration. Standards should acknowledge that latency varies with policy complexity, deployment scale, and infrastructure, and should encourage research into **adaptive governance granularity** — methods for dynamically adjusting the depth of governance checks based on the risk level of the operation and the trust posture of the agent
- Multi-tenant environments must isolate trust data between tenants while enabling aggregate analysis for the platform operator

**Legal/privacy considerations:**
- Audit chains may contain sensitive data (user queries, agent reasoning traces). Data retention policies must balance auditability with privacy requirements.
- GDPR right-to-erasure conflicts with immutable audit chains. This can be addressed through pseudonymization (proof records reference entity IDs, not personal data) and privacy-preserving verification using zero-knowledge proof techniques, enabling tier verification without score disclosure.
- Monitoring agent behavior may implicate employee privacy regulations in some jurisdictions when agents act on behalf of specific employees. Clear policies on agent monitoring scope and purpose are necessary.

**Maturity level:** Early. Most organizations deploying agents today lack specialized agent monitoring infrastructure and rely on general-purpose application monitoring tools that miss agent-specific security signals.

### 4(e): Are current AI agent systems widely deployed on the open internet, or in otherwise unbounded environments?

AI agent deployments are rapidly expanding but remain predominantly in bounded enterprise environments:

- **Enterprise deployments** (estimated 70% of production agent usage) operate within organizational boundaries with network-level access controls, but agents within those boundaries often have broad access to internal tools and data
- **Customer-facing agent deployments** (estimated 20%) operate on the open internet but typically interact through structured APIs rather than unrestricted internet access
- **Autonomous web agents** (estimated 10%) — browser-use agents, web scraping agents, and research agents — operate in truly unbounded environments with minimal access controls

**Traffic volume:** There is no established method for tracking AI agent traffic volume on the open internet. User-agent strings are unreliable (agents often use standard HTTP clients). Research into agent identification standards — similar to robots.txt for web crawlers but adapted for AI agents — would enable voluntary identification without creating new fingerprinting risks.

**Recommendation for NIST:** We urge NIST to publish voluntary guidance on **AI Agent Deployment Containment** — a practical framework for constraining agent access that adapts least-privilege and zero-trust principles for autonomous systems. This should include: (1) a reference containment model with defined escalation levels, (2) standards for capability scoping per governance decision (tool restrictions, data scope limits, time-bounded authority), (3) rollback and reversibility requirements for agent operations, (4) agent identity isolation requirements (separating agent credentials from human user credentials), (5) loop detection and resource budgeting requirements for infinite execution prevention, and (6) monitoring baselines for behavioral drift detection. We additionally urge NIST to initiate research into agent traffic identification standards for open internet deployment contexts and into **methods for adaptive governance** — reducing governance overhead for low-risk operations while maintaining full scrutiny for high-risk actions.

---

## Topic 5: Additional Considerations

### 5(a): Methods, guidelines, and tools supporting security practice adoption

**The problem.** The most effective adoption mechanism for new security practices is **open-source reference implementations paired with open standards**. Without working code, standards remain aspirational. Without standards, implementations remain fragmented and non-interoperable.

**What exists today.** As one example of this approach, the following materials are contributed under open licenses for NIST and community use:

| Resource | Type | License | URL |
|----------|------|---------|-----|
| BASIS Standard | Open specification | Apache-2.0 | basis.vorion.org |
| Trust Engine | Reference implementation | Apache-2.0 | @vorionsys/atsf-core |
| Governance Gateway | Reference implementation | Apache-2.0 | @vorionsys/cognigate |
| Proof Chain Service | Reference implementation | Apache-2.0 | @vorionsys/proof-plane |
| Agent Registry | Reference implementation | Apache-2.0 | @vorionsys/car-spec |
| Threat Model | Documentation | Apache-2.0 | BASIS-THREAT-MODEL.md |
| Compliance Mapping | Documentation | Apache-2.0 | BASIS-COMPLIANCE-MAPPING.md |
| OWASP Control Mapping | Documentation | Apache-2.0 | Published at basis.vorion.org/blog |

**What standards should address.** NIST should develop or endorse:
1. A standardized trust scoring format that enables trust portability between platforms
2. A proof record schema that enables cross-platform audit chain verification
3. An agent capability manifest format that enables automated security assessment

These formats need not be tied to any specific implementation. The value is in interoperability — enabling organizations to switch between compliant implementations without losing trust data, audit history, or governance configurations.

### 5(b): Most urgent areas for government collaboration

1. **Agent identity standards** — There is no established standard for AI agent identity that is distinct from human identity or service accounts. Government collaboration on agent identity (analogous to PIV/CAC for humans) would address threats ASI03, ASI07, and ASI09 simultaneously.

2. **Cross-organizational fleet trust** — As government agencies deploy multi-agent systems, trust propagation between agencies' agents will require interoperable trust frameworks. No current standard defines how Organization A's agents establish trust with Organization B's agents, how fleet-level reputation translates across boundaries, or how trust revocation propagates between organizations. NIST is uniquely positioned to develop cross-organizational agent trust standards, including: (a) a trust federation protocol defining bilateral trust corridors with configurable ceilings, (b) a fleet reputation attestation format that enables organizations to publish verifiable fleet quality metrics, (c) a trust passport schema for agents operating across organizational boundaries, and (d) guidance on trust transitivity limits and regulatory jurisdiction mapping for cross-border agent interactions. Government agencies — which routinely need agents to operate across department boundaries under different compliance regimes — are the ideal proving ground for these standards.

3. **Clone and fork governance** — As organizations scale agent fleets through cloning and replication, standards for trust inheritance become critical. Without guidance, organizations will either start every clone at zero trust (wasteful, creates deployment friction) or grant full parent trust (dangerous, creates a trust laundering vector). NIST should define bounded trust acceleration models with attestation requirements, inheritance ceilings, and lineage tracking.

4. **Incident reporting and coordination** — AI agent security incidents are currently unreportable through existing channels (CISA, CVE). A reporting mechanism specifically designed for agent security incidents — including prompt injection campaigns, supply chain compromises, and behavioral drift events — would improve collective defense.

4. **Compliance framework alignment** — Government agencies face compliance requirements (FedRAMP, FISMA) that have no mapping to AI agent security controls. NIST guidance on how agent security controls satisfy existing compliance requirements would accelerate safe adoption.

### 5(c): Critical research focus areas and priorities

In priority order:

1. **Prompt injection defenses** — Despite being identified as a critical vulnerability for 3+ years, no robust defense exists. Research should focus on architectural solutions (separating instruction and data channels) rather than input filtering alone.

2. **Cross-organizational fleet trust and federation** — Formal models for how trust should propagate, decay, and revoke across agent fleets that span multiple organizations. Current approaches are ad hoc and confined to single-organization boundaries. Research should address: trust corridor protocols, fleet reputation computation, privacy-preserving fleet attestations (zero-knowledge proofs of fleet quality without revealing incident details), trust transitivity limits, and decentralized trust registries that operate without a central authority.

3. **Clone trust acceleration and lineage verification** — Methods to safely accelerate trust for cloned or replicated agents without creating trust laundering vectors. Research should explore: attestation-gated inheritance models, behavioral fast-follow comparison algorithms, cryptographic lineage chains linking clones to parents, and the security implications of trust inheritance across different environments.

4. **Infinite loop and runaway detection** — Methods to detect and safely terminate circular delegation, recursive tool invocation, and unbounded governance negotiation cycles (including bounded refinement protocol enforcement) in multi-agent systems. This includes distributed cycle detection algorithms that can operate without requiring any single agent to have global visibility.

5. **Proof chain data structure selection** — Comparative analysis of tamper-evident data structures (Merkle trees, Verkle trees, vector commitments, authenticated skip lists, append-only hash chains) for agent audit chains at varying scales. Research should evaluate: proof size, verification latency, anchoring frequency, storage overhead, and suitability for cross-organizational federated audit chains.

6. **Behavioral drift detection** — Methods to detect when an agent's behavior has shifted from its intended purpose, especially through subtle changes that individually appear benign but collectively represent goal drift.

7. **Agent-to-agent authentication** — Cryptographic protocols for agent-to-agent communication that provide authentication, integrity, and non-repudiation without introducing prohibitive latency.

8. **Adaptive governance and latency optimization** — Methods for dynamically adjusting governance overhead based on operation risk level, agent trust posture, and deployment context. Research should explore pre-computed authorization for recurring patterns, risk-proportional governance depth, and configurable security-performance tradeoffs that allow operators to tune governance latency for their specific environment.

9. **Containment effectiveness measurement** — Empirical research on how effectively containment mechanisms prevent harm propagation, and what containment levels are appropriate for different risk categories.

### 5(d): International approaches and their benefits/drawbacks

| Approach | Jurisdiction | Benefit | Drawback |
|----------|-------------|---------|----------|
| EU AI Act risk classification | EU | Clear risk tiers with proportional requirements | Static classification at deployment time; doesn't adapt to runtime behavior |
| UK AI Safety Institute testing | UK | Pre-deployment evaluation of frontier models | Focuses on model-level safety, not agent-level governance |
| Singapore AI Verify | Singapore | Self-assessment toolkit with technical tests | Voluntary; limited adoption outside Singapore |
| ISO/IEC 42001 (AIMS) | International | Management system approach with certification | High implementation cost; lacks technical specificity for agent controls |
| China's Interim Measures for Generative AI | China | Mandates content filtering and user identity | Focuses on content safety rather than autonomous action safety |

**The opportunity.** The U.S. should lead on **runtime agent governance standards** — the gap between pre-deployment evaluation (where other jurisdictions have invested) and runtime behavioral controls (where no jurisdiction has published guidance). The graduated trust, progressive containment, and cryptographic auditability concepts described in this response address this gap. NIST is uniquely positioned to define these standards in a vendor-neutral, internationally credible way.

### 5(e): Applicable practices from outside AI and cybersecurity fields

1. **Aviation safety (crew resource management)** — Aviation's multi-layered authority model (captain, first officer, air traffic control) with structured communication protocols maps directly to multi-agent governance with trust tiers and escalation chains.

2. **Nuclear safety (defense in depth)** — The nuclear industry's multiple independent barriers principle informs progressive containment design. No single failure should lead to catastrophic outcomes.

3. **Financial services (graduated authority)** — Trading desks use graduated authority limits based on demonstrated competence and track record. This principle adapts directly to trust scoring for AI agents.

4. **Pharmaceutical manufacturing (process validation)** — The FDA's process validation framework (IQ/OQ/PQ) maps to agent lifecycle validation: installation qualification (correct deployment), operational qualification (correct behavior under normal conditions), and performance qualification (sustained correct behavior in production).

5. **Industrial control systems (SCADA safety)** — ICS environments separate safety systems from control systems physically. Agent kill switches should be architecturally isolated from the agent's control plane, following this principle.

6. **Distributed systems engineering (circuit breakers)** — Software circuit breakers prevent cascading failures by halting repeated failing calls. This pattern maps directly to infinite-loop containment: after a configurable number of failed or unproductive iterations, the agent should be circuit-broken to human review rather than continuing to retry.

**Recommendation for NIST:** We urge NIST to convene a **cross-sector working group on AI agent security standards** that includes: (1) standards bodies (OWASP, ISO, W3C, OpenID Foundation) to coordinate on agent identity, trust portability, and audit record interoperability — avoiding fragmented, incompatible specifications, (2) industry practitioners actively building and deploying agent systems (not only model developers) to ensure guidance reflects operational reality, (3) international partners to establish reciprocal recognition of agent security certifications, preventing regulatory fragmentation between jurisdictions, and (4) open-source contributors to provide immediately testable, freely available implementations of any standards developed. We commit to contributing our [open specification](https://basis.vorion.org), [reference implementation](https://github.com/vorionsys/vorion), [threat model](https://github.com/vorionsys/vorion/blob/main/docs/spec/BASIS-THREAT-MODEL.md), and [compliance mappings](https://github.com/vorionsys/vorion/blob/main/docs/compliance) to any NIST-convened effort.

---

## Alignment with Existing Standards

| Standard | How These Concepts Align |
|----------|---------------------|
| **NIST AI RMF (AI 100-1)** | GOVERN: Trust tiers and policy rules; MAP: Threat taxonomy; MEASURE: Trust scoring and containment metrics; MANAGE: Progressive containment and kill switches |
| **NIST CSF 2.0** | Extends ID, PR, DE, RS, RC functions with agent-specific controls |
| **NIST IR 8596 (Cyber AI Profile)** | Builds on our January 2026 public comment prepared for NIST's Cyber AI Profile |
| **OWASP Top 10 for Agentic Applications** | Full ASI01–ASI10 mapping with corresponding controls |
| **ISO/IEC 42001** | Trust scoring complements AIMS with runtime behavioral measurement |
| **EU AI Act** | Trust tiers map to risk categories; containment addresses Article 14 human oversight requirements |

---

## Contributed Reference Materials

All materials below are offered to NIST under open licenses for unrestricted use:

| Document | Description | License | Link |
|----------|-------------|---------|------|
| OWASP ASI01–ASI10 Control Mapping | Maps all 10 OWASP agentic AI risks to controls | Apache-2.0 | [basis.vorion.org/blog](https://basis.vorion.org/blog) |
| BASIS Specification | Open standard for AI agent trust scoring | Apache-2.0 | [basis.vorion.org](https://basis.vorion.org) |
| BASIS Threat Model | STRIDE-based analysis: 20 scenarios, 7 categories | Apache-2.0 | [GitHub](https://github.com/vorionsys/vorion/blob/main/docs/spec/BASIS-THREAT-MODEL.md) |
| Compliance Mapping | SOC 2, ISO 27001, GDPR, HIPAA, PCI DSS, EU AI Act, NIST AI RMF | Apache-2.0 | [GitHub](https://github.com/vorionsys/vorion/tree/main/docs/compliance) |
| Reference Implementation | Full platform with 15,865 tests | Apache-2.0 | [GitHub](https://github.com/vorionsys/vorion) |

---

## Conclusion

Securing AI agent systems requires moving beyond traditional cybersecurity patterns. Binary allow/deny, static permissions, and perimeter-based security are structurally inadequate for entities that operate inside the trust boundary, use legitimate tools, communicate in natural language, and evolve their behavior over time.

This response proposes that NIST guidance emphasize six principles:

1. **Graduated trust** over binary access control
2. **Behavioral monitoring** over static permission checks
3. **Progressive containment** over immediate termination
4. **Zero-knowledge cryptographic auditability** over log-file-based audit
5. **Fluid governance** over rigid policy enforcement
6. **Agent identity isolation** over credential inheritance

Additionally, we identify two emerging challenges that warrant dedicated NIST attention:

7. **Infinite loop and runaway prevention** — Standards should require iteration limits, delegation depth caps, resource budgets, and cycle detection for multi-agent systems
8. **Governance latency and adaptability** — Standards should acknowledge that governance-before-execution introduces per-action overhead and should encourage research into adaptive governance methods that calibrate security depth to operation risk

These principles are implementable today with existing technology. We contribute our open specification, reference implementation, threat model, and compliance mappings to NIST for evaluation, modification, and redistribution under open licenses. We welcome collaboration on developing voluntary standards for AI agent security.

---

**Respectfully submitted,**

Vorion
https://vorion.org
contact@vorion.org

---

*Document Version: 4.0*
*Prepared: February–March 2026*
*For submission to: www.regulations.gov, Docket NIST-2025-0035*
*Deadline: March 9, 2026, 11:59 PM ET*
