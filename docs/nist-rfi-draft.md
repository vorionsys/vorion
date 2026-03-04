# NIST RFI Response Draft

**Docket:** NIST-2025-0035
**Title:** Request for Information on Artificial Intelligence Risk Management
**Deadline:** March 9, 2026
**Submitted by:** Vorion Risk, LLC (vorion.org)

---

## Cover Letter

National Institute of Standards and Technology
100 Bureau Drive
Gaithersburg, MD 20899

Re: NIST-2025-0035 — RFI on AI Risk Management

Dear NIST AI Risk Management Framework Team,

We are Vorion Risk, LLC — a two-person open-source project building governance tooling for autonomous AI agents. We submit this response not as established experts, but as practitioners who encountered the agent governance gap firsthand and built tools to address it.

Our perspective is narrow but concrete: we have written and deployed a working governance runtime (Cognigate) and an open specification (BASIS) that implements pre-reasoning policy enforcement for AI agents. We share our experience in the hope it provides useful data points for the RMF's evolution.

We have no funding, no advisory board, and no policy credentials. What we have is working code, 15,000+ tests, and a willingness to be wrong in public.

Respectfully,

Alex Blanc & Ryan Cason
Vorion Risk, LLC
contact@vorion.org

---

## 1. Identification of Respondent

**Organization:** Vorion Risk, LLC
**Type:** Open-source software project (2 maintainers)
**Website:** https://vorion.org
**GitHub:** https://github.com/vorionsys
**Contact:** contact@vorion.org

**Relevant work:**
- BASIS (Behavioral Agent Standard for Integrity & Safety) — open specification for agent governance
- Cognigate — live enforcement runtime implementing BASIS (Apache 2.0)
- Vorion SDK — TypeScript monorepo with governance primitives (Apache 2.0)

---

## 2. Responses to RFI Questions

### 2.1 On Agent-Specific Risks Not Addressed by Current RMF

The current AI RMF (AI 100-1) addresses model-level risks effectively but does not account for the unique risks introduced by autonomous agents — systems that plan, use tools, and take real-world actions across multiple steps.

**Specific gaps we have encountered:**

**a) Pre-reasoning vs. post-reasoning governance.** Current safety approaches focus on model outputs (content filtering, RLHF alignment). Agents require governance at the *intent* level — before reasoning begins. An agent that plans to "send all customer data to an external API" should be caught at plan formation, not after execution.

Our implementation: BASIS defines an INTENT stage that normalizes raw goals into structured plans and applies deterministic TRIPWIRE checks before any LLM reasoning occurs.

**b) Identity and trust accumulation.** Models are stateless; agents accumulate context, permissions, and trust over time. The RMF does not address how agent identity should be managed or how trust should decay.

Our implementation: The CAR (Categorical Agentic Registry) provides verifiable agent identities. ATSF (Agent Trust Scoring Framework) computes trust scores (0–1000) mapped to 8 tiers (T0–T7) with time-based decay.

**c) Multi-step action chains.** A single agent action may be safe in isolation but dangerous in sequence. Current risk frameworks evaluate individual outputs, not action chains.

Our implementation: The ENFORCE stage evaluates full structured plans (multiple objectives) against capability gates, with velocity caps and circuit breakers for rapid successive actions.

**d) Cryptographic auditability.** Agent actions need immutable audit trails for forensic analysis and regulatory compliance. Current guidance does not specify audit requirements for agent systems.

Our implementation: The PROOF stage creates SHA-256 hash chains for every governance decision, queryable via API.

### 2.2 On Practical Implementation Challenges

**Challenge 1: Latency vs. safety tradeoff.** Governance adds latency to every agent action. Our target is sub-100ms per pipeline pass. This is achievable for rule-based checks but becomes difficult when governance itself requires LLM reasoning.

**Challenge 2: Trust tier calibration.** We defined 8 trust tiers (T0–T7) with score boundaries. These are arbitrary — we have no empirical data on where boundaries should fall. Standardized benchmarks for agent trust calibration would be valuable.

**Challenge 3: Framework fragmentation.** LangChain, CrewAI, AutoGen, and custom frameworks each handle agent execution differently. A governance standard must be framework-agnostic. We achieved this by operating at the JSON intent level, not the framework level.

**Challenge 4: Testing governance systems.** We maintain 15,309 tests including mutation testing (Stryker). Testing governance is harder than testing features — you must prove that unsafe actions are *always* denied, not just that safe actions succeed.

### 2.3 On Standards and Specifications

We believe the AI RMF should consider:

1. **Agent-specific risk profiles** — distinct from model risk profiles, accounting for tool use, multi-step planning, and real-world action capabilities.

2. **Mandatory pre-reasoning governance** — for high-risk agent applications, requiring policy evaluation before agent reasoning begins.

3. **Trust scoring standards** — standardized frameworks for agent trust accumulation and decay, with published benchmarks.

4. **Audit trail requirements** — minimum standards for agent action logging, including cryptographic integrity.

5. **Interoperability requirements** — governance systems should work across agent frameworks via standardized interfaces (we use JSON-based APIs).

### 2.4 On Open-Source Contributions

All of our work is Apache 2.0 licensed and available for inspection:

- **BASIS spec:** https://github.com/vorionsys/vorion/blob/main/docs/BASIS.md
- **Cognigate runtime:** https://github.com/vorionsys/cognigate
- **Vorion SDK:** https://github.com/vorionsys/vorion

We welcome NIST's review and critique of these implementations. We are early-stage and likely wrong about many things — but we have working code that demonstrates one possible approach.

---

## 3. Limitations of Our Perspective

- We are 2 people with no formal AI safety training
- Our tools have 0 external production deployments
- We have not been audited or independently reviewed
- Our trust tier boundaries are arbitrary
- We learned to code primarily through AI tools

We share this submission because we believe practical implementation experience — even from small teams — provides useful data for standards development.

---

## 4. Supporting Materials

- BASIS Specification v0.1: https://github.com/vorionsys/vorion/blob/main/docs/BASIS.md
- Cognigate API Documentation: https://cognigate.dev/docs
- Vorion ROADMAP: https://github.com/vorionsys/vorion/blob/main/docs/ROADMAP.md
- Team Background: https://vorion.org/about

---

*Draft prepared February 2026. For review and refinement before submission deadline of March 9, 2026.*
*This document has not been submitted. It requires legal review and team approval before filing.*
