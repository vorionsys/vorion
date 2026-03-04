# CAISI Listening Session — Interest Submission
## Barriers to AI Adoption in the Healthcare Sector

**To:** caisi-events@nist.gov
**Subject:** Barriers to Adoption in [Healthcare]
**Organization:** Vorion
**Contact:** Alex Blanc and Ryan Cason — contact@vorion.org | https://vorion.org
**Submission Date:** March 2026
**Target Session:** CAISI Virtual Workshop on Barriers to AI Adoption — April 2026

---

## Organization Description

Vorion is an open-source AI agent security platform developer. We build and maintain the BASIS Standard — an open trust scoring and governance specification for AI agent systems — and reference implementations used in enterprise and regulated-industry deployments. Healthcare and life sciences organizations represent a primary adopter category for our compliance control implementations covering HIPAA, NIST SP 800-53, and FedRAMP.

---

## Barriers to Adoption in the Healthcare Sector

Healthcare organizations face the most severe barriers to AI agent adoption of any sector. Three structural problems — each beyond what current standards address — account for the near-complete absence of autonomous AI agent deployments in clinical environments despite strong demand:

**1. No HIPAA-compliant audit trail standard for agent actions**

HIPAA requires auditable records of every access to protected health information (PHI). AI agents that retrieve, process, or generate content involving PHI must produce per-action audit records that satisfy HIPAA's access log requirements. No current HIPAA guidance addresses agents specifically: it is unclear whether an agent's "intent" constitutes an access event, whether an agent's reasoning trace is itself PHI, and whether standard web server logs satisfy the requirement. The result is that healthcare compliance officers cannot approve AI agent deployments at all — not because of a security failure but because the compliance framework has no vocabulary for agents. Healthcare organizations wait for HIPAA guidance that does not yet exist rather than deploy and risk civil monetary penalties.

**2. Liability chain break at the human-agent boundary**

When an AI agent takes a clinical-adjacent action — scheduling, documentation, referral triaging, prior authorization — the liability question of "who is responsible if the agent is wrong?" is unanswered. Physicians, hospitals, and health systems cannot accept responsibility for an agent's autonomous decisions without a mechanism to demonstrate they exercised appropriate oversight. This requires: (a) a trust score or confidence metric attached to each agent decision, (b) a documented escalation path for low-confidence decisions, and (c) an immutable record that the oversight mechanism was in place. Our implementation provides all three, but healthcare organizations report that their legal counsel will not accept vendor-specific audit records absent a recognized standard format.

**3. Data classification propagation breaks in multi-step workflows**

Clinical AI workflows are inherently multi-step: an agent may search a patient record, summarize findings, cross-reference drug databases, and draft a care recommendation in a single session. Each step may touch data of different sensitivity classifications. Current AI agent scaffolds have no mechanism to propagate data classification through the reasoning chain — an agent that touches PHI in step 1 can silently produce non-flagged output in step 4. Our governance implementation addresses this with per-intent data scope tracking that propagates classification tags through the full execution chain, but the pattern is not standardized.

**What enabled progress:** Healthcare AI deployments that succeeded shared one pattern: narrowly scoped agents with explicit containment levels (read-only access to clinical data, no write authority without human approval), cryptographic proof records for each action, and documented escalation procedures tied to existing clinical governance workflows. The commonality is that the AI agent was governed like a junior clinical staff member — graduated access, supervised initially, audited continuously.

---

*Vorion provides open-source implementations of all enabling patterns described above, including HIPAA-relevant proof chain design and FedRAMP control mappings (35 automated tests). We welcome the opportunity to present this evidence to CAISI's working group.*

---
*One page — submitted per CAISI interest submission format, February 2026 announcement*
