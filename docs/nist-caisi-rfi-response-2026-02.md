# NIST CAISI Request for Information: Security Considerations for AI Agents
## Response from Vorion

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
**Type:** AI agent security platform developer (open-source + commercial)

---

## Executive Summary

AI agents are being deployed into production without any standardized governance infrastructure. There is currently no accepted way to verify that an agent will behave within bounds, audit what decisions it made, or interoperate trust assessments across platforms. Every organization is building its own governance, none of it is verifiable, and none of it talks to each other.

Vorion is building the infrastructure to address this. We have developed the **BASIS Standard** (Baseline Authority for Safe and Interoperable Systems) — an open specification (CC BY 4.0) defining a five-stage governance pipeline that every agent action must traverse before execution: **CAR** (identity resolution) → **INTENT** (plan parsing) → **ENFORCE** (trust-gated policy check) → **PROOF** (cryptographic audit record) → **CHAIN** (optional external anchoring). **Cognigate** (Apache 2.0) is our open-source reference enforcement engine implementing this pipeline.

We are in early deployment. Our open-source implementation has accumulated over 10,668 automated tests (9,976+ TypeScript, 692 Python) covering the trust engine, governance pipeline, and compliance controls mapped to NIST SP 800-53, NIST AI RMF, SOC 2, PCI DSS, and FedRAMP. We submit this response to share what we have learned and to advocate for the standards gaps we are encountering in practice.

All source code is available for NIST review:
- **Platform**: https://github.com/vorionsys/vorion
- **Enforcement engine**: https://github.com/vorionsys/cognigate
- **Standard**: https://basis.vorion.org
- **Live API**: https://cognigate.dev

---

## Topic 1: Security Threats, Risks, and Vulnerabilities

### 1(a): Unique security threats affecting AI agent systems

**The problem:** Traditional software threats exploit implementation bugs. Agent threats exploit the fundamental architecture — agents receive instructions in the same medium they process data (natural language), operate with persistent state across sessions, and chain tools in ways no individual tool author anticipated. These properties make the threat surface structurally different from any existing category of software.

We identify 10 threat categories aligned with the OWASP Top 10 for Agentic Applications:

| # | Threat | OWASP | Why Agents Are Different |
|---|--------|-------|--------------------------|
| 1 | **Goal hijacking** | ASI01 | Prompt injection exploits meaning, not syntax; instructions and data are indistinguishable |
| 2 | **Tool weaponization** | ASI02 | Agents chain legitimate tools in attacker-intended sequences; each tool is safe individually |
| 3 | **Identity inheritance** | ASI03 | Agents inherit human-level permissions by default; no standard for "agent identity" exists |
| 4 | **Supply chain compromise** | ASI04 | MCP servers and plugins load dynamically at runtime from unverified sources |
| 5 | **Code execution escape** | ASI05 | Code generation is a normal capability; the boundary between output and command is blurred |
| 6 | **Memory poisoning** | ASI06 | One successful injection persists across all future sessions without re-attack |
| 7 | **Inter-agent spoofing** | ASI07 | Agent-to-agent communication uses natural language with implicit trust; no TLS equivalent exists |
| 8 | **Cascading failures** | ASI08 | A single compromised agent poisons downstream decision chains across the fleet |
| 9 | **Trust exploitation** | ASI09 | Polished agent explanations turn human-in-the-loop review into rubber-stamping |
| 10 | **Rogue behavior** | ASI10 | Agents develop misaligned objectives through reward hacking or memory drift without any attacker |

**Vorion's early implementation:** Cognigate's ENFORCE stage is built specifically around this threat surface. Each of the 10 threat categories maps to concrete policy rule types in our P0–P6 priority schema. Our open-source threat model (BASIS-THREAT-MODEL.md) catalogs 20 threat scenarios across 7 categories with required mitigations, available at https://github.com/vorionsys/vorion.

### 1(b): How threats vary by capability, scaffold, deployment, and use case

**The problem:** Risk is not uniform. A read-only retrieval agent and a persistent multi-agent orchestrator with shell access have almost nothing in common from a threat surface perspective, yet most current guidance treats "AI agents" as a single category.

**Technical approach:** Risk profiling for agents requires four independent axes: model capability (frontier vs. small model changes the dominant threat category), scaffold type (single-turn vs. persistent vs. orchestrator determines blast radius), tool access (read-only to code execution creates an order-of-magnitude jump in risk), and deployment boundary (internal enterprise vs. open internet vs. physical systems).

**Vorion's early implementation:** The BASIS standard defines a capability manifest per agent that encodes all four axes. Cognigate's CAR stage resolves this manifest at identity time, making it available to ENFORCE for every request — not just at deployment. Our trust tier system (T0–T7) reflects this: the same action is evaluated differently based on the agent's accumulated behavioral record, not just its static configuration.

### 1(c): Barriers to wider adoption

**The problem:** The core adoption barrier is not technical capability — it is liability and auditability. Organizations cannot deploy agents into regulated workflows because they cannot answer three questions: What did the agent do? Did it stay within authorized bounds? Can we prove it?

**Technical approach:** These three questions require: (1) cryptographic proof records per decision, not log files; (2) a trust scoring system that converts behavioral history into a quantified risk posture; (3) a containment architecture that enforces bounds in real time, not post-hoc.

**Vorion's early implementation:** Every decision Cognigate processes produces a PROOF record: Ed25519-signed, SHA-256/SHA3-256 dual-hash chained, with Merkle aggregation for external anchoring. Our trust scoring gives organizations a quantified, auditable number they can report to insurers, auditors, and boards. We believe this is the infrastructure gap that is blocking enterprise adoption, and we are building it in the open.

### 1(d): Threat evolution over time

The threat surface has escalated in distinct phases:

- **2023:** Prompt injection identified as a vulnerability class; treated as a research curiosity
- **2024:** Tool-use agents mainstreamed (GPT Actions, Claude Computer Use); tool weaponization became a practical concern
- **2025:** Multi-agent frameworks (MCP, A2A Protocol) created supply chain risks; first documented malicious MCP packages (e.g., 1,643 downloads of a spoofed `postmark-mcp` before detection)
- **2026:** Enterprise-scale agentic AI in production; behavioral drift and memory poisoning observed in long-running deployments; OWASP published ASI01–ASI10

**Projected:** As agents gain longer-running sessions and broader tool access, blast radius grows non-linearly. The MCP ecosystem lacks the signing and verification infrastructure that npm and PyPI spent a decade building. We expect adversarial specialization — model-specific prompt injection attacks — to require defense in depth rather than input filtering.

### 1(e): Unique threats in multi-agent systems

**The problem:** Multi-agent systems introduce three threat categories that do not exist in single-agent deployments: trust chain propagation (a single compromised agent poisons all downstream consumers with no "certificate revocation" equivalent), emergent behavior (individually policy-compliant agents producing collectively prohibited outcomes), and authority escalation through delegation (a low-trust agent instructing a high-trust agent to perform actions it cannot perform directly).

**Technical approach:** Multi-agent deployments require cryptographically verifiable agent identity, explicit delegation chains with provenance tracking, and aggregate trust scoring that reflects the trust level of every agent in a decision chain — not just the terminal actor.

**Vorion's early implementation:** The CAR (Categorical Agentic Registry) stage in the BASIS pipeline assigns a unique verifiable identity to each agent, distinct from human user credentials. Cognigate enforces that trust scores propagate: an agent cannot receive instructions from a lower-trust agent without governance review. Delegation chains are explicitly tracked in PROOF records. We treat this as a solved problem at the single-hop level and an open problem at fleet scale — which is why we are requesting NIST guidance on standards for cross-organizational multi-agent trust propagation.

---

## Topic 2: Security Practices (Mitigations and Technical Controls)

### 2(a): Technical controls that could improve security in development and deployment

**The problem:** Traditional security controls assume binary access (allowed/denied), static permissions assigned at deployment, and wellbounded system perimeters. None of these assumptions hold for agents: permissions must be dynamic and behavior-based, agents operate inside the trust boundary by design, and "access denied" on an autonomous system often means a workflow fails rather than an attack being stopped.

**Technical approach:** Agent security requires three layers that do not exist in traditional software: (1) a **graduated trust architecture** that quantifies each agent's earned authority level and adjusts capability scope accordingly; (2) a **fluid governance model** that answers with GREEN/YELLOW/RED rather than allow/deny, turning YELLOW into a negotiation rather than a failure; and (3) a **cryptographic audit chain** that makes every governance decision provable and tamper-evident.

**The governance pipeline (BASIS):**

```
AGENT WANTS TO ACT
       │
       ▼
┌──────────────────────────────────────────────┐
│                BASIS PIPELINE                │
│  CAR → INTENT → ENFORCE → PROOF → CHAIN*    │
│  Identity  Plan    Gate    Log    Anchor     │
└──────────────────────────────────────────────┘
       │
   ALLOWED or DENIED
```

**Graduated trust tiers (T0–T7, 0–1000 scale):**

| Tier | Score Range | Capabilities | Governance Posture |
|------|-------------|-------------|-------------------|
| T0 Sandbox | 0–199 | Read-only, no external calls | All intents require approval |
| T1 Observed | 200–349 | Basic tools, scoped data | Enhanced logging |
| T2 Provisional | 350–499 | Standard tools, rate-limited | Sensitive ops require review |
| T3 Monitored | 500–649 | Full standard toolset | Continuous monitoring |
| T4 Standard | 650–799 | Extended tools + external APIs | Green-light for most operations |
| T5 Trusted | 800–875 | Cross-namespace access | Elevated authority scope |
| T6 Certified | 876–950 | Administrative operations | Can approve others' intents |
| T7 Autonomous | 951–1000 | Unrestricted within policy | Self-governing |

**Key dynamics:** All agents start at score 1 (zero-trust default). Gains follow a logarithmic curve; losses are tier-scaled (7× rate at T0, 10× at T7). Time decay begins at day 7 of inactivity (milestones: 7/14/28/42/56/84/112/140/182 days), reaching 50% at 182 days. A graduated circuit breaker (normal → degraded → tripped) gates updates when behavior becomes anomalous.

**Fluid governance (GREEN/YELLOW/RED):**

| Decision | Meaning | Effect |
|----------|---------|--------|
| **GREEN** | Approved with constraints | Proceed; constraints define allowed tools, scopes, rate limits, execution time |
| **YELLOW** | Requires refinement | Agent can reduce scope, request approval, or decompose the intent |
| **RED** | Denied | Hard policy violation; triggers containment escalation and trust decay |

YELLOW is the critical capability: it converts "access denied" into a negotiation, reducing false-positive denials while maintaining security boundaries.

**Cryptographic proof chain:** Every ENFORCE decision produces a PROOF record: SHA-256/SHA3-256 dual-hash linked, Ed25519 signed, with periodic Merkle aggregation for external anchoring. Privacy-preserving tier verification (Pedersen commitment interfaces) allows agents to prove trust tier membership without revealing exact scores.

**Vorion's early implementation:** The above describes the BASIS standard we have specified and the Cognigate engine we have built to implement it. The pipeline is live at https://cognigate.dev with an interactive playground and API documentation. Our implementation has ~30ms typical ENFORCE gate latency (<100ms target) and ~10ms PROOF logging (<50ms target), which we believe demonstrates that governance controls need not impose prohibitive overhead. We have 10,668+ automated tests covering the full pipeline, with compliance control verification mapped to NIST SP 800-53 (52 controls, 20 automated tests), SOC 2, PCI DSS, and FedRAMP. SBOM artifacts are generated continuously in CycloneDX 1.5 and SPDX 2.3 formats with OSCAL machine-readable artifacts (SSP, component definition, assessment plan, POA&M).

### 2(b): How effectiveness varies with model capability, deployment, and use case

Trust scoring is model-agnostic — it measures behavioral outcomes regardless of the underlying model. YELLOW governance decisions (scope negotiation) are more useful with capable models that can engage in refinement; less capable models may need simpler allow/deny with human override. Proof chain granularity should match the deployment: high-frequency operations benefit from Merkle batching; healthcare and regulated industries benefit from per-action records. Containment enforcement effectiveness depends on whether tool access is API-mediated (immediate enforcement) or local (enforcement latency exists).

### 2(c): How practices must adapt to future capability evolution

Four structural requirements for forward-compatible security: (1) scoring algorithms must be extensible to new signal types without redesign; (2) policy rules must be declarative and runtime-updatable; (3) containment must be progressive (7 levels from monitoring to halt) — not binary — as agents become more capable; (4) inter-agent authentication standards must mature, analogous to how TLS matured for web communication.

### 2(d): Patching throughout the lifecycle

Agent "patching" differs from software patching because model updates change behavior unpredictably, prompt changes affect reasoning without code changes, and "rollback" may be impossible if the agent has already taken external actions. Our approach: model version changes trigger a trust score reset to T0 (agent re-earns trust through observed behavior); prompt changes are versioned and correlated to behavioral changes through PROOF records; policy changes use blue/green deployment (shadow mode before activation). Containment (restricting to read-only or simulation) is usually more appropriate than rollback.

### 2(e): Gaps in existing cybersecurity guidelines

| Guideline | Gap for Agents |
|-----------|----------------|
| NIST AI RMF (AI 100-1) | Lacks runtime behavioral controls; development lifecycle focus |
| NIST CSF 2.0 | No agent-specific control families; agents not addressed as a distinct asset type |
| OWASP Top 10 Agentic AI | Threat identification only; no runtime technical controls |
| ISO/IEC 42001 (AIMS) | Management system focus; no implementation guidance for runtime enforcement |
| MITRE ATLAS | Adversarial ML focus; does not address tool use, agentic autonomy, or multi-agent systems |

**The structural gap:** All existing frameworks assume permissions are assigned at deployment, the system boundary is well-defined, identity is tied to humans or services, and anomaly detection works from baselines. None of these hold for agents. NIST should develop agent-specific control families that extend CSF 2.0 with runtime behavioral controls as a distinct category.

---

---

## Topic 3: Assessing Security

### 3(a): Methods to anticipate threats during development, detect incidents post-deployment, and useful resources

**The problem:** Traditional security assessment looks for known vulnerability signatures. Agent threats are behavioral: the same capability that enables an agent to complete a task becomes the threat vector when the agent's intent is compromised. Threat catalogs that list code patterns are not meaningful for natural language instruction systems.

**Technical approach:** Agent security assessment requires three phases — (1) **pre-deployment threat modeling** against enumerated capabilities, (2) **runtime behavioral baselines** that define expected tool usage patterns and escalation rates, and (3) **continuous proof chain health monitoring** that treats anomalies in the audit trail as security signals. Effective detection merges traditional SIEM signals with agent-specific signals (trust score trajectory, escalation frequency, governance decision distribution).

**Vorion's early implementation:** We have published BASIS-THREAT-MODEL.md — a STRIDE-based threat model covering 20 scenarios across 7 categories with required mitigations, available at https://basis.vorion.org. Runtime detection in our early implementation monitors trust score trajectories (a 100-point drop triggers containment escalation), proof chain integrity (signature validity and hash chain continuity verified on every append), and YELLOW/RED governance decision rate trends. Resources we recommend: OWASP Top 10 for Agentic Applications, MITRE ATLAS, NIST AI RMF, and the BASIS threat model.

### 3(b): How to assess particular systems and what information helps

**The problem:** There is no standardized assessment vocabulary for AI agent security posture. "Is this agent secure?" has no clear answer when the agent's capability scope, behavioral history, governance coverage, and proof chain health are all unquantified.

**Technical approach:** Assessment along four verifiable dimensions: (1) **trust posture** — current tier, score history, trajectory trend; (2) **capability scope** — what tools, data scopes, and external services the agent can reach; (3) **governance coverage** — what fraction of possible actions are covered by explicit P0–P6 policy rules; (4) **proof chain health** — completeness, signature validity, integrity verification pass rate, and anchoring freshness.

| Priority | Rule Type | Assessment Target |
|----------|-----------|-------------------|
| P0 | Hard disqualifier | False negative rate (target: 0%) |
| P1 | Regulatory mandate | Compliance gap % |
| P2 | Security critical | Detection latency (ms) |
| P3 | Policy enforcement | Override rate |
| P4 | Soft constraint | Acknowledgment rate |
| P5 | Clarification trigger | Resolution success rate |
| P6 | Logging only | Coverage % |

**Vorion's early implementation:** Cognigate provides automated control verification across NIST SP 800-53 (52 controls, 20 automated tests), SOC 2 (13 automated tests), PCI DSS (32 automated tests), and FedRAMP (35 automated tests). SBOM artifacts with NTIA minimum element validation are generated continuously. Proof chain integrity is verified on every append operation. We believe this assessment structure is transferable as an assessment template regardless of implementation vendor.

### 3(c): Documentation from upstream developers that aids downstream security assessment

**The problem:** Downstream deployers of AI agents cannot perform meaningful security assessment in the absence of upstream model documentation. Model capability evaluations, vulnerability disclosures, behavioral change logs between versions, and training data provenance are analogous to a software component's CVE history — without them, downstream security is blind.

**Technical approach:** Upstream model developers should provide standardized "security nutritional labels": capability evaluations (tool use, instruction following, safety refusals), known susceptibility disclosures (prompt injection resistance, jailbreak resistance), behavioral change logs between versions, and training data provenance and poisoning risk assessment. Open-source models allow downstream safety evaluation but also enable adversary optimization; closed-source models provide less transparency but benefit from provider resources. Coordinated disclosure with a minimum 90-day window — adapted from Project Zero — is appropriate given the immediately exploitable nature of prompt injection.

**Vorion's early implementation:** We version-track agent behavior changes in PROOF records, correlating behavioral shifts with model version updates and instruction changes. When a model version changes, trust score resets to T0 in our implementation — re-earning trust through observed behavior rather than inheriting the prior model's score.

### 3(d): User-facing documentation for secure deployment

**The problem:** End users and deploying organizations currently receive near-zero security-specific documentation for AI agent deployments. They cannot independently assess what an agent can do, at what autonomy level it operates, how misbehavior is reported, or how actions are audited.

**Technical approach:** Minimum required documentation: (1) capability manifest (what the agent can do, what tools it accesses, what data scopes it operates within); (2) current trust tier with plain-language description of what that tier means operationally; (3) escalation procedures for reporting misbehavior; (4) containment status and current restrictions if any; (5) audit access instructions. This is nascent — most deployed agents today provide none of these.

**Vorion's early implementation:** The CAR (Categorical Agentic Registry) stage of the BASIS pipeline resolves and publishes a capability manifest at agent initialization. Cognigate exposes trust tier status through its API. We are building toward fully self-documenting agent deployments that can generate the above documentation from runtime registry state.

---

## Topic 4: Limiting, Modifying, and Monitoring Agent Access in Deployment

### 4(a): Technical means to constrain deployment environment access (least-privilege, zero-trust adaptations)

**The problem:** Current zero-trust frameworks (BeyondCorp, NIST SP 800-207) were designed for services and users operating at the perimeter. Agents break these assumptions: they operate inside the perimeter by design, hold credentials earned at session start, and can use them continuously without re-verification. "Never trust, always verify" has not been adapted for entities that operate autonomously over extended sessions.

**Technical approach:** Agent-native zero trust requires three additions to SP 800-207: (1) continuous re-authorization — trust is re-evaluated on every action, not just authentication; (2) graduated access tied to behavioral history — capability scope expands or contracts dynamically based on earned trust score; (3) progressive containment as the enforcement primitive, replacing binary block/allow with a 7-level proportional response.

**Vorion's early implementation:** The Cognigate ENFORCE stage re-evaluates trust on every intent, not at session level. Every GREEN decision attaches a scoped authority object: allowed tools, data scopes, rate limits, execution time limit, and reversibility requirement. No agent accesses tools directly — all access flows through intent → evaluate → execute. Our progressive containment model:

| Level | Name | Restrictions | Trigger Examples |
|-------|------|-------------|-----------------|
| L1 | Full Autonomy | None | Default for T5+ agents |
| L2 | Monitored | Enhanced logging | Trust score below T4 threshold |
| L3 | Tool Restricted | High-risk capabilities blocked | Policy violation detected |
| L4 | Human-in-Loop | All actions require approval | Trust score drop >100 points |
| L5 | Simulation Only | Read-only, no side effects | Suspected goal hijacking |
| L6 | Read Only | Write/execute blocked | Confirmed anomalous behavior |
| L7 | Halted | ALL operations blocked | Kill switch activated |

Agent identity is isolated at the CAR stage: each agent receives a unique CAR-ID distinct from human or service credentials; agent identity is never inherited from a user session; and trust binding means score decay automatically reduces capability scope without requiring explicit revocation.

### 4(b): Environmental modifications and rollback/undo mechanisms

**The problem:** For software, rollback means reverting code. For agents, the "code" is an instruction following a natural language-driven reasoning process operating on live systems. An agent that sent emails, modified records, or called external APIs cannot be rolled back in the software sense — and yet the governance record must still exist.

**Technical approach:** Governance-time reversibility requirements — established before execution, not after. For HIGH/CRITICAL risk operations, require that an undo path exist as a precondition for GREEN approval. When true rollback is impossible, escalate containment level immediately to prevent further action rather than attempting undoing. Checkpoint-based session recovery before high-consequence operations. Proof chain records survive as the immutable evidence trail regardless of what happens to the agent.

**Vorion's early implementation:** Every Cognigate GREEN decision includes a structured constraint object with explicit `reversibility` field. Operations flagged as irreversible are auto-escalated to human review. Our implementation produces a stable proof chain even when agent sessions are terminated mid-execution — the incomplete chain is itself an evidence artifact:

```json
{
  "allowedTools": ["search", "read_file"],
  "dataScopes": ["namespace:public"],
  "rateLimits": [{ "resource": "api", "limit": 100, "window": "1m" }],
  "maxExecutionTime": 30000,
  "reversibility": "required"
}
```

### 4(c): Managing risks from interactions with humans, digital resources, mechanical systems, and other agents

**The problem:** Agents interact across boundaries that existing risk models treat separately: human–AI interaction risk, API/data access risk, physical actuation risk, and inter-agent trust risk. No unified framework addresses all four simultaneously.

**Technical approach:** Unified governance through a single enforcement point (the ENFORCE stage) that applies context-sensitive policy regardless of interaction type. Data classification propagates through processing chains. Physical actuations require elevated trust tier and mandatory human confirmation. Inter-agent communication is treated as potentially adversarial — trust does not propagate automatically across agent boundaries.

**Vorion's early implementation:** Policy rule types P0–P6 apply uniformly across interaction categories. Data scope constraints in GREEN decisions enforce classification propagation. Our early implementation requires T5+ trust tier for any operation classified as having physical consequences. Inter-agent trust propagation is an open research problem we are actively working on — we treat same-fleet agent communication as the near-term tractable case and cross-organizational agent trust as a longer-term standards problem.

### 4(d): Monitoring methods, deployment challenges, and legal/privacy considerations

**The problem:** General-purpose monitoring (SIEM, APM) does not produce agent-relevant signals. An agent operating normally and an agent under instruction hijacking may look identical in application logs — both are making legitimate API calls with valid credentials. The meaningful signals are behavioral: trust score trajectory, governance decision distribution, escalation rates, and proof chain health.

**Technical approach:** Dedicated agent monitoring layer that tracks: (1) trust score trajectory with anomaly thresholds; (2) YELLOW/RED decision rates as early-warning signals; (3) proof chain completeness and integrity; (4) cascade correlation across agent fleets (correlated drops may indicate propagating compromise). Privacy: proof records reference entity IDs, not personal data; Pedersen commitment interfaces enable tier verification without score disclosure.

**Vorion's early implementation:** Our early deployment exposes trust score dashboards, proof chain audit endpoints, and behavioral analytics APIs. We have measured ~30ms typical ENFORCE latency and ~10ms PROOF logging — demonstrating that governance monitoring need not impose prohibitive overhead. The standing operational challenge we have not yet solved at scale is Merkle anchoring throughput in high-frequency deployments; we anchor in batches as a current mitigation.

### 4(e): Are AI agent systems currently deployed in unbounded environments?

**The problem:** There is no standardized mechanism for identifying AI agent traffic on the open internet. Agents are invisible to web infrastructure — no equivalent of `robots.txt`, no standard user-agent identification, no traffic volume telemetry.

**Technical approach:** Agent identification standards analogous to robots.txt for crawlers: voluntary, machine-readable, privacy-preserving identification that enables web infrastructure to apply appropriate rate limits and logging without requiring agent shutdown. Intermediate step: standardized user-agent strings for AI agents that enable traffic analysis without fingerprinting.

**Our early read on deployment distribution:** Enterprise deployments (approximately 70% of production usage) operate within organizational boundaries — broad internal access, limited external reach. Customer-facing agents (approximately 20%) use structured APIs rather than open internet access. Autonomous web agents — browser-use, research, scraping — (approximately 10%) operate with minimal access controls in truly unbounded environments. This last category is where governance infrastructure is most absent and risk is highest.

---

## Topic 5: Additional Considerations

### 5(a): Methods, guidelines, and tools supporting security practice adoption

**The problem:** Adoption of security practices fails when the barrier to entry is high — proprietary tooling, expensive consulting, or complex certification processes. Agent governance infrastructure is nascent enough that most organizations are building ad hoc rather than adopting shared standards.

**Technical approach:** Open-source reference implementations paired with open specifications create a flywheel: low barrier to evaluate → adoption → community contribution → improved specification → better implementations. Key: the specification must be license-clear (CC BY 4.0 for the standard document, Apache 2.0 for code) so organizations can adopt and extend without legal friction.

**Vorion's early implementation:** We publish the full stack as open source:

| Resource | Type | License | URL |
|----------|------|---------|-----|
| BASIS Standard (specification) | Open specification | CC BY 4.0 | basis.vorion.org |
| Cognigate (enforcement engine) | Reference implementation | Apache-2.0 | cognigate.dev |
| Vorion Platform (full stack) | Reference implementation | Apache-2.0 | github.com/vorionsys/vorion |
| Threat Model | Documentation | CC BY 4.0 | basis.vorion.org |
| Compliance Mapping | Documentation | CC BY 4.0 | basis.vorion.org |
| OWASP Control Mapping | Documentation | CC BY 4.0 | basis.vorion.org/blog |

We recommend NIST develop or endorse: (1) a standardized trust score exchange format enabling portability between platforms; (2) a proof record schema for cross-platform audit chain verification; (3) an agent capability manifest format for automated security assessment.

### 5(b): Most urgent areas for government collaboration

1. **Agent identity standards** — No established standard for AI agent identity distinct from human or service account identity exists. Government collaboration on agent identity (analogous to PIV/CAC for humans) would address the identity gap at the root.

2. **Cross-organizational trust propagation** — As government agencies deploy multi-agent systems, trust frameworks need to be interoperable across agency boundaries. NIST is uniquely positioned to develop federal agent trust standards, consistent with how FICAM standardized human identity.

3. **Incident reporting channels for agents** — AI agent security incidents (prompt injection campaigns, behavioral hijacking, supply chain compromise) are currently unreportable through CISA or CVE. A reporting taxonomy and channel designed for agent-specific incidents would improve collective defense.

4. **Compliance mapping guidance** — FedRAMP and FISMA have no agent-specific controls. NIST guidance mapping agent governance controls to existing federal compliance frameworks would accelerate safe government adoption.

### 5(c): Critical research priorities

In order of urgency:

1. **Prompt injection defenses** — The structurally correct solution is separating instruction and data channels in agent architectures. Input filtering is insufficient and easily bypassed. Research priority: architectural standards for instruction/data channel separation.

2. **Fleet-scale trust propagation models** — Single-agent trust scoring is tractable; the semantics of trust across a fleet of delegating, coordinating agents is an open formal problem. We treat this as our most important open research question.

3. **Behavioral drift detection** — Detecting when an agent's behavior has drifted from intended purpose through individually-benign incremental changes. Statistical baselines over proof chain data are a starting point; better methods are needed.

4. **Agent-to-agent authentication** — Cryptographic protocols for agent-to-agent communication with authentication, integrity, and non-repudiation at sub-10ms latency. Current approaches impose unacceptable overhead for high-frequency fleets.

5. **Containment effectiveness measurement** — Empirical research on whether progressive containment levels actually prevent harm propagation, and what level is appropriate for what risk category. This requires controlled adversarial experiments that do not yet exist.

### 5(d): International approaches

| Approach | Jurisdiction | Strength | Gap for agents |
|----------|-------------|----------|----------------|
| EU AI Act | EU | Risk-tiered proportional requirements | Static deployment-time classification; no runtime behavioral controls |
| UK AI Safety Institute | UK | Pre-deployment frontier model evaluation | Model-level focus; no agent scaffold or runtime governance guidance |
| Singapore AI Verify | Singapore | Self-assessment toolkit with technical tests | Voluntary; limited outside Singapore |
| ISO/IEC 42001 (AIMS) | International | Management system with certification path | High cost; lacks runtime technical specificity |
| China Interim Measures for Generative AI | China | Content filtering + user identity mandates | Content safety focus; does not address autonomous action safety |

The U.S. has an opportunity to lead on what no jurisdiction has addressed: **runtime agent governance standards**. Pre-deployment evaluation (where EU, UK, and Singapore have invested) is necessary but not sufficient. Runtime behavioral controls — graduated trust, progressive containment, cryptographic auditability — are the missing layer. We believe we are building an early reference for what those standards could look like.

### 5(e): Applicable practices from outside AI and cybersecurity

1. **Aviation (crew resource management)** — Multi-layered authority with structured escalation (captain → first officer → ATC) maps directly to multi-agent trust tiers and escalation chains. Aviation's culture of mandatory incident reporting regardless of outcome is a model for agent behavioral drift reporting.

2. **Nuclear (defense in depth)** — Multiple independent containment layers such that no single failure causes catastrophic outcome. Our 7-level progressive containment follows this principle.

3. **Financial services (graduated authority)** — Trading desks use graduated position limits tied to demonstrated track record. Trust scoring adapts this to agents: authority expands with demonstrably safe behavior, contracts with anomalies.

4. **Pharmaceutical (process validation, IQ/OQ/PQ)** — Installation qualification (correct deployment), operational qualification (correct behavior under controlled conditions), performance qualification (sustained correct behavior in production) maps directly to agent lifecycle validation stages.

5. **Industrial control systems (safety/control separation)** — Physical separation of safety systems from control systems prevents a compromised control plane from disabling safety. Agent kill switches (L7 containment) should be architecturally isolated from the agent's control plane on the same principle.

---

## Alignment with Existing Standards

| Standard | How BASIS and Cognigate Align |
|----------|------------------------------|
| **NIST AI RMF (AI 100-1)** | GOVERN: T0–T7 trust tiers + P0–P6 policy rules; MAP: BASIS-THREAT-MODEL.md (20 scenarios, 7 categories); MEASURE: 0–1000 trust score + progressive containment metrics; MANAGE: 7-level containment + kill switch |
| **NIST CSF 2.0** | ID.AM: CAR capability manifest; PR.AC: ENFORCE trust-gated access; DE.CM: proof chain behavioral monitoring; RS.MI: L1–L7 containment response; RC.RP: checkpoint recovery |
| **NIST SP 800-53** | 52 controls implemented; 20 automated verification tests; OSCAL machine-readable artifacts (SSP, component definition, assessment plan, POA&M) |
| **NIST IR 8596 (Cyber AI Profile)** | Submitted public comment January 2026; graduated trust and behavioral monitoring address the runtime gap identified in the draft profile |
| **OWASP Top 10 for Agentic Applications** | Full ASI01–ASI10 coverage mapped to ENFORCE policy rules; control mapping published at basis.vorion.org/blog |
| **ISO/IEC 42001 (AIMS)** | Trust scoring provides the runtime behavioral measurement that AIMS governance processes require but do not specify |
| **EU AI Act** | Trust tiers correspond to risk categories; PROOF records support Article 12 logging requirements; progressive containment addresses Article 14 human oversight |
| **FedRAMP / FISMA** | 35 automated FedRAMP control tests; OSCAL artifacts designed for FedRAMP package submission |

---

## Reference Materials

| Resource | Description | URL |
|----------|-------------|-----|
| BASIS Standard | Open specification — 5-stage governance pipeline, trust tier model, proof record schema | basis.vorion.org |
| Cognigate | Open-source enforcement engine (Apache 2.0) with interactive playground and API docs | cognigate.dev |
| Vorion Platform | Full reference implementation including Trust Engine, Proof Chain, CAR (Apache 2.0) | github.com/vorionsys/vorion |
| BASIS Threat Model | STRIDE-based, 20 threat scenarios across 7 categories with required mitigations | basis.vorion.org |
| OWASP Control Mapping | ASI01–ASI10 mapped to implemented controls | basis.vorion.org/blog |
| BASIS Compliance Mapping | SOC 2, ISO 27001, GDPR, HIPAA, PCI DSS, EU AI Act, NIST AI RMF, FedRAMP mappings | basis.vorion.org |

---

## Conclusion

The core problem is structural: AI agents operate inside the trust boundary, use legitimate credentials, take autonomous actions, and leave no reliable signature that traditional security tools can detect. Binary access control, static permissions, and perimeter security were not designed for this threat model and cannot be extended to address it.

The infrastructure gap is specific and addressable: runtime behavioral governance — graduated trust scoring, continuous re-authorization on every action, fluid GREEN/YELLOW/RED governance rather than allow/deny, and cryptographic proof chains that make every decision auditable and tamper-evident.

We believe this is the layer that all existing frameworks are missing. We have built an early implementation and are publishing it as open infrastructure — BASIS as the open standard (CC BY 4.0), Cognigate as the open enforcement engine (Apache 2.0) — because agent governance infrastructure should not be proprietary. The trust problem only gets solved if implementations interoperate.

We recommend NIST guidance prioritize:

1. **Runtime behavioral controls** as a distinct category — not extensions of static permission systems
2. **Graduated trust** over binary access control
3. **Progressive containment** over immediate termination
4. **Cryptographic auditability** as a first-class requirement, not an audit afterthought
5. **Agent identity isolation** as a distinct identity category, not an extension of service accounts
6. **Open interoperability standards** for trust score exchange and proof record schemas

We welcome NIST engagement with our implementation and are available to support standards development work.

---

**Respectfully submitted,**

Vorion
https://vorion.org | https://basis.vorion.org | https://cognigate.dev
hello@vorion.org

---

*Document Version: 3.0*
*Prepared: March 2026*
*For submission to: www.regulations.gov, Docket NIST-2025-0035*
*Deadline: March 9, 2026, 11:59 PM ET*
