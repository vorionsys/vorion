# Vorion Cognigate -- Personnel Security Policy

**Document ID:** VOR-POL-PS-001
**Version:** 1.0.0
**Effective Date:** 2026-02-19
**Last Reviewed:** 2026-02-19
**Next Review:** 2027-02-19
**Owner:** Vorion Security Engineering
**Classification:** PUBLIC
**Applicable Controls:** PS-1, PS-2, PS-3, PS-5, PS-6, PS-7, PS-9

---

## 1. Purpose and Scope

### 1.1 Purpose

This policy establishes the personnel security requirements for the Vorion Cognigate AI Agent Governance Runtime. It defines screening, access, transfer, and separation procedures for all entities that interact with the Cognigate system in an operational capacity.

### 1.2 Dual-Domain Scope

Cognigate is unique among information systems in that it governs two distinct classes of "personnel":

1. **Human personnel** -- Developers, operators, administrators, and contractors who build, deploy, and maintain the Cognigate system.
2. **AI agent entities** -- Autonomous software agents that register with Cognigate's governance API, receive trust tiers, and operate under Cognigate's behavioral policy enforcement.

This policy addresses both classes. For AI agent entities, Cognigate's trust tier model, entity registration lifecycle, and behavioral enforcement mechanisms serve as the technical analogs to traditional personnel security controls. The mapping between traditional personnel security concepts and Cognigate's AI entity governance is documented in Section 3 of this policy.

### 1.3 Applicability

| Personnel Class | Applicable Sections | Governing System |
|----------------|--------------------|--------------------|
| Vorion employees with Cognigate access | Sections 2 and 4 | HR policies + platform access controls |
| Contractors and external contributors | Sections 2 and 4 | Contractor agreements + platform access controls |
| AI agent entities (internal) | Sections 3 and 4 | Cognigate trust tier model + ENFORCE pipeline |
| AI agent entities (external/third-party) | Sections 3 and 4 | Cognigate trust tier model (T0 default) + ENFORCE pipeline |

---

## 2. Policy for Human Personnel

### 2.1 PS-1: Personnel Security Policy and Procedures

**Control Requirement:** Develop, document, and disseminate a personnel security policy; review and update annually.

**Cognigate Implementation:**

a. This document constitutes the formal personnel security policy for the Cognigate system. It is maintained under version control at `compliance/policies/personnel-security-policy.md`.

b. This policy is reviewed **annually** by Vorion Security Engineering, or sooner when triggered by:
   - A security incident involving personnel (human or AI entity)
   - A change in organizational structure that affects roles with Cognigate access
   - A regulatory change affecting personnel security requirements
   - Addition of a new AI agent entity class or trust tier modification
   - A change in the cloud platform access model (GitHub, Vercel, Neon)

c. Personnel security procedures are enforced through:
   - GitHub organization membership and team role controls
   - Vercel team membership and deployment permissions
   - Neon project membership and database access roles
   - Cognigate's X-Admin-Key authentication for runtime administrative operations
   - Cognigate's entity registration, trust tier, and policy enforcement for AI agent entities

d. This policy is disseminated to all Vorion personnel upon onboarding and is accessible in the compliance directory of the repository.

### 2.2 PS-2: Position Risk Designation

**Control Requirement:** Assign a risk designation to all organizational positions; establish screening criteria for individuals filling those positions.

**Cognigate Implementation:**

a. **Position risk designations for Cognigate-related roles:**

   | Position | Risk Level | Justification | Screening Level | Platform Access |
   |----------|------------|---------------|-----------------|-----------------|
   | **Developer** | Moderate | Write access to application code that processes governance decisions; can introduce vulnerabilities through code changes | Standard | GitHub (write), CI/CD (trigger) |
   | **Senior Developer / Reviewer** | Moderate-High | Code review authority; approves changes that reach production; CODEOWNERS for security-critical paths | Enhanced | GitHub (write + review), CI/CD (trigger) |
   | **DevOps / Platform Engineer** | High | Manages deployment infrastructure, CI/CD pipeline, environment variables (including ADMIN_KEY); can modify security scanning configuration | Enhanced | GitHub (admin), Vercel (admin), Neon (admin) |
   | **Security Engineer** | High | Manages security scanning tools, reviews vulnerability reports, handles incident response; access to security-sensitive logs and alerts | Enhanced | GitHub (admin), Vercel (admin), security tools |
   | **System Administrator** | High | Possesses X-Admin-Key for Cognigate runtime administration; can modify entity trust tiers, trigger circuit breaker, manage policies | Enhanced | All platforms (admin), Cognigate admin API |
   | **Executive / Authorizing Official** | High | Authorization decisions for system operation; access to compliance and audit data | Enhanced | Read access to compliance artifacts |

b. **Risk designation alignment with trust tier model:**

   The position risk designations for human personnel are conceptually aligned with the trust tier model used for AI agent entities. This alignment ensures a consistent security philosophy across both human and machine "personnel":

   | Human Risk Level | Analog Trust Tier Range | Shared Principle |
   |-----------------|------------------------|------------------|
   | Low | T0-T1 (Sandbox, Observed) | Minimal access, heavy monitoring |
   | Moderate | T2-T4 (Provisional, Monitored, Standard) | Standard operations, normal oversight |
   | High | T5-T7 (Trusted, Certified, Autonomous) | Elevated access, reduced restrictions, greater accountability |

c. **Review cadence:** Position risk designations are reviewed annually or when an individual's role changes. Changes in risk designation trigger a review of the individual's screening status and access level.

### 2.3 PS-3: Personnel Screening

**Control Requirement:** Screen individuals prior to authorizing access; rescreen based on defined conditions.

**Cognigate Implementation:**

a. **Pre-access screening for Vorion employees:**

   | Screening Element | Moderate Risk Positions | High Risk Positions |
   |-------------------|------------------------|---------------------|
   | Identity verification | Required | Required |
   | Employment history verification | Required | Required |
   | Criminal background check | Required (US scope) | Required (expanded scope) |
   | Reference check | Recommended | Required |
   | Technical competency assessment | Required | Required |
   | NDA execution | Required | Required |
   | Security awareness acknowledgment | Required | Required |

b. **GitHub account verification:**
   - All personnel must use individually identifiable GitHub accounts (no shared accounts)
   - GitHub accounts must have multi-factor authentication (MFA) enabled
   - GitHub accounts must use verified email addresses associated with the individual
   - Organization membership requires invitation from an existing administrator

c. **Rescreening triggers:**
   - Promotion to a higher-risk position
   - Access request to a new platform (e.g., adding Neon database access to a developer who previously had GitHub-only access)
   - Security incident involving the individual or their accounts
   - Every 3 years for Moderate risk positions; every 2 years for High risk positions

d. **Screening for contractor and external contributor access:** See Section 2.6 (PS-7).

### 2.4 PS-5: Personnel Transfer

**Control Requirement:** Review and confirm ongoing operational need for access when individuals are transferred; initiate transfer actions within defined timeframe.

**Cognigate Implementation:**

a. **Transfer actions:**

   When a Vorion employee changes roles (laterally or vertically), the following actions are initiated within **5 business days** of the effective transfer date:

   1. **Access review:** The individual's current platform access (GitHub teams, Vercel roles, Neon roles) is compared against the access requirements of the new position.
   2. **Access adjustment:**
      - Excess access (permissions no longer required for the new role) is revoked
      - New access (permissions required for the new role but not previously held) is provisioned after appropriate screening for the new risk level
   3. **GitHub team membership update:** The individual is moved from their previous team(s) to the team(s) associated with their new role.
   4. **CODEOWNERS update:** If the individual was a designated code owner for security-critical paths, the CODEOWNERS file is updated to reflect the change.
   5. **Admin key rotation:** If the departing role had X-Admin-Key access and the new role does not, the admin key is rotated within 24 hours.

b. **Transfer documentation:**
   - Access changes are documented in the access review log
   - GitHub organization audit log records team membership changes
   - Vercel team audit log records role changes

c. **Lateral transfers to higher-risk positions** trigger the enhanced screening requirements defined in PS-3 before elevated access is provisioned.

### 2.5 PS-6: Access Agreements

**Control Requirement:** Ensure individuals requiring access sign appropriate access agreements before being granted access; review and update agreements.

**Cognigate Implementation:**

a. **Required access agreements:**

   | Agreement | Applicability | Content | Review Cadence |
   |-----------|--------------|---------|----------------|
   | **Employment Agreement** | All employees | Security responsibilities, data handling obligations, acceptable use, termination provisions | At hire; updated with role changes |
   | **Non-Disclosure Agreement (NDA)** | All employees and contractors | Confidentiality of system architecture, security controls, vulnerability information, proof chain data | At hire; updated with scope changes |
   | **Acceptable Use Policy (AUP)** | All personnel with system access | Authorized use of Cognigate platforms, prohibited activities, monitoring notice | Annually |
   | **Contributor License Agreement (CLA)** | External contributors | IP assignment, code contribution terms, security responsibility for contributed code | Per contribution |
   | **Privileged Access Agreement** | High-risk positions | Additional obligations for administrative access, incident reporting requirements, separation procedures | At privilege grant; annually |

b. **Agreement execution process:**
   - Access agreements are executed before any platform access (GitHub, Vercel, Neon) is provisioned
   - Agreements are stored in the HR/legal document management system
   - Access provisioning is blocked until all required agreements are confirmed as executed

c. **Agreement review:**
   - Agreements are reviewed annually for currency and completeness
   - Agreements are updated when personnel security requirements change or when the individual's role changes
   - Material changes to agreements require re-execution by the individual

### 2.6 PS-7: External Personnel Security

**Control Requirement:** Establish personnel security requirements for external personnel; monitor compliance.

**Cognigate Implementation:**

a. **External personnel categories:**

   | Category | Definition | Access Scope |
   |----------|-----------|--------------|
   | **Contractors** | Individuals or firms engaged for specific development or operational tasks | Limited GitHub access (specific repositories or teams); no admin access |
   | **External contributors** | Open-source contributors to non-sensitive components | Pull request submission only; no repository write access; no platform access |
   | **Auditors** | Third-party security assessors or compliance auditors | Read-only access to compliance artifacts, proof chain data, and test results |
   | **Cloud provider personnel** | Vercel, Neon, GitHub support engineers | Provider platform access only; no Cognigate application-level access |

b. **Requirements for contractors:**
   - NDA execution required before any access provisioning
   - Access agreement specifying scope, duration, and obligations
   - GitHub access limited to non-admin roles (read or write, not admin)
   - No direct Vercel admin or Neon admin access; infrastructure changes must be requested through Vorion personnel
   - MFA required on all platform accounts
   - Time-limited access: contractor GitHub invitations have defined expiration dates
   - Quarterly access review: continued need for contractor access is verified every 90 days

c. **Requirements for external contributors:**
   - Contributor License Agreement (CLA) execution required before PR acceptance
   - Code contributions are subject to the same CI/CD scanning (Semgrep, CodeQL, Gitleaks, Trivy) as internal changes
   - External contributors do not receive repository write access; contributions are submitted via fork-and-pull-request workflow
   - All contributions require review and approval from an authorized Vorion reviewer

d. **Monitoring:**
   - Contractor and external contributor activity is monitored through GitHub audit logs
   - Access scope is reviewed when the engagement scope changes or at quarterly intervals
   - Security incidents involving external personnel trigger immediate access review and potential revocation

### 2.7 PS-9: Position Descriptions

**Control Requirement:** Incorporate security role responsibilities into position descriptions.

**Cognigate Implementation:**

a. **Security responsibilities by role:**

   | Position | Security Responsibilities Documented in Position Description |
   |----------|-------------------------------------------------------------|
   | **Developer** | Write secure code following OWASP guidelines; write tests for security-relevant functionality; respond to Semgrep/CodeQL findings in PRs; report suspected vulnerabilities; never commit secrets or credentials |
   | **Senior Developer / Reviewer** | All Developer responsibilities plus: review code for security vulnerabilities; verify SAST scan results are addressed; ensure test coverage for security controls; mentor developers on secure coding practices |
   | **DevOps / Platform Engineer** | Maintain CI/CD security scanning pipeline; manage platform access controls; rotate secrets and credentials on schedule; monitor deployment security; respond to dependency vulnerability alerts |
   | **Security Engineer** | Define and update security scanning rules; triage vulnerability reports; conduct incident response; manage security tool configuration; review access control effectiveness; maintain compliance evidence |
   | **System Administrator** | Manage Cognigate administrative API access; monitor entity trust tiers; respond to circuit breaker trips; manage proof chain integrity; coordinate with cloud providers on infrastructure security |

b. **Documentation:** Security responsibilities are included in:
   - Job postings and position descriptions
   - Employment agreements (as referenced in PS-6)
   - Team onboarding checklists
   - Annual performance review criteria

c. **Review:** Position descriptions with security roles are reviewed:
   - Annually during the personnel security policy review
   - When a position's risk designation changes
   - When Cognigate's architecture changes in a way that affects role responsibilities

---

## 3. Policy for AI Agent Entities

### 3.1 Overview: AI Agents as "Personnel"

Cognigate governs AI agent entities through a lifecycle model that parallels traditional personnel security. This section maps each NIST personnel security concept to its Cognigate AI entity analog:

| Personnel Security Concept | Human Personnel Analog | AI Agent Entity Analog in Cognigate |
|---------------------------|----------------------|--------------------------------------|
| Onboarding | Hiring and provisioning | Entity registration at `/v1/agents` |
| Position risk designation | Role-based risk level | Trust tier assignment (T0-T7) |
| Screening | Background investigation | Behavioral monitoring during T0 sandbox probation |
| Access agreement | NDA and AUP execution | Policy acceptance via capability taxonomy binding |
| Position description | Security role documentation | Capability set defined by trust tier |
| Transfer | Role change | Trust tier promotion/demotion via admin API |
| External personnel | Contractor management | External agent T0 default with restricted namespace |
| Separation | Termination and deprovisioning | Entity deregistration and credential revocation |
| Sanctions | Disciplinary action | Trust score reduction, throttling, circuit breaker |

### 3.2 Entity Registration as Onboarding (PS-3 Analog)

**Traditional Requirement:** Screen individuals prior to authorizing access.

**Cognigate Implementation for AI Agents:**

a. **Registration process (onboarding):**
   1. An AI agent submits a registration request to `POST /v1/agents` with:
      - `agentId`: A unique agent identifier
      - `name`: Display name for the agent
      - `capabilities`: List of declared capabilities
      - `observationTier`: Requested observation tier (defaults to GRAY_BOX / T1 if not specified)
   2. Cognigate validates the registration:
      - `agentId` uniqueness (duplicate IDs rejected)
      - Field validation and completeness
   3. Upon successful registration:
      - Entity is assigned **GRAY_BOX (T1, Observed)** trust tier by default with an initial trust score of 200
      - Other initial trust scores by tier: BLACK_BOX=100 (T0), WHITE_BOX=350 (T2)
      - The agent is stored in Cognigate's in-memory agent store
      - A proof record is created with SHA-256 hash chain integrity and Ed25519 signature

b. **Probationary period (screening analog):**
   - New entities default to GRAY_BOX (T1, Observed) unless a different observation tier is specified at registration
   - T1 entities operate under monitoring with standard velocity caps and policy enforcement
   - The entity's behavior is monitored through the full ENFORCE pipeline: policy evaluation, velocity caps, behavioral pattern checks
   - Trust score accumulation upward requires sustained compliant behavior
   - This probationary monitoring period serves as the "screening" for AI agent entities, where trustworthiness is demonstrated through behavior rather than background investigation

c. **Elevated initial trust (pre-screened entities):**
   - Administrators with T6+ privileges may register entities at elevated initial trust tiers (above T0) via the admin API
   - Elevated registration requires documented justification and generates an administrative proof record
   - This is analogous to expedited screening for personnel with existing clearances or certifications

### 3.3 Trust Tier as Position Risk Designation (PS-2 Analog)

**Traditional Requirement:** Assign risk designations to positions.

**Cognigate Implementation for AI Agents:**

a. **Trust tier as risk designation:**

   | Trust Tier | Score Range | Risk Designation | Capability Scope | Human Role Analog |
   |-----------|-------------|-----------------|-------------------|-------------------|
   | **T0 -- Sandbox** | 0-199 | Minimal | Read-only, monitoring | Visitor / observer |
   | **T1 -- Observed** | 200-349 | Low | Basic queries | Intern / probationary |
   | **T2 -- Provisional** | 350-499 | Low-Moderate | Simple tasks, supervised | Junior contributor |
   | **T3 -- Monitored** | 500-649 | Moderate | Standard operations | Standard employee |
   | **T4 -- Standard** | 650-799 | Moderate-High | Most operations | Senior contributor |
   | **T5 -- Trusted** | 800-875 | High | Advanced operations, cross-domain | Trusted lead |
   | **T6 -- Certified** | 876-950 | High | Administrative operations | Department admin |
   | **T7 -- Autonomous** | 951-1000 | Critical | Full autonomous capability, self-modification | System administrator |

b. **Dynamic risk reassessment:**
   - Unlike static human position designations, AI entity trust tiers are **dynamic**: they adjust based on real-time behavioral evidence
   - Trust scores increase through sustained compliant behavior (policy compliance rate, outcome alignment)
   - Trust scores decrease through policy violations, anomalous velocity patterns, or behavioral inconsistencies
   - 182-day trust decay ensures that inactive entities automatically lose elevated trust, requiring re-demonstration of trustworthiness

c. **Tier boundary controls:**
   - Each tier transition (up or down) generates a `TRUST_DELTA` proof record documenting the old tier, new tier, delta value, and triggering event
   - Promotion above T5 requires administrative approval (automated promotion caps at T5)
   - Demotion is automatic upon policy violation or trust decay

### 3.4 Capability Restrictions as Access Agreement (PS-6 Analog)

**Traditional Requirement:** Require access agreements before granting access.

**Cognigate Implementation for AI Agents:**

a. **Implicit access agreement through capability binding:**
   - When an AI agent entity registers and receives a trust tier, it is implicitly bound to the behavioral constraints defined by that tier's capability set
   - The capability taxonomy (24 capabilities across 7 categories) defines what the entity is authorized to do
   - Attempting actions outside the authorized capability set results in a `DENY` verdict from the ENFORCE layer
   - This is functionally equivalent to an access agreement: the entity's "signature" is its registration, and the "agreement terms" are the capability restrictions

b. **Agreement enforcement (automated):**
   - Every request from an AI agent entity passes through the ENFORCE pipeline:
     1. Trust level gate check (is the entity's trust tier sufficient for the requested capability?)
     2. Permission scope validation (is the requested action within the entity's namespace?)
     3. Behavioral pattern check (does the request match the entity's established behavior profile?)
     4. Velocity rate limiting (is the entity within acceptable request rates?)
     5. Policy rule evaluation (does any active policy prohibit this action?)
   - Violations result in trust score reduction (sanctions) and proof chain documentation

c. **Agreement updates:**
   - When policies change, the updated constraints are automatically enforced on all entities
   - When an entity's trust tier changes, the new capability set takes effect immediately
   - Entities do not need to "re-sign" an agreement; enforcement is continuous and programmatic

### 3.5 Trust Decay as Separation Procedure

**Traditional Requirement:** Revoke access upon separation.

**Cognigate Implementation for AI Agents:**

a. **Inactivity-based trust decay (automatic separation analog):**
   - Entities that stop interacting with Cognigate experience automatic trust score decay
   - The 182-day decay mechanism gradually reduces trust scores toward zero
   - At zero trust, the entity effectively has T0 (Sandbox) capability, which is read-only
   - This is analogous to automatically revoking access when personnel stop performing their duties

b. **Explicit deregistration (termination analog):**
   - Administrators can explicitly deregister an entity via `DELETE /v1/agents/{agent_id}`
   - Deregistration immediately:
     - Revokes all capabilities
     - Invalidates the Ed25519 public key binding
     - Deletes the API key hash
     - Terminates all active sessions
   - A `ENTITY_DEREGISTERED` proof record is created documenting the deregistration event
   - The deregistered entity's proof chain history is retained for 7 years (audit preservation)

c. **Entity ID reuse prevention:**
   - Deregistered entity IDs are archived, not deleted
   - The same entity ID cannot be reassigned for the 7-year proof chain retention period
   - This prevents a new entity from inheriting the proof chain history of a deregistered entity

### 3.6 External Agents as External Personnel (PS-7 Analog)

**Traditional Requirement:** Establish security requirements for external personnel.

**Cognigate Implementation for AI Agents:**

a. **External agent identification:**
   - External AI agents (those not operated by Vorion or the consumer organization) are identified by their `entity_id` namespace prefix
   - External agents receive T0 (Sandbox) trust tier by default -- the most restrictive access level
   - External agents cannot be provisioned above T2 (Provisional) without explicit administrative approval

b. **Access restrictions for external agents:**
   - External agents are subject to the same ENFORCE pipeline as internal agents, with additional policy rules that can apply external-specific restrictions
   - Capability scope is limited to the sandbox namespace until trust is demonstrated
   - Velocity rate limits may be stricter for external agents to prevent abuse
   - All external agent actions are logged in the proof chain with full attribution

c. **External agent monitoring:**
   - External agent behavior is monitored through the same mechanisms as internal agents: policy evaluation, velocity tracking, behavioral pattern analysis
   - Anomalous behavior from external agents triggers more aggressive trust score reduction than for internal agents
   - Circuit breaker trip thresholds may be lower for external agent classes

d. **External agent termination:**
   - External agent access can be immediately revoked by an administrator at any time
   - Time-limited access can be configured for external agents (trust score set to zero after a defined period)
   - Revocation is documented in the proof chain

---

## 4. Separation Procedures

### 4.1 Human Personnel Separation

When a Vorion employee or contractor with Cognigate access separates from the organization (voluntarily or involuntarily):

| Step | Action | Timeline | Responsible Party |
|------|--------|----------|-------------------|
| 1 | Disable GitHub organization membership | Within 24 hours of separation | Vorion IT / Security |
| 2 | Remove Vercel team membership | Within 24 hours of separation | Vorion IT / Security |
| 3 | Remove Neon project membership | Within 24 hours of separation | Vorion IT / Security |
| 4 | Rotate X-Admin-Key (if individual had access) | Within 24 hours of separation | Vorion Security Engineering |
| 5 | Rotate any shared secrets the individual had access to | Within 72 hours of separation | Vorion Security Engineering |
| 6 | Revoke VPN, SSO, and email access | Within 24 hours of separation | Vorion IT |
| 7 | Collect or remotely wipe company devices | Within 5 business days | Vorion IT |
| 8 | Conduct exit interview addressing security obligations | Before or on separation date | Vorion HR / Security |
| 9 | Remind individual of continuing NDA obligations | At exit interview | Vorion HR / Legal |
| 10 | Document separation in access review log | Within 5 business days | Vorion Security Engineering |

**Involuntary separation** or separation involving a security concern:
- Steps 1-6 are executed immediately (same business day)
- All shared secrets and administrative keys are rotated immediately regardless of whether the individual had documented access
- GitHub audit logs are reviewed for recent activity by the departing individual
- Security monitoring is heightened for 30 days post-separation

### 4.2 AI Agent Entity Deregistration

When an AI agent entity is deregistered from Cognigate:

| Step | Action | Implementation | Proof Chain Record |
|------|--------|---------------|-------------------|
| 1 | Administrator initiates deregistration | `DELETE /v1/agents/{agent_id}` | `ENTITY_DEREGISTERED` |
| 2 | Authentication credentials invalidated | Ed25519 public key removed; API key hash deleted | Included in deregistration record |
| 3 | Active sessions terminated | Session cache entries invalidated | Included in deregistration record |
| 4 | Trust score set to zero | Trust tier set to T0 (Sandbox) | `TRUST_DELTA` (tier -> T0) |
| 5 | Entity marked as deregistered | Entity status set to INACTIVE in database | Database record update |
| 6 | Proof chain records retained | All historical proof records preserved | N/A (retention, not creation) |
| 7 | Entity ID archived | ID cannot be reassigned for 7 years | Enforced at registration validation |

Deregistered entities cannot:
- Authenticate with any previously valid credentials
- Submit intent requests or any API calls
- Be re-registered with the same entity ID within the retention period

### 4.3 Emergency Deregistration

For AI agent entities exhibiting active malicious behavior:

1. **Circuit breaker trip:** The circuit breaker can immediately suspend all activity for an entity (SUSPEND state) without waiting for administrative deregistration
2. **Immediate deregistration:** Administrator executes emergency deregistration with `reason: security_incident`
3. **Proof chain seal:** All proof records for the entity are sealed with a final summary record documenting the security incident
4. **Consumer notification:** If the entity was operated by a consumer organization, the organization is notified of the deregistration and the reason

---

## 5. Compliance Mapping

This policy satisfies or contributes to the following NIST SP 800-53 Rev 5 controls:

| Control | Title | How This Policy Satisfies |
|---------|-------|--------------------------|
| **PS-1** | Policy and Procedures | This document; annual review commitment; dual-domain coverage (human + AI entity) |
| **PS-2** | Position Risk Designation | Human role risk levels (Moderate/High) aligned with trust tier model; AI entity trust tiers (T0-T7) as automated risk designation |
| **PS-3** | Personnel Screening | Background checks for human personnel with production access; AI entity T0 sandbox probation as behavioral screening; GitHub account verification and MFA |
| **PS-5** | Personnel Transfer | 5-day access review on human role change; AI entity trust tier adjustment; admin key rotation; CODEOWNERS update |
| **PS-6** | Access Agreements | Employment agreement, NDA, AUP for humans; CLA for external contributors; AI entity capability binding as implicit access agreement |
| **PS-7** | External Personnel | Contractor NDA + access agreement; limited to non-admin GitHub roles; time-limited access; AI external agents default to T0 with T2 cap |
| **PS-9** | Position Descriptions | Security responsibilities documented per role (Developer, DevOps, Security Engineer, Admin); AI entity capability sets as "position descriptions" per trust tier |

### Cross-Framework Applicability

| Framework | Relevant Controls |
|-----------|-------------------|
| FedRAMP Moderate | PS-1 through PS-9 (identical to NIST 800-53) |
| ISO 27001:2022 | A.6.1 (Screening), A.6.2 (Terms and conditions), A.6.4 (Disciplinary process), A.6.5 (After termination), A.6.6 (Confidentiality agreements) |
| SOC 2 Type II | CC1.4 (Board of directors competence), CC6.2 (Credentials and access), CC6.3 (New access authorization) |
| GDPR | Article 28 (Processor obligations), Article 29 (Processing under authority), Article 32(4) (Personnel data security) |
| NIST AI RMF 1.0 | GOVERN 1.3 (Roles and responsibilities), GOVERN 1.7 (Engagement with external stakeholders), MAP 1.6 (System requirements) |
| CMMC 2.0 Level 2 | PS.L2-3.9.1 through PS.L2-3.9.2 |

### AI-Specific Framework Mapping

The AI agent entity provisions in this policy also satisfy requirements from AI-specific frameworks:

| Framework | Requirement | How Cognigate Satisfies |
|-----------|-------------|------------------------|
| EU AI Act Article 9 | Risk management for AI systems | Trust tier model implements risk-proportional access control for AI agents |
| EU AI Act Article 14 | Human oversight | Administrative approval required for T6+ trust; circuit breaker provides human override |
| ISO/IEC 42001 A.6.2.6 | AI system security | Entity registration, behavioral monitoring, and capability restrictions implement AI-specific security |
| NIST AI RMF GOVERN 1.4 | Organizational processes for AI risk | Entity lifecycle management provides organizational governance of AI agent risk |
| COSAiS AIS-AC.01 | AI-specific access control | Trust-tiered capability taxonomy implements AI-specific access control |

---

## 6. Metrics and Performance Indicators

| Metric | Target | Frequency | Data Source |
|--------|--------|-----------|-------------|
| Personnel screening completion rate (human + AI entity) | 100% of personnel screened before access grant; 100% of AI entities begin at T0/T1 | Monthly | HR records, entity registry (`trust_level` at registration) |
| Access termination SLA compliance (within 24 hours of separation) | 100% | Per separation event | GitHub/Vercel/Neon audit logs, access review log |
| Role transition compliance rate (access adjusted within 5 business days) | 100% | Quarterly | GitHub organization audit log, Vercel team audit log |
| AI entity registration compliance (% entities with valid credentials and trust tier) | 100% | Monthly | Entity registry, PROOF ledger (`ENTITY_REGISTERED` records) |

Metrics are reported monthly to the ISSO and quarterly to the Authorizing Official as part of the continuous monitoring program (VOR-POL-CONMON-001).

---

## 7. Document History

| Version | Date | Author | Change Description |
|---------|------|--------|--------------------|
| 1.0.0 | 2026-02-19 | Vorion Security Engineering | Initial policy document |

---

## 8. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Information System Security Officer (ISSO) | _________________ | _________________ | ________ |
| System Owner | _________________ | _________________ | ________ |
| Authorizing Official | _________________ | _________________ | ________ |

---

*This document is part of the Vorion Cognigate NIST SP 800-53 Rev 5 compliance evidence package. For the full OSCAL SSP, see `compliance/oscal/ssp-draft.json`.*
