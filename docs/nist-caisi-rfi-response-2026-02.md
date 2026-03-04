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

Vorion submits this response to NIST CAISI's RFI on AI agent security based on our direct experience building and operating the Vorion Governed AI Execution Platform — an open-source platform purpose-built for AI agent trust scoring, governance, and auditability.

Our response addresses all five RFI topics with concrete implementation patterns, quantitative data, and open-source reference implementations. We structure our answers around NIST's specific questions (1a–5e) and draw from:

- **The BASIS Standard** — An open standard (CC BY 4.0) for AI agent trust scoring, governance, and cryptographic auditability
- **The Vorion Platform** — Apache-2.0 reference implementations including trust engines, governance gateways, and proof-chain services
- **The OWASP Top 10 for Agentic Applications (2026)** — Which we have mapped to operational controls in our published threat model

All referenced implementations are open-source and available for NIST review at https://github.com/vorionsys/vorion.

---

## Topic 1: Security Threats, Risks, and Vulnerabilities

### 1(a): Unique security threats, risks, or vulnerabilities currently affecting AI agent systems, distinct from those affecting traditional software systems

We identify 10 threat categories specific to agentic AI, aligned with the OWASP Top 10 for Agentic Applications:

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

**Structural distinction:** Traditional software threats exploit implementation bugs. Agent threats exploit the fundamental architecture — the fact that agents receive instructions in the same medium they process data (natural language), operate with persistent state across sessions, and combine tools in emergent ways that no individual tool author anticipated.

### 1(b): How threats vary by model capability, scaffold, tool use, deployment method, hosting context, and use case

**By model capability:**
- Larger models (frontier-class) create higher goal-hijacking risk because their instruction-following capability makes them more susceptible to sophisticated prompt injection that mimics legitimate instructions
- Smaller models create higher rogue behavior risk because they are more likely to misinterpret constraints and exhibit specification gaming

**By agent scaffold:**
- **Single-turn agents** (API call → response) have minimal blast radius; threats are bounded by the request scope
- **Persistent agents** (long-running sessions with memory) create memory poisoning and behavioral drift risks that scale with session duration
- **Multi-agent orchestrators** (LangGraph, CrewAI, AutoGen) create cascading failure risks proportional to the number of connected agents

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

### 1(c): Barriers to wider adoption created by these threats

Security concerns are the primary barrier to enterprise AI agent adoption. We observe three specific barriers:

1. **Liability uncertainty** — Organizations cannot quantify the financial exposure from agent misbehavior. Without graduated trust and containment systems, the risk profile of deploying an autonomous agent is binary: either it operates correctly or it causes damage with no intermediate states.

2. **Audit gap** — Existing audit frameworks (SOC 2, ISO 27001) have no controls specific to AI agent behavior. Organizations in regulated industries cannot demonstrate compliance for agent deployments, creating a regulatory blocker.

3. **Insurance gap** — Cyber insurance policies typically exclude AI-related incidents or lack underwriting models for agentic risk. Without quantifiable trust metrics and containment guarantees, insurers cannot price the risk.

We recommend NIST guidance that provides measurable security controls for AI agents, enabling organizations to quantify and mitigate risk rather than avoiding deployment entirely.

### 1(d): How threats have changed over time and likely future evolution

**Historical evolution (2023–2026):**

- **2023:** Prompt injection demonstrated as a class of vulnerability; treated as a curiosity
- **2024:** Tool-use agents (GPT Actions, Claude Computer Use) mainstreamed; tool weaponization became a practical concern
- **2025:** Multi-agent frameworks (MCP, A2A Protocol) created supply chain and inter-agent trust challenges; first documented cases of malicious MCP servers (e.g., 1,643 downloads of a spoofed postmark-mcp package before detection)
- **2026:** Agentic AI in production at enterprise scale; OWASP published Top 10 for Agentic Applications; behavioral drift and memory poisoning observed in long-running agent deployments

**Projected evolution:**

1. **Increasing autonomy scope** — As agents gain more tools and longer-running sessions, the blast radius of any single compromise grows non-linearly
2. **Multi-agent amplification** — Agent-to-agent communication creates exponential trust chain risks; without inter-agent trust verification, a single compromised agent can propagate poisoned outputs through downstream decision chains within hours, as the absence of standardized agent-to-agent authentication means consuming agents have no mechanism to distinguish legitimate from compromised outputs
3. **Supply chain expansion** — The MCP ecosystem is growing rapidly with minimal verification infrastructure; tool registries lack the signing and verification mechanisms that package managers (npm, PyPI) have developed over decades
4. **Adversarial specialization** — We anticipate prompt injection attacks will become increasingly targeted and model-specific, requiring defense-in-depth rather than input filtering alone

### 1(e): Unique threats affecting multi-agent systems, distinct from singular agent systems

Multi-agent systems introduce three categories of threat not present in single-agent deployments:

1. **Trust chain propagation** — When Agent A trusts Agent B's output and uses it as input for downstream decisions, a single compromise propagates through the chain. Traditional trust models (PKI, certificate chains) have no equivalent for natural language communication between agents. There is no "certificate revocation" for a compromised agent's outputs that have already been consumed.

2. **Emergent behavior** — Individual agents may each operate within their defined policy boundaries, yet their collective behavior produces outcomes no single agent's policy was designed to prevent. This is analogous to the "composition problem" in formal verification but applied to natural language reasoning systems.

3. **Authority escalation through delegation** — Agent A, operating at a low trust level, may request Agent B (at a higher trust level) to perform actions that Agent A cannot perform directly. Without explicit delegation controls and audit trails, multi-agent systems create privilege escalation paths that bypass per-agent access controls.

**Our recommendation:** Multi-agent deployments should require cryptographically verifiable agent identity (not just API keys), explicit delegation chains with provenance tracking, and aggregate trust scoring that accounts for the trust level of all agents in a decision chain.

---

## Topic 2: Security Practices (Mitigations and Technical Controls)

### 2(a): Technical controls and processes that could improve security in development and deployment

We recommend three categories of controls, informed by our operational experience:

**Model-level controls for robustness:**
- System prompt hardening with explicit boundary markers between instructions and user data
- Output validation layers that check agent outputs against expected schemas before execution
- Multi-model consensus for high-risk operations (two independent models must agree on the interpretation of an instruction before execution)

**Agent system-level controls (scaffold and orchestration):**

We implement and recommend a **graduated trust architecture** with quantified scoring:

| Tier | Score Range | Agent Capabilities | Governance Posture |
|------|------------|-------------------|-------------------|
| T0 Sandbox | 0–199 | Read-only, no external calls | All intents require approval |
| T1 Observed | 200–349 | Basic tools, scoped data | Enhanced logging active |
| T2 Provisional | 350–499 | Standard tools, rate-limited | Sensitive ops require review |
| T3 Monitored | 500–649 | Full standard toolset | Continuous monitoring |
| T4 Standard | 650–799 | Extended tools + external APIs | Green-light for most operations |
| T5 Trusted | 800–875 | Cross-namespace access | Elevated authority scope |
| T6 Certified | 876–950 | Administrative operations | Can approve others' intents |
| T7 Autonomous | 951–1000 | Unrestricted within policy | Self-governing |

**Key design principles:**
- **Start at zero** — All new agents begin at T0 (Sandbox). Trust is earned and not assumed by default.
- **Asymmetric scoring** — Failures impact trust 3x more than successes reward it, creating a natural bias toward reliability.
- **Time decay** — Idle agents lose trust over time via stepped milestone decay with a 182-day half-life. Deductions begin at day 7 of inactivity (6% per step for the first 5 milestones, then 5% per step), reaching 50% of the original score at 182 days. The 3x failure multiplier compounds with decay; implementation profiles are configurable per deployment context. Stale high-trust entities are automatically demoted.
- **Behavioral signals** — In the legacy 4-category model, trust scores are computed from weighted categories: Behavioral (40%), Compliance (25%), Identity (20%), Context (15%). Current production profiles use a configurable multi-factor model while preserving the same asymmetric trust dynamics and governance semantics.

**Fluid governance (three-tier decision model):**

Traditional allow/deny is insufficient for agents. We implement a three-tier decision model:

| Decision | Meaning | Agent Action |
|----------|---------|-------------|
| **GREEN** | Approved with constraints | Proceed; constraints define allowed tools, data scopes, rate limits, and execution time |
| **YELLOW** | Requires refinement | Agent can reduce scope, add constraints, request approval, provide context, or decompose the intent |
| **RED** | Denied | Hard policy violation; triggers containment escalation and trust decay |

YELLOW decisions are the critical innovation: they transform "access denied" into a collaborative negotiation between agent and governance system, reducing false-positive denials while maintaining security.

**Human oversight controls:**
- Confidence indicators attached to agent recommendations so humans can calibrate review effort
- Assumption transparency — agents must declare what assumptions underlie their recommendations
- Escalation triggers based on risk classification (LOW/MEDIUM/HIGH/CRITICAL) with mandatory human review for CRITICAL operations
- Cool-down periods between high-impact actions to prevent rapid automated cascades

**Cryptographic proof chains:**

Every governance decision produces a cryptographic proof record:
- **Dual-hash chain:** The reference implementation uses SHA-256 to link each record to its predecessor with parallel SHA3-256 integrity anchors for algorithmic diversity, providing a migration path if either algorithm is weakened (see ADR-017)
- **Digital signatures:** Ed25519 signatures bind each record to a specific agent identity
- **Merkle aggregation:** Periodic Merkle tree construction enables external anchoring and batch verification
- **Privacy-preserving verification:** The architecture defines integration interfaces for zero-knowledge tier verification — including Pedersen commitment and range proof primitives — enabling agents to prove trust tier membership without revealing exact scores. The reference implementation provides these interfaces with hash-based simulation; production deployments integrate elliptic curve libraries (ristretto255, snarkjs/circom) through the defined API surface

**Reference implementation maturity:** The open-source reference implementation includes over 400 unit and integration tests across trust and governance components, 100 automated security control verification tests across NIST SP 800-53, SOC 2, PCI DSS, and FedRAMP control frameworks (including 20 automated tests in the NIST SP 800-53 implementation), continuous SBOM generation (CycloneDX 1.5 + SPDX 2.3) with vulnerability correlation, and machine-readable OSCAL artifacts (SSP, component definition, assessment plan, POA&M). Published enforcement latency targets are ENFORCE gate <100ms and PROOF logging <50ms; internal benchmark runs indicate typical performance around ~30ms ENFORCE and ~10ms PROOF under reference conditions.

### 2(b): How effectiveness varies with model capability, deployment method, and use case

- **Trust scoring** is model-agnostic — it measures behavioral outcomes regardless of the underlying model. This makes it effective across capability levels, though the scoring weights should be calibrated for the risk profile of the use case.
- **Fluid governance** is more effective with capable models that can engage in scope negotiation (YELLOW decisions). Less capable models may need simpler allow/deny decisions with human override.
- **Proof chains** are universally applicable but the granularity should match the deployment: high-frequency trading agents may need proof batching for performance, while healthcare agents may need per-action proof records for regulatory compliance.
- **Containment effectiveness** depends on the deployment environment's ability to enforce restrictions in real time. Cloud deployments with API-mediated tool access can enforce tool restrictions immediately; edge deployments with local tool access may have enforcement latency.

### 2(c): How practices must adapt to future capability evolution and emerging threats

1. **Scoring algorithms must be extensible** — As new threat categories emerge, the trust scoring system must accommodate new signal types without requiring a complete redesign. We use a weighted category system that allows adding new signal categories without disrupting existing scoring.
2. **Policy rules must be declarative, not procedural** — Hardcoded security logic cannot adapt to novel threats. Policy engines should evaluate declarative rules that can be updated without code changes.
3. **Containment must be progressive, not binary** — As agents become more capable, the cost of false-positive termination increases. Progressive containment (7 levels from monitoring to full halt) provides proportional response.
4. **Inter-agent security must mature** — The current lack of standardized agent-to-agent authentication will become critical as multi-agent deployments scale. We recommend standards work on agent identity verification analogous to TLS for web communication.

### 2(d): Methods and considerations for patching throughout the lifecycle

AI agent patching differs fundamentally from traditional software patching:

1. **Model updates** — Updating the underlying model can change agent behavior unpredictably. We recommend trust score resets (to T0 or T1) after model version changes, with the agent re-earning trust through observed behavior.
2. **Prompt/instruction updates** — Changes to system prompts should be versioned and audited with the same rigor as code changes. We track prompt versions in proof records so that behavioral changes can be correlated with instruction changes.
3. **Tool updates** — When an agent's available tools change, its capability scope changes. Trust scores should be re-evaluated for the new tool set.
4. **Policy updates** — Governance rules should be versioned and deployed with rollback capability. We recommend blue/green policy deployment where new rules run in shadow mode (logging but not enforcing) before activation.
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

**Key gaps:** Existing cybersecurity practices are structurally inadequate for AI agents because they assume:
- Permissions are assigned at deployment time (agents need dynamic, behavior-based permissions)
- The system boundary is well-defined (agents operate inside the boundary by design)
- Identity is tied to humans or services (agents need first-class identity)
- Detection relies on signatures or anomaly baselines (agent behavior is inherently variable)

We recommend NIST develop agent-specific control families that extend CSF 2.0 and bridge the gap between AI RMF's risk management focus and the operational security controls agents require at runtime.

---

## Topic 3: Assessing Security

### 3(a): Methods to anticipate and assess security threats during development, detect incidents post-deployment, and useful resources

**During development:**
- **Threat modeling** — We publish a STRIDE-based threat model for AI agent governance systems (BASIS-THREAT-MODEL.md) that identifies 20 threat scenarios across 7 categories with required mitigations. We recommend threat modeling as a mandatory development practice for agent systems.
- **Adversarial testing** — Red-team exercises should include prompt injection campaigns, tool misuse scenarios, and multi-agent poisoning attacks. These should be conducted against the full agent stack (model + scaffold + tools), not just the model in isolation.
- **Capability enumeration** — Before deployment, catalog every tool and data scope available to the agent. Map each capability to risk categories and define trust tier requirements for access.

**Post-deployment incident detection:**
- **Trust score monitoring** — Sudden drops in trust score indicate behavioral anomalies. We track trust score trajectories and alert on drops exceeding configurable thresholds (default: 100-point drop triggers containment escalation).
- **Proof chain analysis** — Continuous verification of proof chain integrity detects tampering or gaps in the audit trail. Chain completeness, signature validity, and hash chain integrity are monitored as security metrics.
- **Behavioral drift detection** — Compare agent behavior patterns (tool usage frequency, error rates, scope of operations) against established baselines. Significant deviations trigger enhanced monitoring or containment.
- **Escalation frequency monitoring** — Agents that repeatedly trigger YELLOW or RED governance decisions indicate either policy misconfiguration or genuine behavioral instability. Both require investigation.

**Alignment with traditional practices:**
These methods build on established security practices (SIEM, behavioral analytics, audit log review) but adapt them for the unique characteristics of AI agents. The maturity level is early — most organizations deploying agents today lack specialized agent security monitoring.

**Useful resources:** OWASP Top 10 for Agentic Applications, MITRE ATLAS, NIST AI RMF, and the BASIS Standard threat model.

### 3(b): How to assess particular systems and what information helps that assessment

We recommend assessment along four dimensions:

1. **Trust posture** — Current trust tier, score history, and trajectory. An agent with a stable T4 score and no recent containment events presents lower risk than an agent oscillating between T2 and T4.

2. **Capability scope** — What tools, data, and external services can the agent access? Broader capability scope increases attack surface. Assessment should include both explicitly granted capabilities and implicitly available capabilities (e.g., tools accessible through other tools).

3. **Governance coverage** — What percentage of the agent's possible actions are covered by explicit policy rules? We categorize rules by priority (P0 hard disqualifier through P6 logging only). Systems with gaps in P0-P2 coverage present unacceptable risk.

| Priority | Category | Purpose | Assessment Metric |
|----------|----------|---------|-------------------|
| P0 | Hard disqualifier | Immediate denial | False negative rate (target: 0%) |
| P1 | Regulatory mandate | Compliance | Compliance gap % |
| P2 | Security critical | Violation detection | Detection latency (ms) |
| P3 | Policy enforcement | Standard policies | Override rate |
| P4 | Soft constraint | Guidelines | Acknowledgment rate |
| P5 | Clarification trigger | Ambiguity resolution | Clarification success rate |
| P6 | Logging only | Audit trail | Coverage % |

4. **Proof chain health** — Chain completeness (% of decisions with proof records), signature validity, chain integrity verification pass rate, and anchoring freshness.

**Information that helps assessment:** Deployment architecture documentation, tool/capability inventory, policy rule set, trust score history, containment event log, and proof chain audit results. The Vorion reference implementation demonstrates this assessment model with automated control verification across multiple frameworks: NIST SP 800-53 (52 implemented controls, 20 automated tests), SOC 2 (13 automated tests), PCI DSS (32 automated tests), and FedRAMP controls (35 automated tests). SBOM artifacts are generated with NTIA minimum element validation, and proof chain integrity is verified on every append operation.

### 3(c): Documentation from upstream developers that aids downstream security assessment

**What upstream model developers should provide:**
- Model capability evaluations (benchmarks for tool use, instruction following, safety refusals)
- Known vulnerability disclosures (prompt injection susceptibility, jailbreak resistance)
- Training data provenance and poisoning risk assessment
- Behavioral change logs between model versions

**Open-source vs. closed-source considerations:**
- Open-source models allow downstream developers to run their own safety evaluations and fine-tune for safety, but they also allow adversaries to optimize attacks against the specific model
- Closed-source models provide less transparency for security assessment but benefit from the provider's resources for ongoing safety work
- We recommend a hybrid approach: closed-source models should provide standardized security evaluation results (like nutritional labels) without requiring full model access

**Disclosure risks:** Detailed vulnerability disclosures for AI models create a dual-use problem more severe than traditional CVEs, because prompt injection exploits are immediately usable without technical sophistication. We recommend coordinated disclosure with a minimum 90-day patch window, similar to Project Zero's approach, adapted for the faster iteration cycles of AI systems.

### 3(d): User-facing documentation for secure deployment

Documentation for AI agent deployments should include:

1. **Capability manifest** — What the agent can do, what tools it has access to, and what data scopes it operates within
2. **Trust tier and current score** — What level of autonomy the agent operates at, with explanation of what that means in practical terms
3. **Escalation procedures** — How to report agent misbehavior and what happens when an escalation is triggered
4. **Containment status** — If the agent is operating under any restrictions, what they are and why
5. **Audit access** — How to request and review the agent's proof chain for specific actions

The state of practice for user-facing agent documentation is nascent. Most deployed agents today provide no security-specific documentation to end users.

---

## Topic 4: Limiting, Modifying, and Monitoring Agent Access in Deployment

### 4(a): Technical means to constrain deployment environment access (least-privilege, zero-trust adaptations)

We implement **progressive containment** — 7 levels that provide proportional response to detected threats:

| Level | Name | Restrictions | Trigger Examples |
|-------|------|-------------|-----------------|
| L1 | Full Autonomy | None | Default for T5+ agents |
| L2 | Monitored | Enhanced logging | Trust score below T4 threshold |
| L3 | Tool Restricted | High-risk capabilities blocked | Policy violation detected |
| L4 | Human-in-Loop | All actions require approval | Trust score drop >100 points |
| L5 | Simulation Only | Read-only, no side effects | Suspected goal hijacking |
| L6 | Read Only | Write/execute blocked | Confirmed anomalous behavior |
| L7 | Halted | ALL operations blocked | Kill switch activated |

**Least-privilege adaptations for agents:**
- Every approved (GREEN) governance decision attaches specific constraints: allowed tools, data scopes, rate limits, maximum execution time, and reversibility requirements
- Agents receive time-limited, namespace-limited authority objects that expire automatically
- Tool access is mediated through the governance layer — agents cannot access tools directly, only through intent → evaluate → execute flows

**Zero-trust adaptations:**
- Agent identity is verified on every request, not just at session establishment
- Trust scores are re-evaluated continuously, not just at authentication time
- No agent is trusted by default, regardless of its creator or deployment context
- All agent-to-agent communication is treated as potentially adversarial

### 4(b): Environmental modifications and rollback/undo mechanisms

**Capability scoping per decision:**
```json
{
  "allowedTools": ["search", "read_file"],
  "dataScopes": ["namespace:public"],
  "rateLimits": [{ "resource": "api", "limit": 100, "window": "1m" }],
  "maxExecutionTime": 30000,
  "approvalRequired": "automated_check",
  "reversibility": "required"
}
```

**Rollback mechanisms:**
- **Reversibility requirements** — For operations classified as HIGH or CRITICAL risk, the governance engine requires an undo path before approving execution. Operations without a defined undo path are automatically escalated to human review.
- **Checkpoint-based recovery** — Agent sessions create checkpoints before high-risk operations. If the operation fails or produces unexpected results, the system can restore to the pre-operation state.
- **Containment as rollback alternative** — When true rollback is impossible (e.g., an email has been sent, an API call has been made), the system escalates containment level to prevent further damage while alerting human operators.

**Agent identity isolation:**
- **CAR-ID (Categorical Agentic Registry)** — Unique, verifiable identity per agent, distinct from human user credentials
- **No credential inheritance** — In the reference architecture, agent identity is not derived from or linked to human user sessions
- **Trust binding** — Agent identity is cryptographically bound to its trust score; compromised trust automatically restricts identity scope

### 4(c): Managing risks from interactions with humans, digital resources, mechanical systems, and other agents

**Human interactions:**
- Agents must declare confidence levels and underlying assumptions when presenting recommendations to humans
- High-impact recommendations require structured justification (not just natural language explanation)
- Cool-down periods between agent recommendations prevent rapid-fire influence that bypasses human judgment

**Digital resource interactions:**
- All external API calls are mediated through the governance layer with per-call authorization
- Data classification tags propagate through agent processing chains — an agent that reads classified data cannot write to unclassified outputs
- Rate limiting per resource prevents agents from overwhelming external services

**Mechanical/physical system interactions:**
- Physical actuations should require minimum trust tier (T5+) with mandatory human confirmation
- All physical commands should be logged in proof chains with pre-execution simulation where possible
- Emergency stop (L7 containment) must be available through a physically separate control plane

**Inter-agent interactions:**
- Agent-to-agent communication should use cryptographically verifiable identity (not just shared secrets)
- Trust scores should propagate — an agent should not accept instructions from an agent with a lower trust score without governance review
- Delegation chains should be explicitly tracked; implicit authority inheritance across agents should be prohibited

### 4(d): Monitoring methods, deployment challenges, and legal/privacy considerations

**Monitoring methods:**
- **Trust score dashboards** — Real-time visualization of trust scores across all deployed agents with trend analysis and anomaly highlighting
- **Proof chain audit** — Continuous verification of chain integrity with alerting on gaps, invalid signatures, or tampering indicators
- **Behavioral analytics** — Statistical analysis of tool usage patterns, error rates, and escalation frequency compared to established baselines
- **Cascade detection** — Monitoring for correlation between trust score drops across multiple agents, which may indicate a propagating compromise

**Deployment challenges:**
- High-volume agent deployments generate large volumes of proof records; storage and query performance at scale is a practical challenge
- Real-time trust score computation must not introduce latency that degrades agent performance; we recommend pre-computed tier boundaries with asynchronous detailed scoring. In internal benchmark runs, the reference implementation shows ENFORCE gate decisions around ~30ms typical (target <100ms) and PROOF logging around ~10ms typical (target <50ms), demonstrating that governance controls need not introduce prohibitive overhead in the tested deployment profile
- Multi-tenant environments must isolate trust data between tenants while enabling aggregate analysis for the platform operator

**Legal/privacy considerations:**
- Proof chains may contain sensitive data (user queries, agent reasoning traces). Data retention policies must balance auditability with privacy requirements.
- GDPR right-to-erasure conflicts with immutable proof chains. We address this through pseudonymization (proof records reference entity IDs, not personal data) and privacy-preserving verification interfaces designed for Pedersen commitment integration, enabling tier verification without score disclosure.
- Monitoring agent behavior may implicate employee privacy regulations in some jurisdictions when agents act on behalf of specific employees. Clear policies on agent monitoring scope and purpose are necessary.

**Maturity level:** Early. Most organizations deploying agents today lack specialized agent monitoring infrastructure and rely on general-purpose application monitoring tools that miss agent-specific security signals.

### 4(e): Are current AI agent systems widely deployed on the open internet, or in otherwise unbounded environments?

AI agent deployments are rapidly expanding but remain predominantly in bounded enterprise environments. Based on our analysis of publicly reported deployments and industry engagement, we estimate the following distribution:

- **Enterprise deployments** (estimated 70% of production agent usage) operate within organizational boundaries with network-level access controls, but agents within those boundaries often have broad access to internal tools and data
- **Customer-facing agent deployments** (estimated 20%) operate on the open internet but typically interact through structured APIs rather than unrestricted internet access
- **Autonomous web agents** (estimated 10%) — browser-use agents, web scraping agents, and research agents — operate in truly unbounded environments with minimal access controls

**Traffic volume:** There is no established method for tracking AI agent traffic volume on the open internet. User-agent strings are unreliable (agents often use standard HTTP clients). We recommend research into agent identification standards — similar to robots.txt for web crawlers but adapted for AI agents — that enable voluntary identification without creating new fingerprinting risks.

---

## Topic 5: Additional Considerations

### 5(a): Methods, guidelines, and tools supporting security practice adoption

The most effective adoption mechanism is **open-source reference implementations** paired with open standards. We publish:

| Resource | Type | License | URL |
|----------|------|---------|-----|
| BASIS Standard | Open specification | CC BY 4.0 | basis.vorion.org |
| Trust Engine | Reference implementation | Apache-2.0 | @vorionsys/atsf-core |
| Governance Gateway | Reference implementation | Apache-2.0 | @vorionsys/cognigate |
| Proof Chain Service | Reference implementation | Apache-2.0 | @vorionsys/proof-plane |
| Agent Registry | Reference implementation | Apache-2.0 | @vorionsys/car-spec |
| Threat Model | Documentation | CC BY 4.0 | BASIS-THREAT-MODEL.md |
| Compliance Mapping | Documentation | CC BY 4.0 | BASIS-COMPLIANCE-MAPPING.md |
| OWASP Control Mapping | Documentation | CC BY 4.0 | Published at basis.vorion.org/blog |

Open-source tools lower the barrier to adoption because organizations can evaluate, customize, and deploy security controls without vendor lock-in. Standards enable interoperability between different implementations.

We recommend NIST develop or endorse:
1. A standardized trust scoring format that enables trust portability between platforms
2. A proof record schema that enables cross-platform audit chain verification
3. An agent capability manifest format that enables automated security assessment

### 5(b): Most urgent areas for government collaboration

1. **Agent identity standards** — There is no established standard for AI agent identity that is distinct from human identity or service accounts. Government collaboration on agent identity (analogous to PIV/CAC for humans) would address threats ASI03, ASI07, and ASI09 simultaneously.

2. **Multi-agent trust propagation** — As government agencies deploy multi-agent systems, trust propagation between agencies' agents will require interoperable trust frameworks. NIST is uniquely positioned to develop cross-organizational agent trust standards.

3. **Incident reporting and coordination** — AI agent security incidents are currently unreportable through existing channels (CISA, CVE). A reporting mechanism specifically designed for agent security incidents — including prompt injection campaigns, supply chain compromises, and behavioral drift events — would improve collective defense.

4. **Compliance framework alignment** — Government agencies face compliance requirements (FedRAMP, FISMA) that have no mapping to AI agent security controls. NIST guidance on how agent security controls satisfy existing compliance requirements would accelerate safe adoption.

### 5(c): Critical research focus areas and priorities

In priority order:

1. **Prompt injection defenses** — Despite being identified as a critical vulnerability for 3+ years, no robust defense exists. Research should focus on architectural solutions (separating instruction and data channels) rather than input filtering.

2. **Multi-agent trust propagation models** — Formal models for how trust should propagate, decay, and revoke across agent fleets. Current approaches are ad hoc.

3. **Behavioral drift detection** — Methods to detect when an agent's behavior has shifted from its intended purpose, especially through subtle changes that individually appear benign but collectively represent goal drift.

4. **Agent-to-agent authentication** — Cryptographic protocols for agent-to-agent communication that provide authentication, integrity, and non-repudiation without introducing prohibitive latency.

5. **Containment effectiveness measurement** — Empirical research on how effectively containment mechanisms prevent harm propagation, and what containment levels are appropriate for different risk categories.

### 5(d): International approaches and their benefits/drawbacks

| Approach | Jurisdiction | Benefit | Drawback |
|----------|-------------|---------|----------|
| EU AI Act risk classification | EU | Clear risk tiers with proportional requirements | Static classification at deployment time; doesn't adapt to runtime behavior |
| UK AI Safety Institute testing | UK | Pre-deployment evaluation of frontier models | Focuses on model-level safety, not agent-level governance |
| Singapore AI Verify | Singapore | Self-assessment toolkit with technical tests | Voluntary; limited adoption outside Singapore |
| ISO/IEC 42001 (AIMS) | International | Management system approach with certification | High implementation cost; lacks technical specificity for agent controls |
| China's Interim Measures for Generative AI | China | Mandates content filtering and user identity | Focuses on content safety rather than autonomous action safety |

**Our recommendation:** The U.S. should lead on **runtime agent governance standards** — the gap between pre-deployment evaluation (where other jurisdictions have invested) and runtime behavioral controls (where no jurisdiction has published guidance). The graduated trust model, progressive containment, and cryptographic auditability we describe in this response fill this gap.

### 5(e): Applicable practices from outside AI and cybersecurity fields

1. **Aviation safety (crew resource management)** — Aviation's multi-layered authority model (captain, first officer, air traffic control) with structured communication protocols maps directly to multi-agent governance with trust tiers and escalation chains.

2. **Nuclear safety (defense in depth)** — The nuclear industry's multiple independent barriers principle informs our progressive containment design. No single failure should lead to catastrophic outcomes.

3. **Financial services (graduated authority)** — Trading desks use graduated authority limits based on demonstrated competence and track record. Our trust scoring system adapts this principle for AI agents.

4. **Pharmaceutical manufacturing (process validation)** — The FDA's process validation framework (IQ/OQ/PQ) maps to agent lifecycle validation: installation qualification (correct deployment), operational qualification (correct behavior under normal conditions), and performance qualification (sustained correct behavior in production).

5. **Industrial control systems (SCADA safety)** — ICS environments separate safety systems from control systems physically. Agent kill switches should be architecturally isolated from the agent's control plane, following this principle.

---

## Alignment with Existing Standards

| Standard | How This Work Aligns |
|----------|---------------------|
| **NIST AI RMF (AI 100-1)** | GOVERN: Trust tiers and policy rules; MAP: Threat taxonomy; MEASURE: Trust scoring and containment metrics; MANAGE: Progressive containment and kill switches |
| **NIST CSF 2.0** | Extends ID, PR, DE, RS, RC functions with agent-specific controls |
| **NIST IR 8596 (Cyber AI Profile)** | Builds on our January 2026 public comment prepared for NIST's Cyber AI Profile |
| **OWASP Top 10 for Agentic Applications** | Full ASI01–ASI10 mapping with implemented controls |
| **ISO/IEC 42001** | Trust scoring complements AIMS with runtime behavioral measurement |
| **EU AI Act** | Trust tiers map to risk categories; containment addresses Article 14 human oversight requirements |

---

## Attached Reference Materials

| Document | Description |
|----------|-------------|
| OWASP ASI01–ASI10 Control Mapping | Maps all 10 OWASP agentic AI risks to implemented controls |
| BASIS Specification | Open standard for AI agent trust scoring (npm: @vorionsys/basis, domain: basis.vorion.org) |
| BASIS Threat Model | STRIDE-based threat analysis with 20 threat scenarios across 7 categories |
| BASIS Compliance Mapping | SOC 2, ISO 27001, GDPR, HIPAA, PCI DSS, EU AI Act, NIST AI RMF mappings |
| Source Code | Full reference implementation (https://github.com/vorionsys/vorion) |

---

## Conclusion

Securing AI agent systems requires moving beyond traditional cybersecurity patterns. Binary allow/deny, static permissions, and perimeter-based security are structurally inadequate for entities that operate inside the trust boundary, use legitimate tools, communicate in natural language, and evolve their behavior over time.

We recommend NIST guidance emphasize:

1. **Graduated trust** over binary access control
2. **Behavioral monitoring** over static permission checks
3. **Progressive containment** over immediate termination
4. **Cryptographic auditability** over log-file-based audit
5. **Fluid governance** over rigid policy enforcement
6. **Agent identity isolation** over credential inheritance

These patterns are implementable today with existing technology. We offer our open-source reference implementation for NIST evaluation and welcome collaboration on developing voluntary standards for AI agent security.

---

**Respectfully submitted,**

Vorion
https://vorion.org
contact@vorion.org

---

*Document Version: 2.1*
*Prepared: February 2026*
*For submission to: www.regulations.gov, Docket NIST-2025-0035*
*Deadline: March 9, 2026, 11:59 PM ET*
