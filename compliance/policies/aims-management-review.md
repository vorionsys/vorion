# AIMS Management Review Process

**Document ID:** VOR-AIMS-MRV-001
**Version:** 1.0.0
**Effective Date:** 2026-02-20
**Classification:** INTERNAL -- CONTROLLED
**Last Updated:** 2026-02-20
**Owner:** AIMS Manager, Vorion
**Approved By:** [PENDING -- Executive Sponsor]
**Review Cadence:** Annual (next review: 2027-02-20)
**Satisfies:** ISO/IEC 42001:2023 Clause 9.3

---

## 1. Purpose

This document defines the management review process for the AI Management System (AIMS) at Vorion. It establishes the review cadence, required inputs, expected outputs, documentation requirements, and action tracking procedures to ensure top management oversight of AIMS effectiveness.

This procedure fulfills the requirements of ISO/IEC 42001:2023 Clause 9.3 ("Management review"), which requires that top management review the organization's AIMS at planned intervals to ensure its continuing suitability, adequacy, and effectiveness.

---

## 2. Review Cadence and Scheduling

### 2.1 Standard Review Schedule

| Review Type | Frequency | Typical Duration | Chair |
|---|---|---|---|
| **Quarterly AIMS Management Review** | Every calendar quarter (Q1: March, Q2: June, Q3: September, Q4: December) | 2-3 hours | Executive Sponsor |
| **Annual Comprehensive Review** | Q4 review (December), expanded scope | 4-6 hours | Executive Sponsor |
| **Extraordinary Review** | As triggered by events listed in Section 2.2 | As needed | Executive Sponsor or AIMS Manager |

### 2.2 Extraordinary Review Triggers

An extraordinary management review shall be convened within 10 business days when any of the following events occur:

| Trigger Event | Convened By |
|---|---|
| Safety-critical incident involving AIMS-governed AI systems (circuit breaker activation with customer impact) | AI Safety Officer |
| Significant change in regulatory requirements affecting AI governance (e.g., EU AI Act enforcement milestone) | AIMS Manager |
| Major nonconformity identified during internal or external audit | AIMS Manager |
| Significant change in organizational structure, strategy, or AIMS scope | Executive Sponsor |
| Loss of or threat to ISO 42001 certification | AIMS Manager |
| Customer-reported AI governance failure attributed to Cognigate | AIMS Manager |

### 2.3 Attendees

| Role | Quarterly Review | Annual Review | Extraordinary Review |
|---|---|---|---|
| **Executive Sponsor** | Required (Chair) | Required (Chair) | Required (Chair) |
| **AIMS Manager** | Required (Secretary) | Required (Secretary) | Required (Secretary) |
| **CTO** | Required | Required | As relevant |
| **AI Safety Officer** | Required | Required | Required |
| **Compliance Analyst** | Required | Required | As relevant |
| **Security Engineering Lead** | Invited | Required | As relevant |
| **Platform Engineering Lead** | Invited | Required | As relevant |
| **Operations Lead** | Invited | Required | As relevant |
| **External Advisor** | -- | Invited (optional) | As relevant |

Quorum: Executive Sponsor + AIMS Manager + at least two other Required attendees.

---

## 3. Review Inputs (Clause 9.3.2)

### 3.1 Required Inputs

The AIMS Manager shall prepare and distribute the following input materials at least 5 business days before each management review.

#### 3.1.1 Status of Previous Review Actions

| Input Item | Source | Prepared By |
|---|---|---|
| Action item tracker with status updates (open, in progress, completed, overdue) | Management review action register | AIMS Manager |
| Evidence of completion for closed actions | Relevant action owners | AIMS Manager (consolidated) |
| Root cause analysis for overdue actions | Action owners | AIMS Manager |

#### 3.1.2 Changes in External and Internal Issues

| Input Item | Source | Prepared By |
|---|---|---|
| Regulatory landscape update (new regulations, enforcement actions, guidance documents) | Regulatory monitoring | Compliance Analyst |
| Industry incident summary (AI governance failures in the market) | Industry monitoring | AI Safety Officer |
| Technology landscape changes (new AI capabilities, threat vectors, tools) | Technical monitoring | CTO |
| Organizational changes (headcount, structure, strategy, partnerships) | Executive updates | Executive Sponsor |
| Customer and market feedback relevant to AI governance | Customer communications | AIMS Manager |

#### 3.1.3 AIMS Performance Metrics

| Input Item | Source | Prepared By |
|---|---|---|
| **Enforcement Decision Metrics** | Cognigate PROOF ledger | AIMS Manager |
| - Total decisions (allow/deny/escalate/modify) | | |
| - Denial rate and trend | | |
| - Escalation rate and trend | | |
| - Average decision latency | | |
| **Trust Engine Metrics** | Cognigate trust engine | AI Safety Officer |
| - Entity trust score distribution by tier (T0-T7) | | |
| - Trust promotion and demotion counts | | |
| - Trust anomaly detections | | |
| **Safety Control Metrics** | Cognigate safety systems | AI Safety Officer |
| - Circuit breaker activations (count, duration, cause) | | |
| - Tripwire triggers (count, pattern type, disposition) | | |
| - Velocity limit violations (count, entity, resolution) | | |
| - Critic module verdict distribution (approve/flag/reject) | | |
| **Compliance Metrics** | Evidence mapper / compliance API | Compliance Analyst |
| - Compliance snapshot per framework (ISO 42001, NIST 800-53, EU AI Act, SOC 2, NIST AI RMF, CMMC, GDPR) | | |
| - Control health status changes | | |
| - Evidence generation rate and completeness | | |
| - Proof chain integrity verification status | | |
| **Operational Metrics** | Platform monitoring | Operations |
| - Platform availability (uptime percentage) | | |
| - API error rates | | |
| - Deployment frequency and success rate | | |

#### 3.1.4 Audit Results

| Input Item | Source | Prepared By |
|---|---|---|
| Internal audit findings (open, closed, in progress) | Internal audit reports | Compliance Analyst |
| External audit findings (if any) | External audit reports | Compliance Analyst |
| Nonconformity register status | Nonconformity tracker | AIMS Manager |
| Corrective action effectiveness reviews | Corrective action records | AIMS Manager |

#### 3.1.5 Risk Assessment Changes

| Input Item | Source | Prepared By |
|---|---|---|
| Risk register updates (new risks, changed risk levels, retired risks) | Risk register | AI Safety Officer |
| AI impact assessment updates | Impact assessment records | AI Safety Officer |
| Residual risk status | Risk treatment records | AI Safety Officer |
| Emerging risk identification | Industry and technology monitoring | AI Safety Officer |

#### 3.1.6 Improvement Opportunities

| Input Item | Source | Prepared By |
|---|---|---|
| Improvement suggestions from personnel | Suggestion tracking | AIMS Manager |
| Lessons learned from incidents and near-misses | Incident register | AI Safety Officer |
| Industry best practice developments | Research and conferences | CTO / AI Safety Officer |
| Customer feature requests related to governance | Customer communications | AIMS Manager |
| Technology improvements available | Engineering assessments | CTO |

#### 3.1.7 Change Management Summary (Quarterly)

| Input Item | Source | Prepared By |
|---|---|---|
| Change register summary (count by classification, sub-category) | Change register | AIMS Manager |
| Significant changes implemented | Change records | AIMS Manager |
| Emergency changes and retrospective outcomes | Change records | AI Safety Officer |
| Changes requiring rollback and root cause | Change records | CTO |

#### 3.1.8 Competency and Training Summary (Quarterly)

| Input Item | Source | Prepared By |
|---|---|---|
| Training completion rates by module and role | Training records | AIMS Manager |
| Competency gap status | Competency records | AIMS Manager |
| External certification progress | HR records | AIMS Manager |
| Awareness program effectiveness indicators | Assessment records | AIMS Manager |

### 3.2 Annual Review Additional Inputs

The Annual Comprehensive Review (Q4) shall include all quarterly inputs plus:

| Additional Input | Source | Prepared By |
|---|---|---|
| Year-in-review AIMS effectiveness summary | All quarterly reviews | AIMS Manager |
| AIMS scope adequacy assessment | Scope statement review | AIMS Manager |
| AI Policy relevance assessment | Policy review | AIMS Manager |
| RACI matrix adequacy assessment | Operational feedback | AIMS Manager |
| Budget and resource utilization for AIMS | Financial records | Executive Sponsor |
| Benchmarking against industry peers (where available) | Market research | AIMS Manager |
| Pre-certification or surveillance audit readiness assessment | Compliance review | Compliance Analyst |

---

## 4. Review Agenda

### 4.1 Standard Quarterly Review Agenda

| Item | Duration | Presenter | Content |
|---|---|---|---|
| 1. Opening and quorum confirmation | 5 min | Chair (ES) | Confirm attendance and quorum |
| 2. Previous review actions | 15 min | AM | Status of all open actions; overdue item escalation |
| 3. External and internal context changes | 15 min | CA / AM | Regulatory updates; market changes; organizational changes |
| 4. AIMS performance metrics | 30 min | AM / ASO / CA | Enforcement metrics; trust metrics; safety metrics; compliance metrics |
| 5. Audit and nonconformity status | 15 min | CA | Audit findings; nonconformity register; corrective actions |
| 6. Risk assessment changes | 15 min | ASO | Risk register updates; emerging risks; residual risk status |
| 7. Change management summary | 10 min | AM | Change volume and outcomes; significant changes; emergency changes |
| 8. Competency and training update | 10 min | AM | Training completion; competency gaps; certification progress |
| 9. Improvement opportunities | 10 min | All | Suggestions; lessons learned; technology developments |
| 10. Decisions and action items | 15 min | Chair (ES) | Decisions recorded; new actions assigned; resource requests |
| 11. Close | 5 min | Chair (ES) | Confirm next review date; distribute minutes responsibility |

---

## 5. Review Outputs (Clause 9.3.3)

### 5.1 Required Output Decisions

Each management review shall produce documented decisions on the following:

| Output Area | Decision Types | Documented In |
|---|---|---|
| **Continual Improvement** | Specific improvement initiatives approved; improvement priorities for next quarter; process changes approved | Minutes Section: Improvement Decisions |
| **AIMS Changes** | Scope changes; policy updates; procedure modifications; control additions or removals | Minutes Section: AIMS Modification Decisions |
| **Resource Allocation** | Budget approvals; headcount decisions; tool/platform investments; training budget | Minutes Section: Resource Decisions |
| **Risk Treatment** | Acceptance of residual risks; new treatment actions; risk appetite adjustments | Minutes Section: Risk Decisions |
| **Objective Adjustments** | KPI target changes; new objectives; retired objectives | Minutes Section: Objective Decisions |
| **Action Items** | Specific actions with owner, due date, and expected outcome | Action Register (appended) |

### 5.2 Decision Authority

| Decision Type | Authority | Escalation |
|---|---|---|
| Resource allocation within approved budget | Executive Sponsor (final) | N/A |
| Resource allocation exceeding budget | Executive Sponsor recommends | Board/ownership approval required |
| AIMS scope changes | Executive Sponsor (final) | N/A |
| AI Policy changes | Executive Sponsor (final) | N/A |
| Risk appetite changes | Executive Sponsor (final) | N/A |
| Technical architecture decisions | CTO recommendation | Executive Sponsor approval |
| Certification timeline adjustments | AIMS Manager recommendation | Executive Sponsor approval |

---

## 6. Management Review Minutes Template

### 6.1 Template

```
==============================================================================
VORION RISK, LLC
AIMS MANAGEMENT REVIEW MINUTES
==============================================================================

Document ID:    VOR-AIMS-MRV-MIN-[YYYY]-Q[N]
Review Type:    [Quarterly / Annual Comprehensive / Extraordinary]
Date:           [YYYY-MM-DD]
Time:           [HH:MM] - [HH:MM] [Timezone]
Location:       [Physical location or virtual platform]
Chair:          [Name, Title]
Secretary:      [Name, Title]

------------------------------------------------------------------------------
ATTENDEES
------------------------------------------------------------------------------

| Name | Role | Present/Absent |
|------|------|----------------|
|      |      |                |

Quorum: [Met / Not Met]

------------------------------------------------------------------------------
1. PREVIOUS ACTION ITEMS
------------------------------------------------------------------------------

| Action ID | Description | Owner | Due Date | Status | Notes |
|-----------|-------------|-------|----------|--------|-------|
|           |             |       |          |        |       |

Overdue Actions Escalation:
[Description of any overdue actions and escalation decisions]

------------------------------------------------------------------------------
2. CONTEXT CHANGES
------------------------------------------------------------------------------

External Changes:
- [Change description and AIMS impact assessment]

Internal Changes:
- [Change description and AIMS impact assessment]

Decisions:
- [Any decisions required due to context changes]

------------------------------------------------------------------------------
3. AIMS PERFORMANCE METRICS REVIEW
------------------------------------------------------------------------------

Enforcement Decisions (Period: [date range]):
- Total decisions:          [number]
- Allow:                    [number] ([percentage])
- Deny:                     [number] ([percentage])
- Escalate:                 [number] ([percentage])
- Modify:                   [number] ([percentage])
- Average latency:          [ms]
- Trend vs. previous period: [improving / stable / degrading]

Trust Engine:
- Entities by tier: T0:[n] T1:[n] T2:[n] T3:[n] T4:[n] T5:[n] T6:[n] T7:[n]
- Promotions:       [number]
- Demotions:        [number]
- Anomalies:        [number]

Safety Controls:
- Circuit breaker activations:  [number]
- Tripwire triggers:            [number]
- Velocity violations:          [number]
- Critic rejections:            [number]

Compliance Posture:
- ISO 42001:   [percentage] compliant ([number] controls)
- NIST 800-53: [percentage] compliant ([number] controls)
- EU AI Act:   [percentage] compliant ([number] controls)
- SOC 2:       [percentage] compliant ([number] controls)
- Proof chain integrity: [valid / issues detected]

Assessment: [Management assessment of overall performance]

------------------------------------------------------------------------------
4. AUDIT AND NONCONFORMITY STATUS
------------------------------------------------------------------------------

Internal Audit:
- Last audit date:       [date]
- Findings open:         [number]
- Findings closed:       [number]
- Major nonconformities: [number]
- Minor nonconformities: [number]

External Audit:
- Status: [scheduled / completed / N/A]
- Findings: [summary]

Corrective Actions:
- Open:      [number]
- Overdue:   [number]
- Closed this period: [number]
- Effectiveness verified: [number]

------------------------------------------------------------------------------
5. RISK ASSESSMENT CHANGES
------------------------------------------------------------------------------

New Risks Identified:
- [Risk ID] [Description] [Rating] [Treatment plan]

Risk Level Changes:
- [Risk ID] [Previous rating] -> [New rating] [Rationale]

Emerging Risks:
- [Description and preliminary assessment]

------------------------------------------------------------------------------
6. CHANGE MANAGEMENT SUMMARY
------------------------------------------------------------------------------

Changes This Period:
- Routine:     [number]
- Significant: [number]
- Emergency:   [number]
- Rollbacks:   [number]

Significant Changes:
- [CHG-YYYY-NNN] [Description] [Outcome]

------------------------------------------------------------------------------
7. COMPETENCY AND TRAINING
------------------------------------------------------------------------------

Training Completion:
- Foundational modules: [percentage] complete
- Technical modules:    [percentage] complete
- Advanced modules:     [percentage] complete

Competency Gaps: [number] open ([number] on track, [number] overdue)
Certifications:  [status summary]

------------------------------------------------------------------------------
8. IMPROVEMENT OPPORTUNITIES
------------------------------------------------------------------------------

Opportunities Discussed:
- [Description and preliminary assessment]

Approved for Implementation:
- [Description, owner, timeline]

Deferred:
- [Description, rationale for deferral]

------------------------------------------------------------------------------
DECISIONS
------------------------------------------------------------------------------

Improvement Decisions:
- [DEC-YYYY-Q[N]-01] [Decision description]

AIMS Modification Decisions:
- [DEC-YYYY-Q[N]-02] [Decision description]

Resource Decisions:
- [DEC-YYYY-Q[N]-03] [Decision description]

Risk Decisions:
- [DEC-YYYY-Q[N]-04] [Decision description]

Objective Decisions:
- [DEC-YYYY-Q[N]-05] [Decision description]

------------------------------------------------------------------------------
NEW ACTION ITEMS
------------------------------------------------------------------------------

| Action ID | Description | Owner | Due Date | Priority |
|-----------|-------------|-------|----------|----------|
| ACT-YYYY-Q[N]-01 |     |       |          |          |

------------------------------------------------------------------------------
NEXT REVIEW
------------------------------------------------------------------------------

Date: [YYYY-MM-DD]
Type: [Quarterly / Annual Comprehensive]
Special Focus Areas: [Any topics requiring deep-dive at next review]

------------------------------------------------------------------------------
APPROVAL
------------------------------------------------------------------------------

Minutes prepared by:  [Name]                Date: [YYYY-MM-DD]
Minutes approved by:  [Chair Name]          Date: [YYYY-MM-DD]

==============================================================================
```

---

## 7. Action Item Tracking

### 7.1 Action Register

All action items from management reviews shall be tracked in a central action register with the following fields:

| Field | Description |
|---|---|
| **Action ID** | Unique identifier (format: `ACT-YYYY-Q[N]-NN`) |
| **Source** | Management review reference (e.g., `VOR-AIMS-MRV-MIN-2026-Q1`) |
| **Description** | Clear description of the required action |
| **Owner** | Individual responsible for completion |
| **Due Date** | Target completion date |
| **Priority** | High / Medium / Low |
| **Status** | Open / In Progress / Completed / Overdue / Cancelled |
| **Completion Date** | Actual completion date |
| **Evidence** | Reference to evidence of completion |
| **Verification** | How completion was verified |
| **Notes** | Additional context or updates |

### 7.2 Action Item Governance

| Rule | Detail |
|---|---|
| **Assignment** | Every action must have exactly one owner. The owner may delegate tasks but retains accountability. |
| **Due Dates** | All actions must have a due date. Default: before the next quarterly review. |
| **Status Updates** | Owners must provide status updates at least monthly (or more frequently if requested). |
| **Overdue Escalation** | Actions overdue by more than 30 days are escalated to the Executive Sponsor at the next review. |
| **Cancellation** | Actions may only be cancelled with Executive Sponsor approval, with documented justification. |
| **Completion Evidence** | Each completed action must reference verifiable evidence (document, record, system configuration, etc.). |

### 7.3 Inter-Review Monitoring

The AIMS Manager shall:

- Review the action register monthly between quarterly reviews
- Issue status reminders to action owners 30 days before due dates
- Escalate at-risk actions (likely to miss due date) to the appropriate management level
- Prepare the action status summary as a required input for each management review

---

## 8. Records Retention

| Record | Retention Period | Storage |
|---|---|---|
| Management review minutes | 7 years from review date | Secure document repository |
| Action register (all entries) | 7 years from action closure | Secure document repository |
| Input materials (metric reports, audit summaries) | 7 years from review date | Secure document repository |
| Decision records | 7 years from decision date | Secure document repository |
| Attendance records | 7 years from review date | Secure document repository |

All management review records are documented information subject to the controls defined in ISO 42001 Clause 7.5.

---

## 9. Effectiveness of the Review Process

### 9.1 Self-Assessment

Annually (at the Annual Comprehensive Review), the management review process itself shall be assessed for effectiveness:

| Assessment Criteria | Indicator |
|---|---|
| Are review inputs comprehensive and timely? | Input materials distributed on schedule; no critical gaps identified during review |
| Are decisions made and documented? | Every review produces documented decisions in all required output areas |
| Are actions completed on time? | Greater than 80% of actions completed by due date |
| Are improvements resulting from reviews? | At least one measurable AIMS improvement per quarter attributable to review decisions |
| Is attendance consistent? | Quorum met at every review; no more than one absence per attendee per year |
| Are reviews efficient? | Reviews completed within scheduled time; no recurring carryover of agenda items |

### 9.2 Process Improvement

If the self-assessment identifies deficiencies in the review process:

1. The AIMS Manager shall propose process improvements
2. The Executive Sponsor shall approve changes
3. This procedure shall be updated accordingly (via VOR-AIMS-CHG-001)
4. Changes shall be communicated to all regular attendees

---

## 10. Document Control

| Version | Date | Author | Change Description |
|---|---|---|---|
| 1.0.0 | 2026-02-20 | AIMS Manager | Initial release -- establishes quarterly management review process for AIMS |

---

**Prepared by:** AIMS Manager, Vorion
**Reviewed by:** [PENDING -- CTO Review]
**Approved by:** [PENDING -- Executive Sponsor Approval]
