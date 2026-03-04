# AIMS Change Management Procedure

**Document ID:** VOR-AIMS-CHG-001
**Version:** 1.0.0
**Effective Date:** 2026-02-20
**Classification:** INTERNAL -- CONTROLLED
**Last Updated:** 2026-02-20
**Owner:** AIMS Manager, Vorion
**Approved By:** [PENDING -- Executive Sponsor]
**Review Cadence:** Annual (next review: 2027-02-20)
**Satisfies:** ISO/IEC 42001:2023 Clause 8.1, Clause 10.2.5

---

## 1. Purpose

This procedure defines the process for managing changes to the AI Management System (AIMS) and the AI systems within its scope at Vorion. It ensures that changes are assessed for risk, approved by appropriate authorities, implemented in a controlled manner, and recorded in the audit trail.

This procedure fulfills the requirements of ISO/IEC 42001:2023 Clause 8.1 ("Operational planning and control") and Clause 10.2.5 ("Make changes to AIMS if necessary"), and addresses Gap GAP_008 from the ISO 42001 Gap Analysis.

---

## 2. Scope

This procedure applies to all changes affecting:

- The AIMS itself (policies, procedures, scope, objectives, roles)
- AI systems within AIMS scope (Cognigate engine and all components listed in VOR-AIMS-SCP-001)
- BASIS policy rules and constraint definitions
- Trust tier thresholds and scoring parameters (T0-T7)
- Critic module configuration (prompts, provider selection, thresholds)
- Security controls (tripwires, circuit breakers, velocity limits)
- Infrastructure and deployment configuration (Vercel, Neon PostgreSQL)
- Evidence generation rules and framework mappings

This procedure does **not** apply to:

- Customer-side changes to AI systems governed by Cognigate (customer responsibility)
- Routine operational activities that do not alter system behavior (log review, report generation, monitoring)
- Bug fixes that restore documented intended behavior without altering specifications (these follow the expedited path in Section 5.2)

---

## 3. Change Classification

### 3.1 Classification Categories

All proposed changes must be classified into one of three categories before proceeding. Classification determines the approval path, required assessments, and documentation level.

| Category | Definition | Examples | Approval Authority |
|---|---|---|---|
| **Routine** | Low-risk changes within established patterns that do not alter AI system behavior or AIMS controls | Dependency version updates (non-breaking); documentation corrections; UI adjustments to dashboards; log format changes | Platform Engineering Lead |
| **Significant** | Changes that alter AI system behavior, trust boundaries, policy enforcement, or AIMS controls | New BASIS policy rules; trust tier threshold changes; Critic prompt modifications; new tripwire patterns; AIMS procedure updates; scope changes; new AI component introduction | CTO or AI Safety Officer (per RACI matrix) |
| **Emergency** | Changes required to address an active security incident, safety hazard, or critical system failure where delay would cause unacceptable harm | Circuit breaker activation/deactivation; emergency trust level override; critical vulnerability patching; safety-critical policy hotfix | AI Safety Officer (with post-hoc Executive Sponsor notification within 24 hours) |

### 3.2 AI-Specific Change Sub-Categories

Within the Significant category, the following AI-specific sub-categories require specialized assessment:

| Sub-Category | Description | Additional Assessment Required |
|---|---|---|
| **Model Update** | Changes to the AI models used by the Critic module (provider change, model version update, prompt modification) | Adversarial evaluation re-validation; false positive/negative rate assessment |
| **Trust Boundary Change** | Modifications to trust tier score ranges, capability boundaries, or promotion/demotion logic | Trust impact analysis across all active entities; regression testing of enforcement decisions |
| **Policy Rule Change** | Addition, modification, or removal of BASIS policy rules or constraint definitions | Policy conflict analysis; enforcement coverage gap analysis; regression testing |
| **Threshold Modification** | Changes to risk score thresholds, velocity limits, circuit breaker triggers, or tripwire sensitivity | Sensitivity analysis; false positive rate assessment; production traffic simulation |
| **Evidence Mapping Change** | Modifications to the evidence mapper rules that affect which proof events satisfy which compliance controls | Compliance coverage impact analysis; framework gap assessment |
| **Data Schema Change** | Modifications to proof record structure, evidence record format, or trust state schema | Data migration plan; chain integrity verification; backward compatibility assessment |

---

## 4. Change Request Process

### 4.1 Change Request Form

All Significant and Emergency changes must be documented using the following information structure. Routine changes require only items marked with an asterisk (*).

| Field | Description |
|---|---|
| **Change ID*** | Auto-generated identifier (format: `CHG-YYYY-NNN`) |
| **Requestor*** | Name and role of person requesting the change |
| **Date Submitted*** | Date of change request |
| **Classification*** | Routine / Significant / Emergency |
| **AI Sub-Category** | Model Update / Trust Boundary / Policy Rule / Threshold / Evidence Mapping / Data Schema / N/A |
| **Description*** | Clear description of the proposed change |
| **Justification*** | Business or technical rationale for the change |
| **Affected Components*** | List of Cognigate components, AIMS documents, or controls affected |
| **Risk Assessment** | AI-specific impact assessment (see Section 5) |
| **Rollback Plan*** | Procedure to reverse the change if it produces unacceptable outcomes |
| **Testing Plan** | Tests to validate the change before and after deployment |
| **Implementation Plan** | Step-by-step implementation procedure |
| **Approval** | Approval authority signature and date |

### 4.2 Change Request Workflow

```
                    +-------------------+
                    |  Change Proposed  |
                    +--------+----------+
                             |
                    +--------v----------+
                    |    Classify        |
                    | (Routine/Signif/   |
                    |  Emergency)        |
                    +--------+----------+
                             |
              +--------------+--------------+
              |              |              |
     +--------v---+  +------v------+  +----v--------+
     |  Routine   |  | Significant |  |  Emergency  |
     +--------+---+  +------+------+  +----+--------+
              |              |              |
              |     +--------v----------+   |
              |     | AI Impact         |   |
              |     | Assessment        |   |
              |     | (Section 5)       |   |
              |     +--------+----------+   |
              |              |              |
     +--------v---+  +------v------+  +----v--------+
     | PE Lead    |  | CTO / ASO   |  | ASO         |
     | Approval   |  | Approval    |  | Approval    |
     +--------+---+  +------+------+  | (immediate) |
              |              |         +----+--------+
              |              |              |
              +-------+------+------+-------+
                      |             |
             +--------v----------+  |
             |   Implementation  |  |
             |   (Section 6)     |  |
             +--------+----------+  |
                      |             |
             +--------v----------+  |
             |   Verification    |  |
             |   (Section 7)     |  |
             +--------+----------+  |
                      |             |
             +--------v----------+  |
             |   Close & Record  |<-+  (Emergency: post-hoc
             |   (Section 8)     |      documentation within 48h)
             +-------------------+
```

---

## 5. AI Impact Assessment for Changes

### 5.1 Assessment Scope

All Significant changes and all AI-specific sub-category changes require an AI impact assessment before approval. The assessment evaluates the change against the following dimensions:

| Dimension | Assessment Question | Rating Scale |
|---|---|---|
| **Trust Impact** | Could this change affect entity trust scores, tier assignments, or capability boundaries? | None / Low / Medium / High |
| **Safety Impact** | Could this change affect the ability of safety controls (circuit breaker, tripwires) to detect or prevent harmful actions? | None / Low / Medium / High |
| **Enforcement Impact** | Could this change alter the allow/deny/escalate/modify decisions rendered by the ENFORCE layer? | None / Low / Medium / High |
| **Evidence Impact** | Could this change affect the accuracy, completeness, or integrity of compliance evidence? | None / Low / Medium / High |
| **Privacy Impact** | Could this change affect the handling, exposure, or classification of personally identifiable information? | None / Low / Medium / High |
| **Availability Impact** | Could this change affect the availability or latency of the governance pipeline? | None / Low / Medium / High |
| **Reversibility** | Can this change be fully reversed without data loss or evidence chain corruption? | Fully / Partially / Irreversible |

### 5.2 Assessment Outcomes

| Outcome | Criteria | Required Action |
|---|---|---|
| **Proceed** | All dimensions rated None or Low; Fully reversible | Standard implementation with verification |
| **Proceed with Controls** | Any dimension rated Medium; Fully or Partially reversible | Implementation with enhanced monitoring; rollback readiness confirmed; pre/post metrics captured |
| **Enhanced Review** | Any dimension rated High; or Partially/Irreversible | Additional review by AI Safety Officer; staged rollout required; pre-implementation checkpoint with AIMS Manager |
| **Executive Decision** | Multiple dimensions rated High; or Irreversible with Safety or Trust impact | Escalation to Executive Sponsor before proceeding |

### 5.3 Expedited Assessment for Bug Fixes

Bug fixes that restore documented intended behavior (not adding new behavior) follow an expedited assessment:

1. Confirm the fix restores previously documented behavior (reference specific documentation)
2. Confirm no trust boundary, policy rule, or evidence mapping changes
3. Classify as Routine if criteria met; otherwise classify as Significant

---

## 6. Implementation Procedure

### 6.1 Pre-Implementation

| Step | Action | Responsible |
|---|---|---|
| 1 | Verify change request is approved and documented | AIMS Manager |
| 2 | Confirm rollback plan is tested and ready | Platform Engineering |
| 3 | Capture pre-change metrics baseline (trust score distribution, enforcement decision rates, evidence generation rates) | Operations |
| 4 | Notify affected personnel per communication plan | AIMS Manager |
| 5 | For Significant changes: create a proof chain event recording the change initiation | Platform Engineering |

### 6.2 Implementation

| Step | Action | Responsible |
|---|---|---|
| 1 | Implement change in development/staging environment | Platform Engineering |
| 2 | Execute testing plan (unit tests, integration tests, enforcement regression tests) | Platform Engineering |
| 3 | For trust boundary or policy rule changes: execute enforcement simulation against production traffic sample | AI Safety Officer |
| 4 | Deploy to production using established CI/CD pipeline | Platform Engineering |
| 5 | Create proof chain event recording the deployment | Automated (PROOF ledger) |

### 6.3 Emergency Change Implementation

Emergency changes follow an accelerated path:

| Step | Action | Responsible | Timeframe |
|---|---|---|---|
| 1 | AI Safety Officer authorizes emergency change | ASO | Immediate |
| 2 | Implement and deploy with available testing | Platform Engineering | As fast as safely possible |
| 3 | Notify AIMS Manager and Executive Sponsor | ASO | Within 1 hour |
| 4 | Create retrospective change request documentation | ASO | Within 48 hours |
| 5 | Conduct post-implementation review | AIMS Manager | Within 5 business days |

---

## 7. Post-Implementation Verification

### 7.1 Verification Checklist

| Verification Item | Method | Responsible | Timeframe |
|---|---|---|---|
| System health confirmed | Health endpoint check; dashboard review | Operations | Immediate |
| Proof chain integrity verified | `verify_chain_integrity()` execution | Security Engineering | Within 1 hour |
| Enforcement decisions within expected parameters | Compare post-change verdict distribution against baseline | AI Safety Officer | Within 24 hours |
| Trust score distribution stable | Compare post-change trust distribution against baseline | AI Safety Officer | Within 24 hours |
| Evidence generation functioning | Compliance snapshot comparison | Compliance Analyst | Within 24 hours |
| No unintended side effects observed | Monitoring and alerting review | Operations | 72-hour observation period |

### 7.2 Rollback Criteria

A rollback must be initiated if any of the following conditions are observed post-implementation:

| Condition | Rollback Authority |
|---|---|
| Proof chain integrity verification fails | Automatic (system-initiated) |
| Circuit breaker activates due to the change | AI Safety Officer |
| Enforcement error rate exceeds 1% of decisions | AI Safety Officer |
| Trust score anomalies detected (>10% of entities affected unexpectedly) | AI Safety Officer |
| Evidence generation stops or produces incorrect framework mappings | AIMS Manager |
| Production availability degraded beyond SLA thresholds | Operations |

### 7.3 Rollback Procedure

1. Initiate rollback using the pre-approved rollback plan
2. Create proof chain event recording the rollback decision and execution
3. Verify system returns to pre-change baseline
4. Notify all stakeholders of rollback
5. Document root cause and create corrective action plan
6. Re-submit change request with corrective modifications if the change is still needed

---

## 8. Change Records and Documentation

### 8.1 Records Retention

All change records shall be retained as documented information per ISO 42001 Clause 7.5:

| Record | Retention Period | Storage |
|---|---|---|
| Change request form | 7 years from change date | Document management system |
| AI impact assessment | 7 years from change date | Document management system |
| Implementation evidence (proof chain events) | 7 years from collection date | PROOF ledger (immutable) |
| Verification results | 7 years from change date | Document management system |
| Rollback records (if applicable) | 7 years from change date | Document management system |
| Emergency change retrospectives | 7 years from change date | Document management system |

### 8.2 Change Register

The AIMS Manager shall maintain a Change Register summarizing all changes. The register shall include:

- Change ID, date, classification, and sub-category
- Brief description and justification
- AI impact assessment outcome
- Approval authority and date
- Implementation date and status
- Verification outcome
- Rollback status (if applicable)

The Change Register is a required input to the quarterly management review (Clause 9.3).

---

## 9. Integration with AIMS Processes

### 9.1 Risk Assessment Integration

Significant changes that receive a "High" rating on any AI impact dimension shall trigger an update to the AIMS risk assessment (Clause 8.2) to determine if the residual risk profile has changed.

### 9.2 Competency Integration

Changes that introduce new AI components, tools, or methodologies shall trigger a review of the competency matrix (VOR-AIMS-CMP-001) to determine if additional training is required.

### 9.3 Scope Integration

Changes that introduce new AI systems or retire existing ones shall trigger a review of the AIMS scope statement (VOR-AIMS-SCP-001).

### 9.4 Nonconformity Integration

If a change is found to have introduced a nonconformity (Clause 10.2), the corrective action process shall reference the original change record and include the change in the root cause analysis.

---

## 10. Metrics and Reporting

The following change management metrics shall be reported at each quarterly management review:

| Metric | Target | Source |
|---|---|---|
| Total changes processed (by classification) | Reporting only | Change Register |
| Emergency changes as percentage of total | Less than 10% | Change Register |
| Changes requiring rollback | Less than 5% | Change Register |
| Average time from request to implementation (Significant) | Less than 10 business days | Change Register |
| AI impact assessments completed | 100% of Significant changes | Change Register |
| Post-implementation verification completion rate | 100% | Change Register |

---

## 11. Document Control

| Version | Date | Author | Change Description |
|---|---|---|---|
| 1.0.0 | 2026-02-20 | AIMS Manager | Initial release -- addresses Gap GAP_008 from ISO 42001 Gap Analysis |

---

**Prepared by:** AIMS Manager, Vorion
**Reviewed by:** [PENDING -- CTO Review]
**Approved by:** [PENDING -- Executive Sponsor Approval]
