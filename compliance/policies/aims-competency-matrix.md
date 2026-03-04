# AIMS Competency Matrix and Training Program

**Document ID:** VOR-AIMS-CMP-001
**Version:** 1.0.0
**Effective Date:** 2026-02-20
**Classification:** INTERNAL -- CONTROLLED
**Last Updated:** 2026-02-20
**Owner:** AIMS Manager, Vorion
**Approved By:** [PENDING -- Executive Sponsor]
**Review Cadence:** Annual (next review: 2027-02-20)
**Satisfies:** ISO/IEC 42001:2023 Clause 7.2, Clause 7.3, Annex A.4.2, Annex A.4.3

---

## 1. Purpose

This document defines the competency requirements, training curriculum, assessment criteria, and records management for all personnel whose work affects the AI Management System (AIMS) at Vorion.

This document fulfills the requirements of:

- **Clause 7.2** (Competence): Determining necessary competence, ensuring persons are competent, taking actions to acquire competence, and retaining evidence
- **Clause 7.3** (Awareness): Ensuring personnel are aware of the AI policy, their contribution, and implications of nonconformity
- **Annex A.4.2** (Competence development for AI)
- **Annex A.4.3** (Awareness for AI)

It addresses Gap GAP_003 from the ISO 42001 Gap Analysis, which was identified as HIGH priority.

---

## 2. Competency Framework Overview

### 2.1 Competency Domains

All AIMS competencies are organized into five domains:

| Domain | Code | Description |
|---|---|---|
| **AI Governance Fundamentals** | GOV | Understanding of AI governance principles, standards, and regulatory landscape |
| **Vorion Platform Operations** | VPO | Technical knowledge of Cognigate, BASIS specification, and the INTENT/ENFORCE/PROOF pipeline |
| **AI Risk Management** | ARM | Ability to identify, assess, treat, and monitor AI-specific risks |
| **AI Safety and Security** | ASS | Knowledge of AI safety controls, adversarial threats, and security mechanisms |
| **Compliance and Audit** | CAA | Understanding of compliance frameworks, evidence management, and audit procedures |

### 2.2 Proficiency Levels

| Level | Code | Definition | Assessment Evidence |
|---|---|---|---|
| **Awareness** | L1 | Can describe the concept and explain its relevance to AIMS | Written quiz or verbal assessment (score 70%+) |
| **Working Knowledge** | L2 | Can apply the concept in routine situations with guidance | Practical exercise completion; supervised task demonstration |
| **Proficiency** | L3 | Can independently apply the concept and make sound judgments | Independent task completion; peer review of work product |
| **Expert** | L4 | Can teach others, handle novel situations, and improve processes | Training delivery; process improvement contributions; incident leadership |

---

## 3. Role-Based Competency Requirements

### 3.1 Executive Sponsor (ES)

| Domain | Required Level | Competencies |
|---|---|---|
| GOV | L2 -- Working Knowledge | ISO 42001 structure and certification requirements; AI governance principles; regulatory landscape (EU AI Act, NIST AI RMF) |
| VPO | L1 -- Awareness | Cognigate architecture overview; BASIS pipeline concept; trust tier model purpose |
| ARM | L2 -- Working Knowledge | AI risk categories; risk appetite and tolerance; management review inputs |
| ASS | L1 -- Awareness | AI safety incident categories; escalation triggers; organizational liability |
| CAA | L2 -- Working Knowledge | Certification process; audit expectations; evidence requirements |

### 3.2 AIMS Manager (AM)

| Domain | Required Level | Competencies |
|---|---|---|
| GOV | L4 -- Expert | ISO 42001 all clauses and annexes; AIMS documentation requirements; management system design and operation; continuous improvement methodology |
| VPO | L3 -- Proficiency | Cognigate component architecture; BASIS specification; trust model operation; evidence generation pipeline; proof chain concepts |
| ARM | L3 -- Proficiency | AI risk assessment methodology; risk treatment planning; risk register management; impact assessment; Statement of Applicability management |
| ASS | L2 -- Working Knowledge | AI threat landscape; safety control concepts (circuit breaker, tripwires); incident classification; Critic module purpose and limitations |
| CAA | L4 -- Expert | Multi-framework compliance (ISO 42001, NIST 800-53, EU AI Act, SOC 2, NIST AI RMF, CMMC, GDPR); internal audit methodology; evidence chain integrity; management review process |

### 3.3 Chief Technology Officer (CTO)

| Domain | Required Level | Competencies |
|---|---|---|
| GOV | L2 -- Working Knowledge | ISO 42001 technical clauses (6, 8, Annex A.5, A.6, A.10); responsible AI development principles |
| VPO | L4 -- Expert | Full Cognigate architecture; all component internals; deployment pipeline; infrastructure design; performance characteristics; API design |
| ARM | L3 -- Proficiency | Technical risk assessment; architecture risk analysis; technology selection risk evaluation |
| ASS | L3 -- Proficiency | Secure development lifecycle; AI-specific attack vectors; defense-in-depth for AI systems; model security |
| CAA | L2 -- Working Knowledge | Technical evidence requirements; audit support procedures; control implementation expectations |

### 3.4 AI Safety Officer (ASO)

| Domain | Required Level | Competencies |
|---|---|---|
| GOV | L3 -- Proficiency | ISO 42001 risk and safety clauses (6.1, 8.2-8.4, Annex A.8, A.10); AI ethics principles; human oversight requirements |
| VPO | L3 -- Proficiency | Critic module architecture and configuration; trust engine internals; circuit breaker and tripwire operation; enforcement decision flow; velocity monitoring |
| ARM | L4 -- Expert | AI risk assessment and treatment; STPA methodology for AI systems; hazard analysis; risk scoring calibration; adversarial risk evaluation |
| ASS | L4 -- Expert | AI safety engineering; adversarial AI evaluation; prompt injection defense; model manipulation detection; incident response for AI systems; safety case construction |
| CAA | L2 -- Working Knowledge | Safety-related evidence requirements; incident documentation; safety-critical audit expectations |

### 3.5 Security Engineering (SE)

| Domain | Required Level | Competencies |
|---|---|---|
| GOV | L1 -- Awareness | ISO 42001 security-related controls (Annex A.10); responsible AI security principles |
| VPO | L3 -- Proficiency | Cognigate security architecture; authentication and authorization mechanisms; tripwire implementation; circuit breaker implementation; velocity enforcement; proof chain cryptography |
| ARM | L2 -- Working Knowledge | Security risk assessment; vulnerability classification; threat modeling for AI systems |
| ASS | L3 -- Proficiency | AI system security implementation; adversarial defense mechanisms; security monitoring; incident detection and response; access control implementation |
| CAA | L1 -- Awareness | Security evidence requirements; security audit support |

### 3.6 Platform Engineering (PE)

| Domain | Required Level | Competencies |
|---|---|---|
| GOV | L1 -- Awareness | ISO 42001 development-related controls (Annex A.5, A.10.5); responsible AI development principles |
| VPO | L3 -- Proficiency | Cognigate codebase; FastAPI application structure; Pydantic model design; database schema and migrations; Vercel deployment; Neon PostgreSQL configuration; testing frameworks |
| ARM | L1 -- Awareness | Development risk awareness; change impact awareness |
| ASS | L2 -- Working Knowledge | Secure coding practices for AI systems; input validation; dependency security; testing for security properties |
| CAA | L1 -- Awareness | Development evidence requirements; change documentation expectations |

### 3.7 Compliance Analyst (CA)

| Domain | Required Level | Competencies |
|---|---|---|
| GOV | L3 -- Proficiency | ISO 42001 all clauses; regulatory landscape (EU AI Act, NIST AI RMF); management system audit methodology |
| VPO | L2 -- Working Knowledge | Evidence generation pipeline; proof chain concepts; compliance API endpoints; dashboard metrics interpretation |
| ARM | L2 -- Working Knowledge | Risk assessment documentation; control effectiveness evaluation; Statement of Applicability management |
| ASS | L1 -- Awareness | Security control categories; incident classification; safety control purposes |
| CAA | L4 -- Expert | Multi-framework evidence mapping; audit preparation; internal audit execution; nonconformity management; corrective action tracking; evidence chain verification; compliance reporting |

### 3.8 Operations (OPS)

| Domain | Required Level | Competencies |
|---|---|---|
| GOV | L1 -- Awareness | AIMS operational requirements; escalation procedures |
| VPO | L2 -- Working Knowledge | Cognigate operational monitoring; health check interpretation; deployment status monitoring; proof chain status |
| ARM | L1 -- Awareness | Operational risk indicators; anomaly recognition |
| ASS | L2 -- Working Knowledge | Incident triage for AI governance events; circuit breaker response procedures; escalation procedures; operational security monitoring |
| CAA | L1 -- Awareness | Operational evidence requirements; log management expectations |

### 3.9 All Personnel in AIMS Scope (ALL)

| Domain | Required Level | Competencies |
|---|---|---|
| GOV | L1 -- Awareness | Vorion AI Policy existence and purpose; AIMS scope and relevance to their role; implications of nonconformity |
| VPO | L1 -- Awareness | High-level understanding of what Cognigate does and why it exists |
| ARM | L1 -- Awareness | Basic AI risk awareness; reporting obligations |
| ASS | L1 -- Awareness | Basic AI safety awareness; incident reporting procedures |
| CAA | L1 -- Awareness | Personal record-keeping obligations |

---

## 4. Training Curriculum

### 4.1 Curriculum Structure

Training is organized into modules aligned with the competency domains. Each module has a target audience, delivery method, duration, and assessment.

### 4.2 Foundational Modules (All Personnel)

| Module ID | Module Name | Target Audience | Delivery | Duration | Assessment |
|---|---|---|---|---|---|
| **TRN-F01** | AI Governance Awareness | ALL | E-learning + acknowledgment | 1 hour | Online quiz (70% pass) |
| **TRN-F02** | Vorion AI Policy Overview | ALL | E-learning + acknowledgment | 30 minutes | Acknowledgment signature |
| **TRN-F03** | AI Safety Incident Reporting | ALL | E-learning | 30 minutes | Online quiz (70% pass) |
| **TRN-F04** | AIMS Overview and Your Role | ALL | Briefing (live or recorded) | 1 hour | Attendance record |

### 4.3 Technical Modules (Role-Based)

| Module ID | Module Name | Target Roles | Delivery | Duration | Assessment |
|---|---|---|---|---|---|
| **TRN-T01** | ISO 42001 Standard Deep Dive | AM, CA | Instructor-led workshop | 8 hours | Written assessment (80% pass) |
| **TRN-T02** | Cognigate Architecture and Operations | CTO, ASO, SE, PE | Technical workshop | 4 hours | Practical exercise |
| **TRN-T03** | BASIS Specification and Trust Model | AM, CTO, ASO, SE, PE | Technical workshop | 4 hours | Practical exercise |
| **TRN-T04** | AI Risk Assessment Methodology | AM, ASO, CA | Workshop | 4 hours | Risk assessment exercise |
| **TRN-T05** | Critic Module and Adversarial Evaluation | ASO, SE | Technical deep dive | 4 hours | Configuration exercise |
| **TRN-T06** | PROOF Chain and Evidence Pipeline | SE, PE, CA | Technical workshop | 3 hours | Chain verification exercise |
| **TRN-T07** | Security Controls: Tripwires, Circuit Breakers, Velocity | ASO, SE, OPS | Technical workshop | 3 hours | Incident simulation |
| **TRN-T08** | Compliance Evidence and Audit Preparation | AM, CA | Workshop | 4 hours | Mock audit exercise |
| **TRN-T09** | Change Management for AI Systems | AM, CTO, ASO, SE, PE | Process training | 2 hours | Change request exercise |
| **TRN-T10** | Management Review Process | ES, AM, CA | Briefing | 2 hours | Review meeting simulation |

### 4.4 Advanced Modules (Specialist)

| Module ID | Module Name | Target Roles | Delivery | Duration | Assessment |
|---|---|---|---|---|---|
| **TRN-A01** | AI Safety Engineering | ASO | External course or self-study | 16+ hours | Certificate or portfolio review |
| **TRN-A02** | ISO 42001 Lead Implementer | AM | Accredited training provider | 40 hours | [PLANNED] External certification |
| **TRN-A03** | ISO 42001 Lead Auditor | CA | Accredited training provider | 40 hours | [PLANNED] External certification |
| **TRN-A04** | Multi-Framework Compliance Management | CA | Self-study + mentoring | 20 hours | Portfolio review |

---

## 5. Competency Assessment

### 5.1 Assessment Methods

| Method | Applicable Levels | Description |
|---|---|---|
| **Written Quiz** | L1, L2 | Multiple-choice and short-answer questions; automated scoring; 70% pass threshold for L1, 80% for L2 |
| **Practical Exercise** | L2, L3 | Hands-on task completion in a controlled environment; assessed by qualified evaluator |
| **Supervised Task Demonstration** | L2 | Observed performance of a real or simulated work task; assessed by supervisor or subject matter expert |
| **Independent Task Completion** | L3 | Unsupervised completion of a work task with peer review of the work product |
| **Training Delivery** | L4 | Ability to effectively teach the competency to others; assessed by training feedback and learner outcomes |
| **Process Improvement Contribution** | L4 | Documented contribution to improving a process, control, or methodology within the AIMS |
| **Incident Leadership** | L4 | Demonstrated ability to lead incident response or complex problem resolution; assessed by incident review |
| **External Certification** | L3, L4 | Third-party certification (e.g., ISO Lead Implementer, Lead Auditor) |

### 5.2 Assessment Schedule

| Assessment Type | Frequency | Responsible |
|---|---|---|
| Initial competency assessment | Upon role assignment or hire | AIMS Manager |
| Annual competency review | Annually, aligned with management review | AIMS Manager |
| Post-training assessment | Within 30 days of training completion | Training module owner |
| Triggered reassessment | Upon significant AIMS scope change, role change, or after a competency-related nonconformity | AIMS Manager |

### 5.3 Competency Gap Resolution

When an assessment identifies a competency gap (current level below required level):

| Gap Size | Resolution Path | Timeframe |
|---|---|---|
| 1 level below required | Targeted training module + reassessment | 90 days |
| 2 or more levels below required | Structured development plan with mentoring + reassessment | 180 days |
| Critical gap (safety or security role) | Immediate supervised operation + accelerated development plan | 30 days for supervised operation approval; 90 days for gap closure |

During gap resolution, the individual shall operate under supervision of a person who meets the required competency level.

---

## 6. Awareness Program

### 6.1 Awareness Requirements (Clause 7.3)

All personnel within the AIMS scope shall be aware of:

| Awareness Area | Content | Delivery Mechanism |
|---|---|---|
| **AI Policy** (7.3.a) | The existence and content of the Vorion AI Policy; its principles and commitments | TRN-F02 module; policy document distribution; annual refresh |
| **AIMS Contribution** (7.3.b) | How their role contributes to the effectiveness of the AIMS, including the benefits of improved AI governance performance | TRN-F04 module; role-specific RACI briefing; dashboard access |
| **Nonconformity Implications** (7.3.c) | The implications of not conforming with AIMS requirements, including potential safety impacts, compliance consequences, and disciplinary measures | TRN-F01 module; incident case studies; annual refresh |

### 6.2 Awareness Delivery Schedule

| Activity | Frequency | Target Audience | Delivery |
|---|---|---|---|
| AI Policy awareness session | Annual + upon policy update | ALL | E-learning module (TRN-F02) |
| AIMS performance briefing | Quarterly | ALL | Email summary or all-hands presentation |
| AI safety lessons learned | After each significant incident | Relevant roles | Briefing or case study |
| Regulatory update briefing | As needed (minimum semi-annual) | AM, CA, ES | Written brief + discussion |
| New hire AIMS onboarding | Upon joining | New personnel in scope | TRN-F01, TRN-F02, TRN-F03, TRN-F04 |

### 6.3 Awareness Effectiveness Measurement

| Indicator | Target | Measurement Method |
|---|---|---|
| Annual awareness training completion rate | 100% of in-scope personnel | Training records |
| AI Policy awareness quiz pass rate | 90%+ of personnel | Quiz scores |
| Incident reporting rate (proxy for awareness) | Increasing or stable trend | Incident register |
| Unprompted compliance questions from personnel | Increasing trend (indicates engagement) | AIMS Manager observation |

---

## 7. Records and Certification Tracking

### 7.1 Competency Records

The following records shall be maintained for each individual within the AIMS scope:

| Record | Content | Retention |
|---|---|---|
| **Individual Competency Profile** | Current competency levels by domain; required levels for role; gap status | Active employment + 3 years |
| **Training Completion Records** | Modules completed; dates; assessment scores; certificates | Active employment + 7 years |
| **Assessment Results** | Detailed results of each competency assessment; assessor identity | Active employment + 7 years |
| **Competency Gap Resolution Plans** | Identified gaps; resolution actions; target dates; outcomes | Active employment + 3 years |
| **External Certifications** | Certification name; issuing body; date; expiry; renewal status | Active employment + 3 years |
| **Awareness Acknowledgments** | Signed acknowledgments of AI Policy, AIMS awareness materials | Active employment + 7 years |

### 7.2 Certification Tracking

| Certification | Target Role(s) | Status | Issuing Body |
|---|---|---|---|
| ISO 42001 Lead Implementer | AIMS Manager | [PLANNED] | Accredited training provider (e.g., BSI, PECB, CQI/IRCA) |
| ISO 42001 Lead Auditor | Compliance Analyst | [PLANNED] | Accredited training provider |
| ISO 27001 Foundation | SE, PE | [PLANNED] | Accredited training provider |
| AI Safety certification | ASO | [PLANNED] | Industry provider (as available) |

### 7.3 Records Location and Access

| Record Type | Storage Location | Access Control |
|---|---|---|
| Individual competency profiles | [PLANNED] HR management system or secure document repository | AIMS Manager; HR; individual (own record) |
| Training completion records | Training platform or secure document repository | AIMS Manager; HR; individual (own record) |
| Assessment results | Secure document repository | AIMS Manager; assessor; individual (own record) |
| External certifications | HR management system | AIMS Manager; HR; individual (own record) |

---

## 8. Integration with Other AIMS Processes

### 8.1 Management Review Input

The following competency metrics shall be reported as input to the quarterly management review (Clause 9.3):

- Training completion rates by module and role
- Competency gap summary (number of open gaps, resolution progress)
- External certification status
- Awareness program effectiveness indicators

### 8.2 Change Management Integration

When the AIMS Change Management Procedure (VOR-AIMS-CHG-001) identifies a change that introduces new competency requirements, the AIMS Manager shall:

1. Update the competency matrix (this document) to reflect the new requirements
2. Identify affected personnel
3. Schedule appropriate training
4. Track completion and assessment

### 8.3 Nonconformity Integration

When a nonconformity is traced to a competency gap in root cause analysis, the corrective action plan shall include:

- Update to the competency matrix if requirements were insufficient
- Targeted training for affected personnel
- Assessment to verify competency gap closure
- Systemic review to determine if similar gaps exist in other roles

---

## 9. Document Control

| Version | Date | Author | Change Description |
|---|---|---|---|
| 1.0.0 | 2026-02-20 | AIMS Manager | Initial release -- addresses Gap GAP_003 from ISO 42001 Gap Analysis |

---

**Prepared by:** AIMS Manager, Vorion
**Reviewed by:** [PENDING -- CTO Review]
**Approved by:** [PENDING -- Executive Sponsor Approval]
