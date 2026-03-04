# Awareness and Training Policy

**Document ID:** VOR-POL-AT-001
**Version:** 1.0
**Effective Date:** February 19, 2026
**Last Reviewed:** February 19, 2026
**Owner:** Vorion, Chief Information Security Officer (CISO)
**Classification:** Internal Use
**Applicable Controls:** AT-1, AT-2, AT-2(2), AT-2(3), AT-3, AT-4

---

## 1. Purpose and Scope

This policy establishes the security awareness and training program for all personnel who interact with, develop, operate, administer, or support the Vorion Cognigate AI Agent Governance Runtime. Cognigate implements the BASIS (Behavioral AI Safety Interoperability Standard) specification, enforcing real-time intent normalization, policy evaluation, trust scoring, and cryptographic proof generation for autonomous AI agent operations. Because Cognigate serves as an inherited control enforcement layer for downstream AI systems, personnel must understand both traditional cybersecurity principles and the AI-specific governance mechanisms unique to this platform.

This policy applies to:

- Full-time and part-time Vorion employees
- Contractors and consultants with access to Cognigate systems, source code, or infrastructure
- Third-party personnel who operate, integrate with, or administer Cognigate on behalf of consumer organizations
- Privileged users with administrative access to the Cognigate API, key management, or trust tier configuration

---

## 2. Security Awareness Program (AT-1, AT-2)

### 2.1 Policy and Procedures (AT-1)

Vorion maintains this awareness and training policy as a formal, documented component of the organizational security program. The CISO is the designated senior official responsible for:

- Developing, disseminating, and maintaining this policy and associated procedures
- Reviewing and updating this policy at least annually, or whenever significant changes occur to the Cognigate platform architecture, threat landscape, or regulatory requirements
- Ensuring this policy is consistent with applicable laws, executive orders, directives, regulations, and organizational mission

This policy is disseminated to all personnel with Cognigate access through the organizational Learning Management System (LMS) and the internal security documentation repository.

### 2.2 General Security Awareness Training (AT-2)

All personnel with access to Cognigate systems must complete security awareness training within 30 days of initial assignment and annually thereafter. The awareness training program covers:

**Foundational Security Topics:**

- Organizational security policies, acceptable use, and rules of behavior
- Password management and multi-factor authentication requirements
- Phishing, spear-phishing, and business email compromise recognition
- Incident reporting procedures and escalation paths
- Data handling and classification (refer to data classifications used by the Cognigate Policy Engine: `pii_email`, `pii_ssn`, `credentials`)
- Physical security responsibilities for remote and on-site work

**Cognigate-Specific Security Modules:**

- **Proof Chain Integrity:** Understanding the PROOF plane's immutable SHA-256 hash chain and Ed25519 digital signatures (`app/core/signatures.py`). Personnel learn why proof records must not be modified, how chain integrity is verified, and what constitutes a chain integrity violation.

- **Trust Tier Model:** Comprehensive training on the 8-tier trust model: T0 Sandbox (0-199), T1 Observed (200-349), T2 Provisional (350-499), T3 Monitored (500-649), T4 Standard (650-799), T5 Trusted (800-875), T6 Certified (876-950), T7 Autonomous (951-1000). Personnel understand how trust levels govern velocity caps (`app/core/velocity.py`), policy rigor modes (STRICT for T0-T2, STANDARD for T3-T4, LITE for T5+), and tool access restrictions (e.g., shell execution requires T3 Monitored or higher per `basis-core-security` policy).

- **Circuit Breaker Operations:** Training on the circuit breaker subsystem (`app/core/circuit_breaker.py`), including the three circuit states (CLOSED, OPEN, HALF_OPEN), eight trip reasons (HIGH_RISK_THRESHOLD, INJECTION_DETECTED, CRITICAL_DRIFT, TRIPWIRE_CASCADE, ENTITY_MISBEHAVIOR, MANUAL_HALT, CRITIC_BLOCK_CASCADE, VELOCITY_ABUSE), auto-reset behavior, and the cascade halt mechanism for parent-child agent hierarchies.

- **Adversarial Detection Awareness:** Overview of the multi-layer security architecture: L0-L2 velocity caps, L3 deterministic tripwires (`app/core/tripwires.py`), L4 AI Critic adversarial analysis (`app/core/critic.py`), and L5 circuit breaker system protection. Personnel understand how these layers function together and the significance of the "ASSUME BAD INTENT" philosophy embedded in the Critic's system prompt.

- **Pipeline Architecture:** The 3-layer INTENT, ENFORCE, PROOF, CHAIN pipeline. Personnel understand that intent normalization happens before execution, enforcement evaluates policies without executing actions, and proof records create immutable audit trails for every governance decision.

### 2.3 Awareness Training Delivery

Training is delivered through a combination of:

- Self-paced modules in the organizational LMS
- Instructor-led sessions for Cognigate-specific topics (quarterly)
- Simulated security exercises (e.g., simulated prompt injection attempts, trust tier manipulation scenarios)
- Security bulletins and advisories distributed via internal channels when new threats to AI governance systems are identified

---

## 3. Insider Threat Awareness (AT-2(2))

### 3.1 Insider Threat Recognition Training

All personnel receive training on recognizing and reporting potential insider threats, with emphasis on threats specific to an AI governance platform.

**AI Critic "ASSUME BAD INTENT" Philosophy:**

The Cognigate Critic module (`app/core/critic.py`) operates on the principle of "ASSUME BAD INTENT until proven otherwise." This adversarial posture is a deliberate design choice documented in the Critic's system prompt. Personnel are trained to understand that this philosophy applies not only to AI agent behavior but to internal threat detection:

- The Critic evaluates plans with explicit instructions to "find problems, risks, and hidden dangers"
- It detects euphemisms: "'organize' might mean 'delete', 'optimize' might mean 'destroy'"
- It flags dangerous tool combinations: "shell + network = exfiltration risk"
- It considers worst-case interpretations: "What's the WORST interpretation of this request?"

**Trust Tier Manipulation Detection:**

Personnel are trained to recognize indicators of trust tier manipulation, including:

- Anomalous patterns of trust score progression for agent entities
- Attempts to register entities at inflated trust levels to bypass velocity caps or policy rigor
- Requests to override trust levels via the `trust_level` parameter in the `/v1/intent` endpoint without proper authorization
- Unauthorized use of admin endpoints (`/v1/admin/entity/halt`, `/v1/admin/circuit/reset`) to circumvent governance controls
- Attempts to bypass the circuit breaker via manual reset during active security investigations

**Behavioral Anomaly Recognition:**

Training covers recognition of anomalous patterns such as:

- Sudden increases in velocity violations for previously well-behaved entities
- Entities generating high volumes of "blocked" or "escalated" decisions
- Patterns of requests that individually appear benign but collectively indicate reconnaissance or privilege escalation
- Attempts to clear or modify proof chain records
- Unauthorized access to the Ed25519 private key material or signature management functions

### 3.2 Reporting Procedures

Personnel must report suspected insider threat activity through designated channels within 24 hours of recognition. Reports are logged, investigated, and tracked through the incident management process. Proof chain records provide tamper-evident audit trails that support insider threat investigations.

---

## 4. Social Engineering Awareness (AT-2(3))

### 4.1 Traditional Social Engineering Training

Personnel receive training on recognizing and resisting social engineering attacks, including:

- Phishing and spear-phishing (email, SMS, voice)
- Pretexting and impersonation
- Baiting and quid pro quo attacks
- Tailgating and physical social engineering

### 4.2 AI-Specific Social Engineering

Because Cognigate governs AI agent behavior, personnel must understand social engineering vectors unique to AI governance systems:

**Prompt Injection and Intent Manipulation:**

The INTENT layer includes PARANOIA MODE, which detects euphemisms and obfuscation in natural language goals. Training covers:

- How the tripwire subsystem (`app/core/tripwires.py`) uses deterministic regex patterns to catch obviously dangerous commands (e.g., `rm -rf /`, fork bombs, reverse shells, SQL injection patterns) before any LLM analysis occurs
- The Critic's role in detecting plans that use innocent language to mask destructive intent
- Euphemism detection: the system explicitly tracks keywords like "clear," "clean," "wipe," "purge," "organize," "tidy," "archive," "free up," and "reclaim" as potential substitutes for destructive operations
- System path awareness: mentions of `/root`, `/etc`, `/var`, `/usr`, `/bin`, `/sys`, combined with any action keyword, trigger elevated risk scoring

**Trust Exploitation:**

Training on how social engineering can target the trust model:

- Attackers may attempt to build trust slowly through legitimate-seeming operations before executing a high-risk action at an elevated trust tier
- The velocity cap system provides defense-in-depth: even higher-tier entities have burst limits and daily quotas proportional to their trust level
- Cascade halt capability means compromised parent agents and all their children can be halted simultaneously

**Agent Impersonation:**

- Attempts to register new entities that impersonate existing trusted agents
- Requests that claim elevated permissions based on association with known entities
- API key reuse or credential stuffing targeting the X-Admin-Key authentication mechanism

### 4.3 Simulated Social Engineering Exercises

Vorion conducts periodic simulated social engineering exercises, including:

- Simulated prompt injection attempts submitted through the `/v1/intent` endpoint
- Social engineering scenarios targeting operations personnel to disclose admin keys or perform unauthorized circuit breaker resets
- Red team exercises testing the Critic module's ability to detect obfuscated malicious intent

---

## 5. Role-Based Training (AT-3)

### 5.1 Developer Role

All developers working on the Cognigate codebase receive role-based security training covering:

**Secure Coding Practices:**

- OWASP Top 10 vulnerabilities and their mitigations in FastAPI/Python applications
- Input validation patterns (the Cognigate Policy Engine's `ExpressionEvaluator` uses safe evaluation with explicit namespace construction rather than `eval()`)
- Secure serialization: proof records use deterministic JSON serialization (`json.dumps(record_data, sort_keys=True, default=str)`) for signature consistency
- Cryptographic best practices: proper use of Ed25519 for signing, base64 encoding for signature transport, key management procedures

**Dependency Management:**

- Software Bill of Materials (SBOM) generation and maintenance (CycloneDX/SPDX)
- Vulnerability scanning of dependencies via CI/CD pipeline
- Approved dependency lists and the process for adding new dependencies
- Supply chain attack awareness (reference: SR family controls)

**Secrets Handling:**

- Gitleaks integration for pre-commit scanning to prevent credential leakage
- Environment variable management for sensitive configuration (API keys, Ed25519 private keys loaded via `SIGNATURE_PRIVATE_KEY` environment variable)
- Never logging private key material (the `SignatureManager.export_private_key_pem()` method carries explicit warnings)
- Admin key rotation procedures

**CI/CD Security:**

- Code review requirements before merge
- Automated security testing in the pipeline (97 automated security control tests)
- Branch protection rules and signed commits

### 5.2 Operator Role

Operations personnel responsible for running Cognigate in production receive training on:

**Circuit Breaker Management:**

- Monitoring the circuit breaker state via `/v1/admin/circuit` endpoint
- Understanding trip conditions: high-risk ratio exceeding 10%, tripwire cascade (3 triggers within 60 seconds), injection threshold (2 attempts), Critic block cascade (5 blocks)
- Procedures for manual halt (`/v1/admin/circuit/halt`) and manual reset (`/v1/admin/circuit/reset`)
- Auto-reset behavior (5-minute default) and the HALF_OPEN recovery testing protocol (3 successful requests required)
- Cascade halt procedures for parent-child agent hierarchies

**Incident Response:**

- Recognition of circuit breaker trip events as potential security incidents
- Escalation procedures when trip reasons indicate active attacks (INJECTION_DETECTED, CRITIC_BLOCK_CASCADE)
- Coordination with security personnel for entity-level and system-level incidents
- Evidence preservation from proof chain records

**Monitoring Dashboards:**

- Real-time status page (`/status`) interpretation: circuit breaker state, total requests, blocked requests, high-risk ratio
- Proof chain statistics: total records, chain length, integrity status
- Decision breakdown monitoring: allowed, denied, escalated, modified decisions
- Velocity statistics interpretation per entity

### 5.3 Administrator Role

System administrators with elevated privileges receive training on:

**Key Management:**

- Ed25519 key pair lifecycle: generation, storage, rotation, and revocation
- Key storage options: file-based PEM (production), base64-encoded environment variable (cloud deployment), ephemeral in-memory keys (development only, with explicit warnings)
- Key rotation procedures without proof chain integrity disruption
- Public key distribution for signature verification by consuming systems

**Entity Lifecycle Management:**

- Entity registration, trust score initialization, and deregistration procedures
- Trust tier assignment and the implications of each tier for velocity limits and policy rigor
- Entity halt and unhalt procedures via admin endpoints
- Entity violation threshold monitoring (10 violations trigger automatic entity halt)

**Trust Tier Override Procedures:**

- Authorization requirements for manual trust level overrides
- Documentation and proof chain recording of override decisions
- Risk implications of elevating trust tiers (wider velocity caps, relaxed policy rigor)

### 5.4 Security Role

Security personnel receive advanced training on:

**Adversarial Testing:**

- Red team procedures for testing the Critic module with novel attack patterns
- Tripwire pattern effectiveness validation and gap identification
- Prompt injection testing against the INTENT layer's PARANOIA MODE
- Testing circuit breaker trip conditions without disrupting production

**Penetration Testing:**

- API endpoint security testing (authentication, authorization, input validation)
- Trust model bypass testing
- Proof chain integrity attack simulation
- Velocity cap circumvention testing

**Compliance Monitoring:**

- Operating the CA-7 continuous monitoring program via `/v1/compliance/*` endpoints
- Understanding the evidence mapper's 234 mapping rules across 13 compliance frameworks
- OSCAL SSP and POA&M maintenance procedures
- FedRAMP 20x Key Security Indicator (KSI) evidence generation

---

## 6. Training Records (AT-4)

### 6.1 Record Maintenance

Vorion maintains comprehensive training records for all personnel, including:

- Personnel identification and role assignment
- Training course completed (course ID, title, version)
- Completion date and assessment results (pass/fail and score where applicable)
- Training delivery method (self-paced, instructor-led, exercise)
- Next required training date
- Role-based training requirements and completion status

### 6.2 Learning Management System Integration

Training records are maintained in the organizational Learning Management System (LMS), which provides:

- Automated enrollment based on role assignment
- Completion tracking and overdue notifications
- Training history retention per organizational retention schedule
- Reporting capabilities for compliance audits and authorization assessments

### 6.3 Proof Chain Integration

The Cognigate proof chain can record training-related events via the evidence mapper, providing:

- Cryptographically signed records of training completion events for key personnel
- Tamper-evident audit trail linking training completion to entity management privileges
- Evidence generation for compliance framework assessments (NIST 800-53, FedRAMP, SOC 2)

### 6.4 Annual Verification

The CISO or designee conducts an annual verification of training completion, confirming:

- All active personnel have completed required general awareness training within the past 12 months
- All personnel in specialized roles have completed applicable role-based training
- Personnel who have not completed required training within the specified timeframe have their access privileges reviewed and, if necessary, suspended until training is completed
- Training records are accurate, complete, and retained per the organizational retention schedule

---

## 7. Training Schedule and Frequency

| Training Type | Audience | Frequency | Delivery Method |
|---|---|---|---|
| General Security Awareness | All personnel | Annual (within 30 days of hire, then yearly) | LMS self-paced |
| Cognigate Platform Security | All Cognigate personnel | Annual + upon significant platform changes | LMS + instructor-led |
| Insider Threat Awareness | All personnel | Annual | LMS self-paced |
| Social Engineering Awareness | All personnel | Annual | LMS + simulated exercises |
| Secure Coding (Developer) | Developers | Annual + upon onboarding | LMS + instructor-led |
| CI/CD Security (Developer) | Developers | Annual | LMS self-paced |
| Circuit Breaker Operations (Operator) | Operators | Semi-annual | Instructor-led + tabletop |
| Incident Response (Operator) | Operators | Semi-annual | Tabletop exercises |
| Key Management (Administrator) | Administrators | Annual | Instructor-led |
| Entity Lifecycle (Administrator) | Administrators | Annual | Instructor-led |
| Adversarial Testing (Security) | Security team | Quarterly | Lab exercises |
| Compliance Monitoring (Security) | Security team | Semi-annual | Instructor-led |

---

## 8. Compliance Mapping

| NIST 800-53 Control | Implementation Status | Policy Section |
|---|---|---|
| **AT-1** Awareness and Training Policy and Procedures | **Implemented** | Section 2.1 |
| **AT-2** Literacy Training and Awareness | **Implemented** | Section 2.2, 2.3 |
| **AT-2(2)** Insider Threat | **Implemented** | Section 3 |
| **AT-2(3)** Social Engineering and Mining | **Implemented** | Section 4 |
| **AT-3** Role-Based Training | **Implemented** | Section 5 |
| **AT-4** Training Records | **Implemented** | Section 6 |

### Cross-Framework Mapping

| Framework | Control | Description |
|---|---|---|
| FedRAMP Moderate | AT-1 through AT-4 | Satisfied by this policy |
| SOC 2 Type II | CC1.4 | COSO Principle 4: Training and awareness |
| ISO 27001:2022 | A.6.3 | Information security awareness, education and training |
| NIST AI RMF | GOVERN 3.2 | Organizational personnel trained on AI risk management |
| EU AI Act | Art. 4 | AI literacy obligations for providers |

---

## 9. Metrics and Performance Indicators

| Metric | Target | Frequency | Data Source |
|--------|--------|-----------|-------------|
| Training completion rate (% within 30-day deadline) | >= 95% of personnel | Monthly | Learning Management System (LMS) |
| Security awareness assessment pass rate | >= 90% on first attempt | Quarterly | LMS assessment records |
| AI governance module completion rate (Cognigate-specific training) | 100% of Cognigate personnel | Quarterly | LMS, training records (Section 6) |
| Phishing simulation click-through rate | < 5% | Quarterly | Simulated phishing exercise results |

Metrics are reported monthly to the ISSO and quarterly to the Authorizing Official as part of the continuous monitoring program (VOR-POL-CONMON-001).

---

## 10. Policy Review and Maintenance

This policy is reviewed and updated:

- At least annually by the CISO
- Upon significant changes to the Cognigate platform (new security layers, trust model modifications, pipeline architecture changes)
- When new AI-specific threats or attack vectors are identified
- When regulatory requirements change (new compliance frameworks, updated NIST guidance)
- Following security incidents that reveal training gaps

**Approval:**

| Role | Name | Date |
|---|---|---|
| CISO | ___________________ | ________ |
| CTO | ___________________ | ________ |
| VP Engineering | ___________________ | ________ |
