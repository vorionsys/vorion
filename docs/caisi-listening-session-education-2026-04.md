# CAISI Listening Session — Interest Submission
## Barriers to AI Adoption in the Education Sector

**To:** caisi-events@nist.gov
**Subject:** Barriers to Adoption in [Education]
**Organization:** Vorion
**Contact:** Alex Blanc and Ryan Cason — contact@vorion.org | https://vorion.org
**Submission Date:** March 2026
**Target Session:** CAISI Virtual Workshop on Barriers to AI Adoption — April 2026

---

## Organization Description

Vorion is an open-source AI agent security platform developer. We build and maintain the BASIS Standard — an open trust scoring and governance specification for AI agent systems — and reference implementations covering FERPA-adjacent compliance patterns and data classification for sensitive populations including minors. Our trust governance framework is directly applicable to the specific challenges education institutions face deploying AI agents in student-facing contexts.

---

## Barriers to Adoption in the Education Sector

Education institutions are among the most risk-averse AI agent adopters despite facing the clearest use cases (tutoring, advising, administrative workflows). Three barriers — each rooted in the absence of governance standards rather than technology limitations — account for the gap between stated interest and actual deployment:

**1. FERPA has no agent-specific provisions; institutions are paralyzed by interpretive risk**

The Family Educational Rights and Privacy Act governs access to student education records but was written for human actors accessing defined records. AI agents operating in educational environments may: access student records to personalize instruction, generate derivative content from educational records (raising the question of whether agent outputs are themselves education records), and operate across student populations in ways that aggregate individually innocuous data into sensitive profiles. Institutional legal counsel universally interprets FERPA's silence on agents as prohibitive risk. No federal guidance clarifies whether an AI agent acting on behalf of an institution constitutes "school official" access, whether conversational AI interactions with students are education records, or what disclosure obligations apply. Without clarification, legal review alone blocks AI agent deployments regardless of technical safeguards.

**2. Duty of care for minor populations requires trust guarantees that no current AI framework provides**

K-12 institutions have heightened duty of care obligations for minor students. AI agents interacting with students — tutoring, counseling support, administrative communication — must be demonstrably safe, bounded, and supervised. "Safe and bounded" requires more than terms of service: it requires documented capability constraints (what the agent can and cannot do), behavioral audit trails showing compliance with those constraints, and a tested escalation path for out-of-bounds behavior. Current AI platforms provide none of these in a form that satisfies institutional risk management or parental transparency requirements. Our implementation's graduated trust tiers (T0 Sandbox through T7 Autonomous) and progressive containment model map directly to the supervision levels K-12 institutions already apply to human staff working with minors — but no standard exists for requiring or verifying it in AI deployments.

**3. The accountability gap between AI-assisted and AI-performed work undermines institutional integrity frameworks**

As AI agents move from assistive tools to autonomous actors in educational workflows — drafting individualized learning plans, generating assessment feedback, processing financial aid documentation — institutions face an accountability inversion: they are responsible for decisions they did not make and cannot fully audit. This is distinct from the "AI cheating" problem (student misuse) and instead concerns institutional actors deploying agents that make consequential decisions about student outcomes. The absence of cryptographically verifiable, timestamped, per-decision audit records makes it impossible for institutions to demonstrate to accreditors, regulators, or courts that human oversight of agent-driven decisions was genuine rather than nominal.

**What enabled progress:** The education AI deployments that moved forward successfully were characterized by: (a) narrow scope with explicit written documentation of what the agent could access; (b) read-only or annotation-only modes initially, with supervised expansion based on observed behavior; and (c) explicit parent/student disclosure of AI involvement in any consequential decision. These mirror the containment and transparency primitives our platform implements. The pattern validates that education institutions need governance infrastructure more than they need AI capability.

---

*Vorion provides open-source implementations of trust scoring, containment, and cryptographic audit capabilities directly applicable to FERPA-adjacent compliance and minor population safety requirements. We welcome the opportunity to present this evidence to CAISI's working group.*

---
*One page — submitted per CAISI interest submission format, February 2026 announcement*
