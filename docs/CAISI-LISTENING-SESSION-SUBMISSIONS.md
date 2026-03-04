# NIST CAISI Listening Sessions — Barriers to AI Adoption
## Application Submissions for Vorion Risk, LLC

**Event:** CAISI Virtual Workshops on Barriers to AI Adoption (April 2026)
**Announced:** February 17, 2026
**Application Deadline:** March 20, 2026
**Submit To:** caisi-events@nist.gov
**Source:** https://www.nist.gov/news-events/news/2026/02/caisi-host-listening-sessions-barriers-ai-adoption

---

## Application Email Template

**From:** contact@vorion.org
**To:** caisi-events@nist.gov
**Subject:** Barriers to Adoption in [SECTOR]

Dear CAISI Events Team,

Vorion Risk, LLC requests participation in the upcoming CAISI listening session on barriers to AI adoption in the [SECTOR] sector.

**Organization:** Vorion Risk, LLC
**Contact:** Ryan Cason and Alex Blanc
**Email:** contact@vorion.org
**Website:** https://vorion.org

We are the maintainers of the Vorion Governed AI Execution Platform and the BASIS (Behavioral Agent Safety and Interoperability Standard) open specification. We submitted a response to the CAISI RFI on AI Agent Security (Docket NIST-2025-0035) and public comments on NIST IR 8596.

Our one-page barrier description is attached below.

Respectfully,
Alex Blanc & Ryan Cason
Vorion Risk, LLC

---
---

# Submission 1: Healthcare

**Subject Line:** Barriers to Adoption in Healthcare

## Current Barriers to AI Adoption in Healthcare Organizations

**Organization:** Vorion Risk, LLC — Open-source AI governance platform and the BASIS open standard
**Contact:** Ryan Cason and Alex Blanc | contact@vorion.org | https://vorion.org

### The Core Problem

Healthcare organizations want to deploy AI agents for clinical decision support, administrative automation, and patient interaction — but cannot do so safely because **no standard mechanism exists to enforce graduated trust on autonomous AI systems operating in clinical environments.**

### Barrier 1: Binary Access Control Is Inadequate for Clinical AI Agents

Current AI deployment models force healthcare organizations into a binary choice: give an AI agent full access to clinical systems, or don't deploy it at all. This is fundamentally incompatible with healthcare's tiered credentialing model.

A clinical AI agent assisting with medication reconciliation needs read access to patient records, but should not have prescribing authority. An agent reviewing radiology images needs access to imaging data, but should not modify treatment plans. Today, there is no standardized framework for implementing these graduated permissions at runtime. Organizations either over-privilege agents (creating patient safety risks) or under-deploy them (forfeiting efficiency gains).

**What would help:** Standardized trust scoring and capability tiering for AI agents — analogous to clinical credentialing — where agents earn expanded permissions through demonstrated safe behavior, with automatic privilege reduction when anomalies are detected.

### Barrier 2: No Audit Trail Standard for Agent Decision Chains

HIPAA requires audit trails for access to protected health information. When an AI agent makes a multi-step clinical recommendation (retrieve records → analyze → suggest treatment), each step must be auditable. Current AI systems produce opaque logs that do not meet forensic requirements.

Healthcare organizations cannot deploy AI agents in clinical workflows without **cryptographically verifiable, tamper-evident decision logs** that satisfy both HIPAA audit requirements and clinical malpractice records retention standards.

**What would help:** Standardized audit trail requirements for AI agent actions in healthcare, including hash-chain integrity for decision sequences and provenance tracking for every data access.

### Barrier 3: Resource Exhaustion as Patient Safety Risk

Inefficient AI agents consuming excessive compute resources can create denial-of-service conditions for critical clinical systems. A poorly optimized agent running medication interaction checks could degrade EHR response times for the entire department. Unlike traditional IT systems, AI agent resource consumption is unpredictable and task-dependent.

**What would help:** Resource governance standards for AI agents in clinical environments, including declared resource limits, cost-to-value monitoring, and automatic degradation before clinical system performance is impacted.

### What We Bring to the Conversation

Vorion has built and deployed open-source implementations addressing each of these barriers: trust scoring with 8 capability tiers (BASIS standard), SHA-256 hash-chain audit trails (Proof Plane), and cost-to-value resource governance — all validated with 15,000+ tests. We offer concrete implementation data, not theory.

---
---

# Submission 2: Finance

**Subject Line:** Barriers to Adoption in Finance

## Current Barriers to AI Adoption in Financial Services Organizations

**Organization:** Vorion Risk, LLC — Open-source AI governance platform and the BASIS open standard
**Contact:** Ryan Cason and Alex Blanc | contact@vorion.org | https://vorion.org

### The Core Problem

Financial institutions are eager to deploy AI agents for risk assessment, compliance automation, fraud detection, and customer service — but adoption is blocked because **existing regulatory frameworks have no provisions for autonomous AI agents that make multi-step decisions with real financial consequences.**

### Barrier 1: Regulatory Model Assumes Human Decision-Makers

Financial regulations (OCC guidance, SEC rules, FINRA standards) assume that decisions are made by licensed, identified humans who can be held accountable. AI agents operate in a governance gap: they are not employees, not contractors, and not traditional software. No regulatory framework defines:

- How an AI agent's "identity" maps to existing compliance structures
- What trust level an agent must demonstrate before executing trades, approving loans, or flagging suspicious activity
- How agent permissions should be graduated based on demonstrated competence and compliance history

Financial institutions cannot deploy AI agents for regulated activities without a standardized identity and trust framework that regulators will accept during examinations.

**What would help:** Standardized agent identity and trust scoring frameworks — potentially referencing NIST AI RMF's GOVERN function — that give regulators a familiar control structure for evaluating AI agent deployments.

### Barrier 2: Explainability Requirements Cannot Be Met by Current AI Agent Architectures

Financial regulators require that decisions affecting consumers be explainable (ECOA adverse action notices, Fair Lending analysis, BSA/AML suspicious activity documentation). When an AI agent chains multiple reasoning steps — retrieve market data → run risk model → apply compliance rules → generate recommendation — the resulting "explanation" is either a black-box LLM output or a brittle reconstruction.

Financial institutions need **deterministic governance checkpoints** at each stage of an agent's decision chain, producing audit-ready documentation that satisfies both internal risk management and external regulatory examination.

**What would help:** Standards for AI agent decision logging that produce regulator-ready audit artifacts at every governance checkpoint, with cryptographic integrity guarantees.

### Barrier 3: Framework Fragmentation Prevents Enterprise Standardization

Financial institutions evaluating AI agent platforms face a fragmented landscape (LangChain, CrewAI, AutoGen, custom frameworks) with no common governance interface. Each framework handles agent execution differently, making it impossible to apply consistent compliance controls across the enterprise.

A bank deploying LangChain for customer service agents and CrewAI for back-office automation needs a single governance layer that works across both — evaluating agent actions at the intent level, not the framework level.

**What would help:** Framework-agnostic governance standards that operate at the structured intent/action level, enabling financial institutions to apply uniform compliance controls regardless of the underlying agent framework.

### What We Bring to the Conversation

Vorion's open-source platform implements framework-agnostic governance through JSON-based intent evaluation, 8-tier trust scoring mapped to capability gates, and cryptographic proof chains — all patterns designed for regulated environments. We have mapped our controls to NIST AI RMF at the subcategory level (~86% coverage) and can share concrete implementation data on every barrier described above.

---
---

# Submission 3: Education

**Subject Line:** Barriers to Adoption in Education

## Current Barriers to AI Adoption in Educational Institutions

**Organization:** Vorion Risk, LLC — Open-source AI governance platform and the BASIS open standard
**Contact:** Ryan Cason and Alex Blanc | contact@vorion.org | https://vorion.org

### The Core Problem

Educational institutions want to deploy AI agents for adaptive learning, student support, assessment, and administrative automation — but adoption is stalled because **no governance framework exists to protect students from AI agents that accumulate trust and data across extended interactions without appropriate safeguards.**

### Barrier 1: Extended Student Interactions Create Unique Trust Risks

Unlike most AI use cases, educational AI agents interact with the same students over weeks, months, or semesters. These long-running relationships create risks not present in transactional AI deployments:

- **Memory poisoning over time** — A single prompt injection early in a semester could influence every subsequent interaction, subtly altering learning outcomes without detection
- **Trust exploitation** — Students may develop reliance on AI agent recommendations without understanding the agent's limitations or trust level
- **Behavioral drift** — An agent optimizing for engagement metrics may drift toward keeping students interacting rather than actually learning

Educational institutions have no framework for managing AI agent trust across extended interactions — no standard for trust decay, re-evaluation, or capability adjustment based on behavioral monitoring over time.

**What would help:** Standards for long-duration AI agent governance, including trust scoring with time-based decay, periodic re-evaluation checkpoints, and behavioral drift detection.

### Barrier 2: FERPA Compliance for Agent-Collected Data Is Undefined

FERPA protects student education records, but the boundaries of this protection are unclear when AI agents collect behavioral data through extended interactions. Does an AI tutor's record of a student's learning patterns constitute an "education record"? Who is the "school official" responsible for an agent's data handling? How long can interaction data be retained?

Educational institutions cannot deploy AI agents that collect student interaction data without clear guidance on FERPA applicability to agent-collected behavioral data, access controls for agent-stored information, and data retention/deletion requirements.

**What would help:** Clear regulatory guidance on FERPA application to AI agent interactions, with technical standards for agent data governance that institutions can implement and auditors can verify.

### Barrier 3: Cost Equity — Resource-Intensive AI Creates Access Gaps

Resource-intensive AI agents (frontier models, multi-step reasoning) cost more to operate. Without resource governance, well-funded schools deploy capable agents while under-resourced schools get inferior AI assistance — or none at all. This creates a two-tier educational system where AI amplifies existing inequities rather than reducing them.

Educational institutions need **cost-to-value governance** that ensures AI agents deliver consistent educational outcomes within predictable resource budgets, enabling equitable deployment across institutions of varying means.

**What would help:** Standards for AI agent resource governance in education, including cost-to-value monitoring, efficiency baselines, and minimum service quality requirements that prevent resource constraints from degrading educational outcomes.

### What We Bring to the Conversation

Vorion's open-source platform addresses all three barriers with production-ready implementations: trust scoring with 182-day decay cycles, SHA-256 audit trails for every agent interaction, and cost-to-value resource monitoring — patterns that educational institutions can adopt without vendor lock-in. We offer concrete data from building these systems, not theoretical proposals.

---
---

## Timeline and Action Items

| Date | Action |
|------|--------|
| **Now** | Review and finalize one-page submissions |
| **By March 9** | Submit CAISI RFI response (Docket NIST-2025-0035) |
| **By March 20** | Email all three sector applications to caisi-events@nist.gov |
| **April 2026** | Participate in virtual workshops |

## Source Materials Used

- CAISI RFI Response (Docket NIST-2025-0035) — `nist-caisi-rfi-response-2026-02.md`
- NIST IR 8596 Public Comment — `nist-cyber-ai-profile-comment-2026-01.md`
- NIST AI RMF Case Study — `NIST_AI_RMF_CASE_STUDY.md`
- NIST AI RMF Compliance Mapping — `compliance/nist-ai-rmf-mapping.md`
- RFI Draft (Humble Version) — `nist-rfi-draft.md`

---

*Prepared: March 2026*
*Status: DRAFT — Requires team review before submission*
