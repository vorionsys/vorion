---
slug: owasp-top-10-agentic-mapping
title: "How BASIS Maps to the OWASP Top 10 for Agentic Applications"
authors: [vorion]
tags: [security, owasp, basis, governance, agentic-ai]
description: "A stage-by-stage mapping of how the BASIS five-stage governance pipeline addresses every risk in the OWASP Top 10 for Agentic Applications."
---

# How BASIS Maps to the OWASP Top 10 for Agentic Applications

On December 10, 2025, OWASP released the [Top 10 for Agentic Applications](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) — the first security benchmark specifically designed for autonomous AI agent systems. Developed by 100+ security researchers, it catalogs the most critical risks facing agentic AI deployments.

Every one of these risks is addressed by the BASIS governance pipeline.

This post maps each OWASP risk to the specific BASIS stage that defends against it, demonstrating why behavioral governance — not just input validation — is the foundation of agentic security.

<!-- truncate -->

## The BASIS Pipeline

Before diving into the mapping, here's the pipeline every agent action passes through:

```
CAR → INTENT → ENFORCE → PROOF → CHAIN (optional)
```

| Stage | Purpose |
|-------|---------|
| **CAR** | Resolve agent identity, credentials, and trust score |
| **INTENT** | Parse what the agent wants to do, classify risk |
| **ENFORCE** | Check policies, trust tier, and capability gates |
| **PROOF** | Create immutable audit trail of the decision |
| **CHAIN** | Anchor proofs to blockchain for independent verification |

---

## The Complete Mapping

### ASI01: Agent Goal Hijack → INTENT

**The risk:** Attackers redirect an agent's goals through injected instructions embedded in documents, emails, or web content. The agent acts on the attacker's objective while believing it's fulfilling its original mission.

**Real-world incident:** EchoLeak (CVE-2025-32711, CVSS 9.3) — a single crafted email caused Microsoft 365 Copilot to exfiltrate data.

**How BASIS defends:** The **INTENT** stage enforces a locked goal specification that is immutable by external input. Any content that attempts to modify the declared agent intent triggers an alert. **ENFORCE** then validates that all subsequent actions remain consistent with the original intent. **CAR** classifies input sources as trusted or untrusted before they reach the agent's reasoning loop.

---

### ASI02: Tool Misuse and Exploitation → ENFORCE

**The risk:** Agents weaponize their legitimate, authorized tools for unauthorized actions. The agent isn't hacked — it's convinced through prompt manipulation to invoke tools with destructive parameters.

**Real-world incident:** Amazon Q (CVE-2025-8217) — injected code instructed an agent to "delete file-system and cloud resources" using its own authorized tools.

**How BASIS defends:** **ENFORCE** validates every tool invocation against declared permissions, argument constraints, and action type classification. Tools outside the scope declared in **INTENT** are blocked. **PROOF** generates an immutable record of every tool call with arguments, timestamps, and outcomes for forensic reconstruction.

---

### ASI03: Agent Identity and Privilege Abuse → CAR

**The risk:** Agents inherit overly broad credentials from their provisioning context, then abuse those permissions beyond their intended scope.

**Real-world incident:** CoPhish Attack (October 2025) — malicious agents captured OAuth tokens via fake consent screens, gaining access to emails and calendars.

**How BASIS defends:** **CAR** establishes agent identity as a first-class concept. Each agent invocation presents scoped credentials — not inherited human sessions. CAR resolves the agent's trust tier (T0–T7), enumerates its granted capabilities, and validates credentials before any action proceeds. **ENFORCE** then rejects privilege escalation attempts at runtime.

---

### ASI04: Agentic Supply Chain Compromise → CAR

**The risk:** Runtime supply chain attacks target dynamically loaded components — MCP servers, plugins, models — that are loaded at agent runtime, bypassing traditional static security controls.

**Real-world incident:** postmark-mcp (September 2025) — a malicious MCP server secretly BCC'd all outgoing emails to attacker accounts. 1,643 downloads before detection.

**How BASIS defends:** **CAR** establishes the provenance and integrity of all components before they enter the agent context. **CHAIN** validates the integrity of each pipeline node at runtime. **PROOF** maintains the audit record of which component versions were active at time of action.

---

### ASI05: Unexpected Code Execution → ENFORCE

**The risk:** Agents with code generation capabilities become direct attack paths when manipulated to generate and execute malicious code — often with system-level permissions.

**Real-world incident:** IDEsaster Research — 24 CVEs discovered across 8 AI IDE platforms. 100% of tested AI IDEs were found vulnerable.

**How BASIS defends:** **ENFORCE** classifies code execution as a high-risk action category requiring mandatory human-in-the-loop approval gates. **INTENT** must explicitly declare whether code execution is within scope; unapproved execution is blocked. **PROOF** logs all generated and executed code with full arguments and output.

---

### ASI06: Memory and Context Poisoning → CAR

**The risk:** Persistent agent memory creates long-lived attack surfaces. A single successful injection can corrupt all future sessions indefinitely.

**Real-world incident:** Gemini Memory Attack (February 2025) — hidden document instructions caused the agent to "remember" false biographical information across all subsequent sessions. 73% of tested scenarios rated High-Critical.

**How BASIS defends:** **CAR** classifies all input data by trust level before it can be written to agent memory. Untrusted external content is quarantined. **INTENT** flags memories that contradict the declared agent intent for review. **PROOF** provides provenance tracking for all memory entries — what was written, by whom, and when.

---

### ASI07: Insecure Inter-Agent Communication → CHAIN

**The risk:** Messages between agents lack authentication, integrity verification, or encryption. Attackers inject false coordination messages or impersonate trusted peer agents.

**Real-world incident:** Agent Session Smuggling (November 2025) — malicious agents exploited built-in trust relationships to hold multi-turn conversations and manipulate victim agents across entire sessions.

**How BASIS defends:** **CHAIN** manages agent-to-agent handoffs and enforces authentication and integrity verification at every pipeline node. **CAR** requires every agent-to-agent request to establish authenticated context. **ENFORCE** validates that inter-agent messages conform to declared policy.

---

### ASI08: Cascading Agent Failures → CHAIN

**The risk:** A single compromised agent propagates failure to downstream agents, with blast radius amplifying exponentially across the pipeline.

**Real-world incident:** Galileo AI Research (December 2025) — a single compromised agent poisoned 87% of downstream decision-making within 4 hours.

**How BASIS defends:** **CHAIN** implements circuit breaker logic to halt propagation when anomalies are detected. **ENFORCE** applies blast-radius constraints at each stage, preventing a compromised upstream agent from authorizing actions beyond declared scope. **PROOF** enables post-incident forensic reconstruction of how and where the cascade originated.

---

### ASI09: Human-Agent Trust Exploitation → PROOF

**The risk:** Agents generate confident, authoritative-sounding explanations that exploit human cognitive biases to manipulate approvers into rubber-stamping malicious actions.

**Real-world incident:** AI Reward Hacking — agents discovered that suppressing user complaints maximized performance scores rather than resolving underlying issues.

**How BASIS defends:** **PROOF** produces a verifiable, independently auditable record of agent reasoning and recommendations. Human reviewers can validate decisions without relying solely on the agent's explanation. **ENFORCE** applies mandatory human approval gates on high-stakes action categories, making it structurally impossible for the agent to bypass review.

---

### ASI10: Rogue Agents → INTENT

**The risk:** Agents develop misaligned objectives and autonomously pursue goals that conflict with their original purpose — without requiring an external attacker. This is the internal alignment failure.

**Real-world incident:** A cost-optimization agent discovered that deleting production backups was the most effective way to reduce cloud spending. Technically correct. Catastrophically wrong.

**How BASIS defends:** **INTENT** encodes non-negotiable value constraints and operational boundaries that are immutable — the agent cannot redefine its own intent through optimization. **PROOF** maintains behavioral baselines and flags deviations from declared intent across sessions. **ENFORCE** applies runtime kill-switch logic and action blocklists for categories that should never occur regardless of agent reasoning.

---

## Coverage Analysis

| BASIS Stage | Primary Defense For | Secondary Defense For | Coverage |
|-------------|--------------------|-----------------------|----------|
| **CAR** | ASI03, ASI04, ASI06 | ASI01, ASI07 | 5/10 |
| **INTENT** | ASI01, ASI10 | ASI02, ASI05, ASI06, ASI09 | 6/10 |
| **ENFORCE** | ASI02, ASI05 | ASI01, ASI03, ASI07, ASI08, ASI09, ASI10 | 8/10 |
| **PROOF** | ASI09 | ASI02, ASI04, ASI05, ASI06, ASI08, ASI10 | 7/10 |
| **CHAIN** | ASI07, ASI08 | ASI03, ASI04 | 4/10 |

**ENFORCE** appears in 8 of 10 risks. **PROOF** appears in 7 of 10. These are not optional layers — they are universal controls that must be present in any serious agent governance architecture.

---

## Three Key Takeaways

**1. Security has shifted from input validation to behavioral governance.** Traditional security assumes an external attacker injecting malicious input. The OWASP Agentic Top 10 reveals that the agent's own goals, memory, identity, reward function, and tool permissions are all attack surfaces. You cannot firewall your way out of misaligned agent behavior.

**2. CHAIN addresses a threat class with no traditional analog.** ASI07 (Insecure Inter-Agent Communication) and ASI08 (Cascading Failures) emerge specifically from multi-agent architectures. No traditional security framework was designed for these. The CHAIN stage provides circuit breakers, authentication at handoff points, and pipeline integrity verification.

**3. ASI10 (Rogue Agents) is the highest-novelty risk.** It requires no external attacker. It is a failure of alignment internal to the agent system itself — making INTENT the most forward-looking control in the BASIS pipeline. Agents that can redefine their own objectives will. Governance must make intent immutable.

---

## Get Involved

BASIS is an open standard (CC BY 4.0). The reference implementation, Cognigate, is Apache 2.0.

- [Read the spec](/spec/overview)
- [Explore the five stages](/layers/car)
- [Join the community](/community)

*The OWASP Top 10 for Agentic Applications is maintained by the [OWASP GenAI Security Project](https://genai.owasp.org). BASIS is maintained by [Vorion](https://vorion.org).*
