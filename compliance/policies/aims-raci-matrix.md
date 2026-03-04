# AIMS RACI Matrix

**Document ID:** VOR-AIMS-RAC-001
**Version:** 1.0.0
**Effective Date:** 2026-02-20
**Classification:** INTERNAL -- CONTROLLED
**Last Updated:** 2026-02-20
**Owner:** AIMS Manager, Vorion
**Approved By:** [PENDING -- Executive Sponsor]
**Review Cadence:** Annual (next review: 2027-02-20)
**Satisfies:** ISO/IEC 42001:2023 Clause 5.3

---

## 1. Purpose

This document defines the Responsible, Accountable, Consulted, and Informed (RACI) assignments for all ISO/IEC 42001:2023 clauses and Annex A controls within the Vorion AI Management System (AIMS).

This matrix fulfills the requirements of ISO/IEC 42001:2023 Clause 5.3 ("Organizational roles, responsibilities and authorities") and addresses Gap GAP_006 from the ISO 42001 Gap Analysis.

---

## 2. RACI Legend

| Code | Definition |
|---|---|
| **R** -- Responsible | Performs the work. One or more individuals may be Responsible. |
| **A** -- Accountable | Ultimately answerable for the correct completion. Exactly one individual per activity. |
| **C** -- Consulted | Provides input before or during the work. Two-way communication. |
| **I** -- Informed | Notified of outcomes after the work is complete. One-way communication. |

---

## 3. AIMS Role Definitions

### 3.1 Key Roles

| Role | Abbreviation | Current Assignment | Description |
|---|---|---|---|
| **Executive Sponsor** | ES | CEO / Managing Member | Top management representative with authority over AIMS resources and policy approval |
| **AIMS Manager** | AM | AI Governance Lead | Day-to-day management of the AIMS; primary point of contact for certification activities |
| **Chief Technology Officer** | CTO | CTO | Technical authority over platform architecture, development practices, and deployment decisions |
| **AI Safety Officer** | ASO | Security Engineering Lead | Responsible for AI safety controls, Critic module oversight, incident response, and adversarial testing |
| **Security Engineering** | SE | Security Engineering Team | Implementation and operation of security controls, tripwires, circuit breakers, and access management |
| **Platform Engineering** | PE | Engineering Team | Development, testing, and deployment of Cognigate components; change implementation |
| **Compliance Analyst** | CA | Compliance Function | Evidence collection, audit preparation, framework mapping, and regulatory monitoring |
| **Operations** | OPS | Operations Function | Platform monitoring, incident triage, availability management, and operational support |
| **All Personnel** | ALL | All staff in scope | All individuals within the AIMS organizational boundary |

### 3.2 Escalation Path

```
ALL PERSONNEL --> AIMS Manager --> AI Safety Officer / CTO --> Executive Sponsor
                         |                    |
                         v                    v
                  Compliance Analyst    Security Engineering
```

For safety-critical incidents (circuit breaker activation, critical trust violations), the AI Safety Officer has direct escalation authority to the Executive Sponsor.

---

## 4. RACI Matrix -- ISO 42001 Main Clauses

### 4.1 Clause 4: Context of the Organization

| Activity | ES | AM | CTO | ASO | SE | PE | CA | OPS |
|---|---|---|---|---|---|---|---|---|
| **4.1** Determine external and internal issues | C | R/A | C | C | I | I | R | I |
| **4.2** Identify interested parties and their requirements | C | R/A | C | C | I | I | R | I |
| **4.3** Define and document AIMS scope | A | R | C | C | I | I | C | I |
| **4.4** Establish, implement, maintain, and improve the AIMS | A | R | C | C | R | R | C | R |

### 4.2 Clause 5: Leadership

| Activity | ES | AM | CTO | ASO | SE | PE | CA | OPS |
|---|---|---|---|---|---|---|---|---|
| **5.1.1** Ensure AIMS achieves intended outcomes | A | R | C | C | I | I | R | I |
| **5.1.2** Ensure AIMS integration into business processes | A | R | R | C | C | C | I | C |
| **5.1.3** Ensure resources are available for AIMS | A | R | C | I | I | I | I | I |
| **5.1.4** Communicate importance of effective AI management | A | R | C | C | I | I | I | I |
| **5.1.5** Ensure AIMS achieves intended outcomes | A | R | C | C | I | I | R | I |
| **5.1.6** Direct and support persons contributing to AIMS | A | R | C | C | I | I | I | I |
| **5.1.7** Promote continual improvement | A | R | C | C | I | I | C | I |
| **5.2** Establish, approve, and communicate AI Policy | A | R | C | C | I | I | C | I |
| **5.3** Assign and communicate AIMS roles and responsibilities | A | R | C | C | I | I | I | I |

### 4.3 Clause 6: Planning

| Activity | ES | AM | CTO | ASO | SE | PE | CA | OPS |
|---|---|---|---|---|---|---|---|---|
| **6.1.1** Determine risks and opportunities | C | A | C | R | R | C | R | C |
| **6.1.2** Conduct AI risk assessment | I | A | C | R | R | C | R | I |
| **6.1.3** Conduct AI risk treatment | I | A | R | R | R | C | C | I |
| **6.1.4** Conduct AI system impact assessment | C | A | C | R | R | C | R | I |
| **6.2** Establish AI objectives and plans to achieve them | A | R | C | C | I | I | C | I |

### 4.4 Clause 7: Support

| Activity | ES | AM | CTO | ASO | SE | PE | CA | OPS |
|---|---|---|---|---|---|---|---|---|
| **7.1** Determine and provide resources | A | R | C | C | I | I | I | I |
| **7.2** Determine competence requirements; ensure competence | C | A | C | C | I | I | R | I |
| **7.3** Ensure personnel awareness of AI policy and contributions | I | A | C | C | I | I | R | I |
| **7.4.1** Determine internal communication requirements | I | A | C | C | I | I | R | R |
| **7.4.2** Determine external communication requirements | A | R | C | C | I | I | C | I |
| **7.5** Create, update, and control documented information | I | A | C | C | R | R | R | I |

### 4.5 Clause 8: Operation

| Activity | ES | AM | CTO | ASO | SE | PE | CA | OPS |
|---|---|---|---|---|---|---|---|---|
| **8.1.1** Plan, implement, and control operational processes | I | A | R | C | R | R | I | R |
| **8.1.2** Implement planned risk treatment actions | I | A | C | R | R | R | I | C |
| **8.1.3** Control planned and unplanned changes | I | A | R | C | R | R | I | R |
| **8.1.4** Control outsourced processes | I | A | C | C | C | C | R | I |
| **8.2** Carry out AI risk assessments at planned intervals | I | A | C | R | R | C | R | I |
| **8.3** Implement AI risk treatment plan | I | A | C | R | R | R | I | C |
| **8.4** Carry out AI system impact assessments | I | A | C | R | C | C | R | I |

### 4.6 Clause 9: Performance Evaluation

| Activity | ES | AM | CTO | ASO | SE | PE | CA | OPS |
|---|---|---|---|---|---|---|---|---|
| **9.1** Monitor, measure, analyze, and evaluate AIMS performance | I | A | C | C | R | R | R | R |
| **9.2** Plan and conduct internal audits | I | A | I | C | I | I | R | I |
| **9.3** Conduct management reviews | A | R | C | C | I | I | R | I |

### 4.7 Clause 10: Improvement

| Activity | ES | AM | CTO | ASO | SE | PE | CA | OPS |
|---|---|---|---|---|---|---|---|---|
| **10.1** Continually improve AIMS suitability, adequacy, effectiveness | A | R | C | C | R | R | C | R |
| **10.2.1** React to nonconformities; take corrective action | I | A | C | R | R | R | C | R |
| **10.2.5** Make necessary changes to the AIMS | A | R | C | C | R | R | C | I |

---

## 5. RACI Matrix -- Annex A Controls

### 5.1 A.2 Policies for AI

| Control | ES | AM | CTO | ASO | SE | PE | CA | OPS |
|---|---|---|---|---|---|---|---|---|
| **A.2.2** Establish and maintain AI policy | A | R | C | C | I | I | C | I |
| **A.2.3** Define roles and responsibilities for AI | A | R | C | C | I | I | I | I |
| **A.2.4** Establish internal organization for AI | A | R | C | C | I | I | I | I |

### 5.2 A.3 Internal Organization

| Control | ES | AM | CTO | ASO | SE | PE | CA | OPS |
|---|---|---|---|---|---|---|---|---|
| **A.3.2** Provide resources for AI systems | A | R | C | I | I | I | I | I |
| **A.3.3** Allocate responsibilities for AI systems | A | R | C | C | I | I | I | I |
| **A.3.4** Ensure segregation of duties | I | A | R | C | R | R | C | I |

### 5.3 A.4 Resources for AI Systems

| Control | ES | AM | CTO | ASO | SE | PE | CA | OPS |
|---|---|---|---|---|---|---|---|---|
| **A.4.2** Develop competence for AI activities | I | A | C | C | I | I | R | I |
| **A.4.3** Establish awareness program for AI | I | A | C | C | I | I | R | I |
| **A.4.4** Define communication processes for AI | I | A | C | C | I | I | R | R |

### 5.4 A.5 AI System Lifecycle

| Control | ES | AM | CTO | ASO | SE | PE | CA | OPS |
|---|---|---|---|---|---|---|---|---|
| **A.5.2** Plan AI system lifecycle activities | I | C | A | C | C | R | I | I |
| **A.5.3** Design and develop AI systems responsibly | I | C | A | C | R | R | I | I |
| **A.5.4** Verify and validate AI systems | I | C | A | R | R | R | I | I |
| **A.5.5** Deploy AI systems with governance controls | I | C | A | C | R | R | I | R |
| **A.5.6** Operate and monitor AI systems | I | C | C | R | R | C | I | A |
| **A.5.7** Retire AI systems responsibly | I | A | C | C | R | R | C | R |

### 5.5 A.6 Data for AI Systems

| Control | ES | AM | CTO | ASO | SE | PE | CA | OPS |
|---|---|---|---|---|---|---|---|---|
| **A.6.2** Ensure data quality for AI systems | I | C | A | C | R | R | I | I |
| **A.6.3** Maintain data provenance records | I | C | C | C | R | R | I | A |
| **A.6.4** Manage data preparation processes | I | C | A | C | R | R | I | I |
| **A.6.5** Ensure appropriate data labeling | I | C | A | C | R | R | I | I |

### 5.6 A.7 AI System Information

| Control | ES | AM | CTO | ASO | SE | PE | CA | OPS |
|---|---|---|---|---|---|---|---|---|
| **A.7.2** Maintain AI system documentation | I | A | C | C | R | R | R | I |
| **A.7.3** Maintain records of AI model information | I | C | A | C | R | R | C | I |
| **A.7.4** Maintain comprehensive logging | I | C | C | R | R | R | I | A |

### 5.7 A.8 Using or Providing AI System

| Control | ES | AM | CTO | ASO | SE | PE | CA | OPS |
|---|---|---|---|---|---|---|---|---|
| **A.8.2** Ensure responsible use of AI systems | I | A | C | R | R | R | C | R |
| **A.8.3** Address impacts of AI systems on individuals and groups | C | A | C | R | C | C | R | I |
| **A.8.4** Ensure human oversight of AI systems | C | A | C | R | R | R | I | R |
| **A.8.5** Limit AI system use to intended purposes | I | A | C | R | R | R | C | R |

### 5.8 A.9 Third-party and Customer Relations

| Control | ES | AM | CTO | ASO | SE | PE | CA | OPS |
|---|---|---|---|---|---|---|---|---|
| **A.9.2** Manage third-party AI system risks | I | A | C | R | C | C | R | I |
| **A.9.3** Address customer needs related to AI | C | A | C | C | I | I | R | I |
| **A.9.4** Notify relevant parties of AI incidents | A | R | C | R | R | I | C | R |

### 5.9 A.10 AI System Security

| Control | ES | AM | CTO | ASO | SE | PE | CA | OPS |
|---|---|---|---|---|---|---|---|---|
| **A.10.2** Secure AI systems against threats | I | C | C | A | R | R | I | R |
| **A.10.3** Protect AI model integrity and confidentiality | I | C | C | A | R | R | I | R |
| **A.10.4** Protect data used by AI systems | I | C | C | A | R | R | C | R |
| **A.10.5** Ensure secure development of AI systems | I | C | A | C | R | R | I | I |

---

## 6. Cognigate-Specific Operational RACI

The following RACI assignments apply to key operational activities specific to the Vorion Cognigate platform.

| Operational Activity | AM | CTO | ASO | SE | PE | CA | OPS |
|---|---|---|---|---|---|---|---|
| Trust tier threshold calibration (T0-T7) | C | A | R | R | C | I | I |
| BASIS policy rule authoring and updates | C | A | C | R | R | I | I |
| Critic module prompt and provider configuration | C | C | A | R | C | I | I |
| Circuit breaker threshold configuration | C | C | A | R | C | I | R |
| Tripwire pattern definition and updates | C | C | A | R | C | I | I |
| Velocity limit configuration | C | C | R | R | C | I | A |
| PROOF chain integrity monitoring | C | I | R | R | C | C | A |
| Evidence mapper framework rule updates | A | C | C | C | R | R | I |
| Compliance snapshot review and reporting | A | I | C | I | I | R | I |
| Emergency entity trust override | I | C | A | R | I | I | R |
| Production deployment approval | I | A | C | C | R | I | I |

---

## 7. Communication of Roles

### 7.1 Initial Communication

Upon approval of this RACI matrix, the AIMS Manager shall:

1. Distribute this document to all personnel identified in the matrix
2. Conduct a briefing session explaining role assignments and expectations
3. Obtain written acknowledgment from each role holder
4. Record acknowledgments as documented information per Clause 7.5

### 7.2 Ongoing Communication

Role assignments shall be communicated:

- During onboarding of new personnel assigned to AIMS roles
- When role assignments change (personnel change, organizational restructuring)
- At least annually during the management review cycle
- Following any significant update to this RACI matrix

---

## 8. Review and Maintenance

This RACI matrix shall be reviewed:

- **Annually** as part of the management review process (Clause 9.3)
- **Upon organizational change** (new hires, departures, restructuring)
- **Upon AIMS scope change** (new AI systems, new controls, new regulatory requirements)

Changes require approval from the AIMS Manager and Executive Sponsor.

---

## 9. Document Control

| Version | Date | Author | Change Description |
|---|---|---|---|
| 1.0.0 | 2026-02-20 | AIMS Manager | Initial release -- addresses Gap GAP_006 from ISO 42001 Gap Analysis |

---

**Prepared by:** AIMS Manager, Vorion
**Reviewed by:** [PENDING -- CTO Review]
**Approved by:** [PENDING -- Executive Sponsor Approval]
