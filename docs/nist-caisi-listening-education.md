# AI Agent Security in Education
## Sector One-Pager for NIST CAISI Listening Session — March 20, 2026

**Submitted by:** Vorion (vorion.org · contact@vorion.org)
**Session:** Education Sector Breakout
**Related docket:** NIST-2025-0035 (RFI response submitted March 9, 2026)

---

## The Education Sector's Distinct Challenge

AI agents in education interact with a population that includes minors, creates records that follow individuals for decades, and influences one of the highest-stakes developmental processes in a person's life. Three properties distinguish this sector:

1. **Vulnerable population** — COPPA applies to children under 13; FERPA protects all student records; many students are both minors and have disabilities covered under IDEA and Section 504, creating layered privacy and duty-of-care obligations that most deployed agents handle with no specific accommodation.
2. **Longitudinal harm** — An educational agent that labels a student's learning style incorrectly or assigns them to a lower track based on biased assessment creates harm that compounds over years. Unlike a financial error that can potentially be refunded, educational misclassification is difficult to reverse.
3. **Authority hierarchy complexity** — Students, parents, teachers, counselors, administrators, and district officials all have different levels of authority over agent behavior. Institutionalized governance (IEPs, 504 plans, district policy) must constrain agents — not just best-effort prompt instructions.

---

## Current Practice Gaps

| Gap | Risk | Example |
|-----|------|---------|
| No student-safe data scope enforcement | FERPA violation | Tutoring agent trained on one student's data surfaces it during another student's session |
| No minimum age verification for autonomous agent interaction | COPPA violation | Agent collects behavioral data from under-13 users without parental consent mechanism |
| No trust tier for academic integrity contexts | Cheating facilitation | Agent assists with original assessment work without any governance boundary |
| IEP/504 plan not machine-readable, not agent-enforceable | Disability rights risk | Agent assigns timed tasks to a student with documented time-extension accommodation |
| No parent/guardian visibility into agent-student interaction | Transparency deficit | Parents cannot review AI agent session logs affecting their minor child's grades |

---

## Vorion's Approach Applied to Education

### FERPA Record Separation → Data Scope Enforcement

FERPA requires that education records only be disclosed for legitimate educational purposes. The A3I governance layer enforces this at runtime:

- Each student interaction is tagged with the student's entity DID (not PII)
- Data classification (`student_record`, `assessment_data`, `behavioral_trace`) propagates through agent action chains
- Cross-student data access is blocked at the governance layer regardless of what the agent is instructed to do
- All accesses create proof records that satisfy FERPA audit requirements

### IEP/504 Accommodation → Capability Manifest Constraints

Today, IEP and 504 accommodation plans exist as PDFs in records management systems. Agents have no mechanism to enforce them. The capability manifest pattern enables machine-readable accommodation enforcement:

```json
{
  "studentProfile": "anonymized-did-xyz",
  "accommodations": {
    "extendedTime": true,
    "reduceDistraction": true,
    "noTiming": ["assessments", "quizzes"]
  },
  "forbiddenActions": ["timed_assessment", "competitive_ranking_display"],
  "humanReviewRequired": ["grade_assignment", "track_recommendation"]
}
```

This does not require sharing student PII with the agent — the accommodation constraints are policy-layer rules that apply before the agent acts.

### COPPA Parental Consent → Trust Tier by Age Group

Agents interacting with under-13 populations must operate under stricter constraints regardless of capability level. The trust tier model provides a structured approach:

| Student Age Group | Minimum Required Controls | Agent Authority Ceiling |
|------------------|--------------------------|------------------------|
| Under 13 | Parental consent, no behavioral data collection, no autonomous recommendations | L4 Human-in-Loop (teacher must approve agent outputs) |
| 13–17 | FERPA full protections, limited behavioral profiling, parent visibility | L3 Tool Restricted (no grade-affecting autonomous actions) |
| 18+ higher education | Standard FERPA, no COPPA | T3+ Standard with appropriate capability scoping |

**Key recommendation for NIST:** Define agent interaction categories for COPPA purposes — the existing FTC guidance on "online services directed to children" was written for websites, not for AI agents that reason about student performance.

### Academic Integrity → Behavioral Boundaries, Not Content Filtering

The current approach to academic integrity in AI is almost entirely input/output filtering (detecting AI-generated text). This approach is adversarially fragile and creates false positive harms for neurodivergent students whose writing patterns resemble AI output. A governance-layer approach is more robust:

- Define assessment contexts where tool access is restricted (no writing assistance, no lookup during exam windows)
- Use proof chains to verify agent behavior during assessment periods — not to catch cheating after the fact, but to certify that governance controls were active during the assessment
- Allow educators to set context-specific trust constraints (`assessment_mode: true`) that restrict the agent's tool access regardless of student requests

---

## Priority NIST Guidance Requests

1. **FERPA-compliant agent audit records** — DoEd/ED guidance confirming that agent proof records satisfy FERPA's "disclosure tracking" requirements (34 CFR § 99.32) would reduce compliance burden for K-12 districts deploying AI agents, which currently maintain parallel paper and digital audit systems.

2. **COPPA applicability framework for AI agents** — FTC and NIST joint guidance on how COPPA applies to AI agents interacting with minors — specifically, what constitutes "collection" when an agent observes behavioral data during tutoring — is the highest-priority regulatory gap in this sector.

3. **IEP/504 interoperability format** — NIST, DoEd, and ed-tech industry coordination on a machine-readable accommodation standard would enable the next generation of ed-tech agents to enforce accommodations automatically. This is an accessibility and civil rights issue, not just a technical one.

4. **Minimum trust standards for grade-affecting agent actions** — NIST guidance establishing that any agent action affecting a student's grade or track assignment must meet minimum trust and auditability requirements (suggested: T4+ with cryptographic proof record) would provide a baseline that state departments of education could adopt.

5. **Parent/guardian visibility rights for agent sessions** — Clarification that FERPA rights of inspection and review extend to agent session records involving a student's education would enable compliant transparency without requiring agents to store raw conversation text.

---

## Concrete Next Steps

Vorion offers the following resources for NIST evaluation:
- Full reference implementation (Apache-2.0): [github.com/vorionsys/vorion](https://github.com/vorionsys/vorion)
- FERPA and COPPA control mapping (available on request)
- Reference accommodation manifest schema for IEP/504 integration
- Live demo at basis.vorion.org

We welcome collaboration with NIST, DoEd, FTC, and education sector working groups on AI agent governance standards protecting students.

---

*Vorion · vorion.org · contact@vorion.org*
*March 2026*
