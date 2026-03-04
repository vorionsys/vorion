# Vorion Cognigate -- Incident Response Plan

**Document ID:** VOR-POL-IR-001
**Version:** 1.0
**Classification:** INTERNAL
**Effective Date:** 2026-02-19
**Last Reviewed:** 2026-02-19
**Next Review:** 2027-02-19
**Owner:** Vorion Security Engineering
**Approver:** System Owner, Vorion Cognigate

**NIST SP 800-53 Rev 5 Controls Satisfied:**
IR-2, IR-3, IR-3(2), IR-6(3)

---

## 1. Purpose and Scope

### 1.1 Purpose

This Incident Response Plan establishes the training, testing, and coordination procedures for responding to security incidents affecting the Vorion Cognigate AI Agent Governance Runtime. It defines how the organization prepares its personnel to detect, respond to, and recover from incidents -- with particular emphasis on incidents unique to AI governance systems, including trust tier manipulation, proof chain tampering, policy bypass attempts, and supply chain compromises.

This plan satisfies:
- **IR-2:** Incident response training for personnel with assigned roles and responsibilities
- **IR-3:** Testing of the incident response capability, including coordination with related plans
- **IR-3(2):** Coordination of incident response testing with organizational elements responsible for related plans
- **IR-6(3):** Supply chain incident information sharing and coordination

### 1.2 Scope

This plan covers all security incidents affecting components within the Cognigate authorization boundary:

- The three-layer governance pipeline (INTENT, ENFORCE, PROOF)
- The PROOF chain integrity (SHA-256 hash chain, Ed25519 signatures)
- The 8-tier trust model (T0 Sandbox through T7 Autonomous)
- The circuit breaker and autonomous safety halt subsystem
- The Policy Engine (BASIS rule evaluation)
- The data layer (PostgreSQL/Neon, Redis cache)
- The CI/CD pipeline (GitHub Actions, Semgrep, CodeQL, Gitleaks)
- Third-party dependencies and supply chain components

This plan is coordinated with the Contingency Plan (VORION-CP-001). Incidents that result in service disruption may trigger contingency plan activation as described in Section 5.

### 1.3 Relationship to Other Controls

Cognigate's incident response capability builds on existing implemented controls:

- **IR-4 (Incident Handling):** Automated incident handling through circuit breaker trip detection, velocity anomaly alerting, and proof chain integrity monitoring
- **IR-5 (Incident Monitoring):** Continuous monitoring via the `/v1/admin/status` endpoint, circuit breaker metrics, and proof chain statistics
- **IR-6 (Incident Reporting):** Automated reporting through structured logging (structlog), circuit breaker trip events, and the admin API

This plan addresses the training, testing, and supply chain coordination aspects that complement those technical controls.

---

## 2. Incident Classification

### 2.1 Severity Levels

Incidents are classified by severity based on their impact on Cognigate's governance mission and the confidentiality, integrity, and availability of the system.

#### Critical (Severity 1)

Immediate threat to governance integrity. Autonomous AI agent actions may be proceeding without proper governance controls. Requires immediate response.

**Examples specific to Cognigate:**

- **Proof chain tampering:** A hash mismatch or invalid signature is detected in the PROOF chain, indicating potential modification of governance decision records. The non-repudiation guarantee is compromised.
- **Signing key compromise:** Evidence that the Ed25519 private key has been exposed. All proof records signed with the compromised key lose their integrity assurance.
- **Trust tier manipulation:** An agent's trust score is modified outside the normal behavioral scoring process, allowing it to operate at a higher trust tier (e.g., jumping from T2 Provisional to T6 Certified) without earning the trust through behavioral history.
- **Policy engine bypass:** An agent action is processed without passing through the ENFORCE layer, circumventing all BASIS policy evaluation and trust gate checks.
- **Complete circuit breaker failure:** The circuit breaker fails to trip despite threshold conditions being met (e.g., high-risk ratio exceeds 10% but no trip occurs), allowing potentially dangerous actions to proceed unchecked.

#### High (Severity 2)

Significant degradation of governance capability. Some governance controls are weakened but the system is still providing partial enforcement. Requires response within 1 hour.

**Examples:**

- **Circuit breaker abuse:** Repeated attempts to trigger or prevent circuit breaker trips to manipulate system availability. For example, an adversary deliberately pushes the high-risk ratio just below the 10% threshold to avoid tripping.
- **Velocity cap evasion:** An entity bypasses rate limiting by rotating identifiers or exploiting the velocity tracking window boundaries.
- **Adversarial pattern detection by AI Critic:** The AI Critic component identifies a coordinated attack pattern across multiple agent identities that individually stay within policy bounds but collectively represent a policy violation.
- **Database integrity issue:** PostgreSQL data corruption affecting trust scores or policy configurations, not reaching the level of proof chain tampering.
- **Unauthorized admin API access:** Attempted or successful access to `/v1/admin/*` endpoints without valid `X-Admin-Key` authentication.

#### Medium (Severity 3)

Limited impact on governance operations. A control is weakened but compensating controls remain effective. Requires response within 4 hours.

**Examples:**

- **Elevated false positive rate:** The ENFORCE layer is incorrectly blocking legitimate agent actions at an abnormally high rate, degrading service quality without compromising security.
- **Cache poisoning attempt:** An attempt to inject invalid policy configurations or trust scores into the Redis cache layer.
- **Single entity trust score anomaly:** A single agent's trust score shows unexpected volatility that does not match its behavioral history but has not resulted in improper access.
- **SAST/CodeQL finding in CI/CD:** A security finding is detected in the code pipeline that has not yet reached production.
- **Degraded-mode operational issues:** Problems with database connectivity that would affect service availability if the primary database experienced disruption.

#### Low (Severity 4)

Minimal immediate impact. A potential vulnerability or policy violation that does not currently affect governance operations. Requires response within 24 hours.

**Examples:**

- **Dependency vulnerability disclosure:** A CVE is published for a third-party dependency used by Cognigate, with no evidence of exploitation.
- **Anomalous but benign traffic patterns:** Unusual request patterns that do not trigger any policy violations or circuit breaker conditions.
- **Configuration drift detection:** A non-security configuration parameter has drifted from the documented baseline.
- **Documentation gap:** An operational procedure is found to be missing from runbooks during a routine review.

### 2.2 Classification Decision Tree

```
Is governance integrity compromised?
  YES --> Can agents operate without proper controls?
    YES --> CRITICAL
    NO  --> HIGH
  NO  --> Is a security control weakened?
    YES --> Are compensating controls effective?
      YES --> MEDIUM
      NO  --> HIGH
    NO  --> Is there a potential future vulnerability?
      YES --> LOW
      NO  --> Not an incident (log and monitor)
```

---

## 3. Incident Response Team

### 3.1 Team Structure

| Role | Responsibility | Authority |
|------|---------------|-----------|
| **Incident Commander** | Directs response; makes final decisions on containment, eradication, and recovery actions; manages communication | Authorizes containment actions up to and including system shutdown; authorizes external communication |
| **Security Analyst** | Investigates the incident; collects and preserves evidence; performs technical analysis; identifies root cause | Access to all system logs, proof chain records, and administrative APIs for investigation purposes |
| **DevOps Responder** | Executes technical containment and recovery actions; manages system configuration changes; coordinates with cloud providers | Authority to modify system configuration, deploy patches, and execute recovery procedures during an active incident |
| **Communications Lead** | Manages internal and external communications; drafts customer notifications; coordinates regulatory reporting | Drafts communications for Incident Commander approval; no authority to send without IC authorization |
| **Security Officer** | Ensures incident response actions comply with security policy; advises on regulatory obligations; manages evidence chain of custody | Advisory authority; can recommend escalation to Critical if security implications are identified |

### 3.2 Activation Thresholds

| Severity | Team Activation | Notification |
|----------|----------------|-------------|
| Critical | Full team activated immediately | System Owner notified within 15 minutes |
| High | Security Analyst + DevOps Responder activated within 1 hour; IC on standby | System Owner notified within 2 hours |
| Medium | Security Analyst investigates; DevOps Responder on standby | Standard reporting through daily security summary |
| Low | Assigned to Security Analyst backlog | Tracked in issue management system |

---

## 4. Detection

Cognigate provides multiple detection mechanisms for security incidents, each targeting different attack vectors relevant to AI governance systems.

### 4.1 Circuit Breaker Trips

The circuit breaker (`app/core/circuit_breaker.py`) monitors system-wide safety metrics and automatically trips when thresholds are exceeded. Each trip reason maps to a potential incident class:

| Trip Reason | Threshold | Potential Incident |
|-------------|-----------|-------------------|
| `HIGH_RISK_THRESHOLD` | >10% of actions are high-risk (risk_score >= 0.7) in 5-minute window | Coordinated attack or system misconfiguration |
| `INJECTION_DETECTED` | 2+ injection attempts in 5-minute window | Active injection attack against governed agents |
| `CRITICAL_DRIFT` | Detected by trust engine | Trust model integrity compromise |
| `TRIPWIRE_CASCADE` | 3+ tripwire triggers in 60-second window | Automated probing or exploitation attempt |
| `ENTITY_MISBEHAVIOR` | 10+ violations by a single entity | Compromised or rogue agent |
| `CRITIC_BLOCK_CASCADE` | 5+ AI Critic blocks in 5-minute window | Coordinated adversarial behavior pattern |
| `VELOCITY_ABUSE` | Velocity cap exceeded repeatedly | Rate limiting evasion or denial-of-service |
| `MANUAL_HALT` | Administrator action | Response to external intelligence or precautionary halt |

When any trip occurs, it is logged at the CRITICAL level via structlog, including the trip reason, entity ID (if applicable), details, and the auto-reset timestamp (default: 5 minutes).

### 4.2 Velocity Anomalies

The velocity tracking system monitors per-entity request rates and flags anomalies:

- Sudden spikes in request volume from a single entity
- Request patterns that approach but do not exceed rate limits (threshold probing)
- Unusual temporal patterns (e.g., sustained high-volume requests at off-peak hours)

### 4.3 Proof Chain Integrity Failures

The PROOF plane provides continuous integrity monitoring:

- **Real-time verification:** Each new proof record's `previous_hash` is verified against the most recent record at creation time
- **Scheduled verification:** Full chain traversal runs on a configurable schedule (default: every 4 hours)
- **On-demand verification:** Available via `GET /v1/proof/{id}/verify` for individual record verification

Any integrity failure generates an immediate alert and triggers assessment for a Critical-severity incident.

### 4.4 Adversarial Pattern Detection via AI Critic

The AI Critic component analyzes agent behavior patterns across multiple dimensions:

- Cross-entity correlation: Identifies coordinated behavior across multiple agent identities
- Behavioral drift: Detects gradual changes in an agent's action patterns that may indicate compromise
- Policy boundary testing: Flags agents that systematically probe the boundaries of their permitted actions
- Escalation pattern analysis: Identifies agents that repeatedly trigger ESCALATE verdicts in patterns suggesting automated probing

Critic blocks that reach the cascade threshold (5 in a 5-minute window) trigger a circuit breaker trip.

### 4.5 CI/CD Pipeline Security Alerts

The CI/CD pipeline provides pre-production detection:

- **Semgrep SAST:** Static analysis for security vulnerabilities in application code
- **CodeQL:** Semantic code analysis for vulnerability patterns
- **Gitleaks:** Detection of secrets, credentials, or signing keys in code commits
- **Dependabot:** Automated dependency vulnerability scanning

Findings from pipeline security tools are triaged within 24 hours and classified per Section 2.

---

## 5. Response Procedures

### 5.1 Critical Incident Response

**Response time target:** Immediate (within 15 minutes of detection)

**Phase 1: Containment (0-30 minutes)**

1. **Verify the incident:** Confirm the alert is not a false positive by cross-referencing multiple detection sources (circuit breaker state, proof chain verification, application logs).
2. **Activate circuit breaker (if not already tripped):** Execute `POST /v1/admin/circuit/halt` with a descriptive reason. This blocks all new governance requests system-wide.
3. **Isolate affected components:**
   - If proof chain tampering: Halt all proof record creation; switch ENFORCE to cache-only mode
   - If signing key compromise: Rotate the Ed25519 key immediately via Vercel environment variable update and redeployment; mark all records signed with the compromised key as "verification pending"
   - If trust tier manipulation: Freeze all trust score updates; revert affected entities to T0 Sandbox
   - If policy bypass: Enable STRICT rigor mode for all trust levels; disable LITE mode
4. **Preserve evidence:** Snapshot the current database state, circuit breaker metrics, and application logs before any recovery actions modify them.
5. **Notify the Incident Commander** (if not already activated).

**Phase 2: Analysis (30 minutes - 4 hours)**

1. **Determine scope:** Identify all affected proof records, entities, and time windows.
2. **Identify root cause:** Analyze logs, proof chain records, circuit breaker trip history, and application behavior.
3. **Assess impact:** Determine whether any governed AI agent took actions that would not have been permitted under proper governance.
4. **Document findings:** Create an incident timeline with all evidence references.

**Phase 3: Eradication and Recovery (4-24 hours)**

1. **Remove the threat:** Patch the vulnerability, revoke compromised credentials, block malicious entities.
2. **Restore integrity:** Re-verify the proof chain; re-sign affected records if the signing key was rotated; recalculate trust scores from verified behavioral history.
3. **Validate recovery:** Run the full proof chain verification procedure (Appendix C of the Contingency Plan); confirm all three pipeline endpoints operate correctly.
4. **Gradual restoration:** Reset the circuit breaker to HALF_OPEN first, allowing limited requests; monitor for recurrence; close the circuit only after stability is confirmed.

**Phase 4: Post-Incident (24-72 hours)**

See Section 8.

### 5.2 High Incident Response

**Response time target:** Within 1 hour of detection

1. **Assess and classify:** Security Analyst reviews the alert, confirms severity, and determines if escalation to Critical is warranted.
2. **Contain:** Apply targeted containment (e.g., halt a specific entity via `POST /v1/admin/entity/{id}/halt`, tighten velocity caps, or enable STRICT rigor mode for affected trust levels) without system-wide circuit breaker trip.
3. **Investigate:** Analyze the specific attack vector; correlate with circuit breaker metrics and proof chain records.
4. **Remediate:** Apply fixes, update policies, adjust thresholds as needed.
5. **Monitor:** Enhanced monitoring for 48 hours after remediation.

### 5.3 Medium Incident Response

**Response time target:** Within 4 hours of detection

1. **Triage:** Security Analyst reviews and confirms classification.
2. **Investigate:** Determine root cause and scope during normal working hours.
3. **Remediate:** Apply fixes through the standard change management process (PR review, CI/CD pipeline).
4. **Verify:** Confirm the fix is effective through testing.

### 5.4 Low Incident Response

**Response time target:** Within 24 hours of detection

1. **Log:** Create a tracking issue in the issue management system.
2. **Assess:** Security Analyst reviews during normal triage cycle.
3. **Plan:** Schedule remediation in the next appropriate sprint/release.
4. **Execute:** Remediate through standard development workflow.

---

## 6. Evidence Preservation

### 6.1 Evidence Sources

The following evidence sources are preserved for every incident, proportional to severity:

| Source | Content | Retention | Format |
|--------|---------|-----------|--------|
| PROOF chain records | Immutable governance decision records for the incident window | Permanent (part of the proof chain) | JSON with SHA-256 hashes and Ed25519 signatures |
| PROOF ledger snapshots | Point-in-time export of the proof chain database | Minimum 1 year; permanent for Critical incidents | Encrypted PostgreSQL dump + proof chain export format |
| Circuit breaker trip history | All trip events with reason, timestamp, entity ID, and metrics | 1 year | JSON (from `GET /v1/admin/circuit/history`) |
| Application logs (structlog) | Structured application logs including all security-relevant events | 90 days in log aggregation; 1 year in cold storage for incidents | JSON structured logs |
| CI/CD pipeline logs | Build, test, and deployment logs from GitHub Actions | 90 days in GitHub; exported to cold storage for incidents | GitHub Actions log format |
| Vercel deployment logs | Runtime logs from serverless function execution | 30 days in Vercel; exported for incidents | Vercel log format |
| Database audit logs | PostgreSQL query logs and Neon access logs | 90 days | PostgreSQL log format |
| Git history | Code changes, PR reviews, and approval records | Permanent | Git repository |

### 6.2 Evidence Handling

- **Chain of custody:** All evidence collected during an incident is tracked with collector name, collection timestamp, and storage location.
- **Integrity protection:** Evidence exports are hashed (SHA-256) at collection time; the hash is recorded in the incident record. Any subsequent access to the evidence must verify the hash.
- **Access control:** Incident evidence is accessible only to the Incident Response Team and authorized auditors. Access is logged.
- **Immutability:** PROOF chain records are inherently immutable (append-only, hash-chained, signed). They serve as the primary evidence source for governance-related incidents.

### 6.3 Cognigate-Specific Evidence

For incidents involving AI governance integrity, the following Cognigate-specific evidence is collected:

- **Trust score history:** The complete trust score trajectory for affected entities, including all score changes, decay events, and boost events
- **Policy evaluation traces:** The complete policy evaluation context for affected governance decisions, including which policies were checked, which matched, and the final verdict
- **Circuit breaker metrics snapshot:** The metrics window state at the time of the incident, including total requests, high-risk ratio, blocked requests, and all violation counters
- **Entity behavioral profile:** The behavioral history of any entity involved in the incident, including compliance rate, velocity patterns, and temporal consistency

---

## 7. Communication

### 7.1 Internal Escalation

| Severity | Notification Timeline | Recipients |
|----------|----------------------|------------|
| Critical | Immediate (within 15 minutes) | Incident Response Team, System Owner, Security Officer |
| High | Within 1 hour | Security Analyst, DevOps Responder, Security Officer |
| Medium | Within 4 hours (or next business day) | Security Analyst, DevOps Responder |
| Low | Next triage cycle | Security Analyst |

**Escalation path:** On-call Engineer --> Security Analyst --> DevOps Responder --> Incident Commander --> System Owner

### 7.2 Customer Notification

Consumer organizations that rely on Cognigate for inherited governance controls are notified when:

- A Critical incident affects the integrity of governance decisions applied to their agents
- Service availability drops below the SLA threshold
- A proof chain integrity issue affects records associated with their governed agents
- A signing key rotation occurs that affects verification of their agents' proof records

**Notification timeline:**
- Critical with customer impact: Within 4 hours of confirmation
- High with customer impact: Within 24 hours
- Medium: Included in the next monthly security summary
- Low: No individual notification; included in quarterly security report

**Notification content:**
- Incident summary (without exposing internal security details)
- Impact assessment specific to the customer's governed agents
- Actions taken and current status
- Any actions required by the customer (e.g., re-verification of proof records)

### 7.3 Regulatory Reporting

If the incident involves:
- Personal data exposure: Report per GDPR Article 33 (72-hour notification to supervisory authority) and applicable data protection regulations
- FedRAMP-scoped systems: Report per FedRAMP Incident Communications Procedures
- Material security breach: Report per applicable securities regulations

The Communications Lead drafts regulatory notifications for Incident Commander and Security Officer approval.

---

## 8. Post-Incident Activities

### 8.1 Post-Incident Review

A post-incident review is conducted within 72 hours of incident closure for Critical and High incidents, and within 2 weeks for Medium incidents.

**Review agenda:**
1. **Timeline reconstruction:** Build a detailed timeline from detection through resolution, including all decisions and actions.
2. **Root cause analysis:** Identify the underlying cause (not just the proximate trigger). Use the "5 Whys" method or fault tree analysis as appropriate.
3. **Detection effectiveness:** Evaluate how the incident was detected, how long detection took, and whether detection could be improved.
4. **Response effectiveness:** Assess whether response procedures were followed, whether they were adequate, and where they fell short.
5. **Impact assessment:** Final determination of the incident's impact on governance integrity, data confidentiality/integrity/availability, and customer trust.

### 8.2 Lessons Learned

Post-incident reviews produce documented lessons learned that address:

- **Control updates:** New or modified security controls to prevent recurrence. For Cognigate, this includes updates to circuit breaker thresholds, velocity caps, policy rules, or trust scoring parameters.
- **Detection improvements:** New alerting rules, monitoring dashboards, or automated detection logic.
- **Procedure updates:** Modifications to this Incident Response Plan, the Contingency Plan, or operational runbooks.
- **Training needs:** Identification of knowledge gaps revealed during the incident.

### 8.3 Trust Tier Adjustments

For incidents involving AI agent behavior:

- Entities involved in the incident are reviewed for trust tier adjustment
- If an entity's behavior contributed to the incident, its trust score is reduced per the trust decay algorithm
- If the incident revealed that an entity was operating at an inappropriately high trust tier, its tier is permanently capped until re-certification
- Trust tier adjustments resulting from incidents are recorded in the proof chain as governance decisions with the incident ID as context

### 8.4 Metrics Tracking

The following metrics are tracked across all incidents:

- Mean Time to Detect (MTTD)
- Mean Time to Respond (MTTR)
- Mean Time to Recover (MTTRec)
- Incident count by severity and category
- Percentage of incidents detected by automated systems vs. manual discovery
- Circuit breaker effectiveness (ratio of legitimate trips to false trips)

Metrics are reported quarterly and feed into the continuous monitoring program (CA-7).

---

## 9. Training Program (IR-2)

### 9.1 Training Requirements

All personnel with incident response responsibilities receive training commensurate with their role. Training addresses both general security incident response and Cognigate-specific scenarios.

| Training Type | Audience | Frequency | Duration | Delivery |
|---------------|----------|-----------|----------|----------|
| IR fundamentals | All engineering staff | Annually | 2 hours | Online self-paced + quiz |
| Cognigate-specific IR | Incident Response Team | Semi-annually | 4 hours | Instructor-led with lab exercises |
| Incident Commander training | Designated ICs | Annually | 8 hours | Instructor-led with tabletop scenarios |
| New hire IR orientation | New engineering hires | Within 30 days of hire | 2 hours | Paired with experienced team member |
| Tabletop exercises | All IR roles | Quarterly | 2 hours | Facilitated group exercise |
| Red team debrief | Incident Response Team | Annually (post-exercise) | 2 hours | Presentation and discussion |

### 9.2 Cognigate-Specific Training Content

Training for the Incident Response Team includes the following Cognigate-specific modules:

1. **Proof chain forensics:** How to investigate proof chain integrity failures, interpret hash chain breaks, verify Ed25519 signatures, and use the chain verification API endpoints.
2. **Trust model incident analysis:** Understanding trust score manipulation vectors, interpreting trust decay and boost patterns, and identifying anomalous trust tier transitions.
3. **Circuit breaker operations:** Understanding trip reasons and thresholds, interpreting circuit breaker metrics, executing manual halt and reset procedures via the admin API.
4. **Policy engine incident response:** Identifying policy bypass attempts, analyzing policy evaluation traces, and implementing emergency policy changes.
5. **AI-specific attack patterns:** Prompt injection attacks against governed agents, adversarial behavior patterns, coordinated multi-agent attacks, and trust tier gaming strategies.
6. **Evidence collection from Cognigate:** Procedures for collecting and preserving proof chain records, trust score histories, circuit breaker metrics, and policy evaluation traces.

### 9.3 Training Records

Training completion records are maintained and include:

- Trainee name and role
- Training type and date completed
- Trainer/facilitator identification
- Assessment results (pass/fail for knowledge checks)
- Identified knowledge gaps and remediation plans
- Expiration date for recertification

Records are retained for a minimum of 3 years and are available for audit.

### 9.4 Training Effectiveness Assessment

Training effectiveness is assessed through:

- **Knowledge checks:** Quizzes administered after each training module (80% passing score required)
- **Exercise performance:** Observations during tabletop exercises and drills
- **Incident performance:** Post-incident reviews assess whether personnel followed trained procedures
- **Annual assessment:** Security Officer reviews training program effectiveness annually and recommends updates

---

## 10. Testing Program (IR-3)

### 10.1 Test Schedule

| Test Type | Frequency | Scope | Participants |
|-----------|-----------|-------|-------------|
| Tabletop exercise | Quarterly | Walk-through of a specific incident scenario; discussion-based with no system changes | All IR roles |
| Functional test | Semi-annually | Execute IR procedures against a simulated incident in a staging environment | Incident Response Team |
| Red team exercise | Annually | External or internal adversarial team attempts to compromise Cognigate governance controls; IR team responds | Red team + IR team (no advance notice to IR team) |
| Supply chain incident drill | Annually | Simulate a dependency compromise scenario; exercise SBOM analysis and upstream coordination procedures | IR team + DevOps |
| Joint CP/IR exercise | Semi-annually | Combined incident response and contingency plan exercise; incident escalates to require contingency plan activation | All IR and CP roles |

### 10.2 Scenario Library

The following scenarios are maintained for testing rotation:

1. **Proof chain tampering:** A hash mismatch is injected into the proof chain database in the staging environment. The IR team must detect, contain, and recover.
2. **Signing key exposure:** A simulated Gitleaks alert indicates the Ed25519 private key was committed to a public repository. The IR team must rotate the key and assess impact.
3. **Trust tier escalation attack:** A simulated agent gradually increases its trust score through behavioral manipulation, eventually reaching T6 Certified from T2 Provisional. The IR team must detect the anomaly and respond.
4. **Circuit breaker manipulation:** A simulated attacker holds the high-risk ratio just below the 10% trip threshold while executing harmful actions. The IR team must identify the evasion technique and adjust thresholds.
5. **Supply chain compromise:** A simulated CVE in a critical dependency (e.g., the `cryptography` library used for Ed25519 operations) requires assessment, SBOM analysis, and coordinated response.
6. **Coordinated multi-agent attack:** Multiple simulated agents, individually compliant, collectively execute a policy violation detected by the AI Critic. The IR team must investigate and respond.
7. **Insider threat:** A simulated compromised admin API key is used to reset the circuit breaker and modify velocity caps. The IR team must detect and respond.

Scenarios are rotated to ensure all incident types are tested over a 2-year cycle.

### 10.3 Coordination with Related Plans (IR-3(2))

Incident response testing is coordinated with:

- **Contingency Plan testing (VORION-CP-001):** The semi-annual joint CP/IR exercise tests the interface between incident detection and contingency plan activation. The scenario begins as an incident and escalates to require service recovery.
- **Continuous monitoring (CA-7):** IR test results are reported as part of the continuous monitoring program. Detection gaps identified during tests are tracked as findings.
- **Configuration management:** IR tests verify that incident response actions (e.g., emergency deployments, configuration changes) follow the change management process or are properly documented as emergency changes.
- **Cloud provider exercises:** When Vercel or Neon conducts scheduled maintenance or DR exercises, Cognigate IR tests are coordinated to coincide where possible, testing the full stack under realistic conditions.

### 10.4 Test Documentation

Each test produces a report that includes:

- Test date, type, and scenario used
- Participants and their roles
- Timeline of detection, response, and recovery
- Findings: what worked, what did not, and what was missing
- Metrics: MTTD, MTTR achieved during the test
- Corrective actions with owners and due dates
- Updates to this plan, the Contingency Plan, or operational runbooks

Test reports are retained for 3 years and are available for audit review.

---

## 11. Supply Chain Coordination (IR-6(3))

### 11.1 Supply Chain Risk Context

Cognigate depends on third-party components that, if compromised, could affect governance integrity:

| Dependency Category | Key Components | Risk Level | Monitoring Mechanism |
|-------------------|----------------|------------|---------------------|
| Cryptographic libraries | `cryptography` (Ed25519), `hashlib` (SHA-256) | Critical | Dependabot alerts, CVE monitoring, SBOM-based impact analysis |
| Web framework | FastAPI, Uvicorn, Pydantic | High | Dependabot alerts, GitHub Security Advisories |
| Database drivers | SQLAlchemy, asyncpg, aiosqlite | High | Dependabot alerts |
| Cloud platform | Vercel (deployment), Neon (PostgreSQL) | High | Provider security advisories, status page monitoring |
| CI/CD security tools | Semgrep, CodeQL, Gitleaks | Medium | Tool vendor security advisories |
| Python runtime | CPython | High | Python security advisories, PSF notifications |

### 11.2 Dependency Vulnerability Monitoring

Cognigate employs multiple layers of dependency vulnerability monitoring:

1. **Dependabot:** Configured on the GitHub repository to automatically create pull requests for known vulnerable dependencies. Alerts are triaged within 24 hours (Critical/High CVEs) or 1 week (Medium/Low CVEs).

2. **SBOM-based impact analysis:** Cognigate maintains Software Bills of Materials in both CycloneDX and SPDX formats (see `compliance/sbom-compliance.yaml`). When a new CVE is published, the SBOM is queried to determine:
   - Whether the vulnerable component is present
   - Which version is installed vs. the affected version range
   - Whether the vulnerable code path is reachable from Cognigate's usage
   - Which Cognigate components are affected (INTENT, ENFORCE, PROOF, or infrastructure)

3. **Semgrep SAST:** Continuous static analysis detects patterns associated with known vulnerability classes, providing a secondary detection layer beyond dependency version checking.

4. **CodeQL:** Semantic analysis identifies vulnerability patterns in Cognigate's own code that could interact with supply chain vulnerabilities.

5. **Gitleaks:** Prevents accidental exposure of credentials or signing keys that could be exploited in conjunction with a supply chain attack.

### 11.3 Supply Chain Incident Response Procedure

When a supply chain vulnerability or compromise is identified:

**Step 1: Impact Assessment (within 4 hours for Critical/High CVEs)**
- Query the SBOM to confirm whether the affected component is used
- Determine the installed version and compare to the affected version range
- Assess whether the vulnerability is exploitable given Cognigate's usage patterns
- Classify the incident per Section 2

**Step 2: Containment (if exploitable)**
- If the vulnerability affects cryptographic operations (Ed25519, SHA-256): Assess whether any proof records may have been generated with compromised cryptographic output. If so, classify as Critical and follow Critical response procedures (Section 5.1).
- If the vulnerability affects the web framework or database drivers: Assess whether the vulnerability could allow request smuggling, injection, or authentication bypass. Apply emergency patches or WAF rules as interim containment.
- If the vulnerability affects CI/CD tools: Assess whether a compromised build pipeline could have introduced malicious code. Review recent deployments against known-good baselines.

**Step 3: Remediation**
- Update the affected dependency to a patched version
- Run the full CI/CD pipeline (including Semgrep, CodeQL, and Gitleaks) against the updated dependency
- Run the complete test suite (97 automated compliance tests) to verify no regressions
- Deploy the patched version through the standard deployment process

**Step 4: Upstream Notification**
- If Cognigate discovers a vulnerability in a dependency before a CVE is published, report it to the upstream maintainer through their coordinated disclosure process
- If Cognigate is affected by a supply chain compromise (e.g., a malicious package release), share indicators of compromise with the relevant security community (e.g., Python security mailing list, GitHub Security Advisories)

### 11.4 Downstream Notification

As an inherited control provider, Cognigate has a responsibility to notify consumer organizations when supply chain incidents affect the governance controls they inherit:

- **Notification trigger:** Any supply chain incident classified as High or Critical that is confirmed to affect Cognigate's governance enforcement or proof chain integrity
- **Notification content:** Affected component, CVE identifier (if applicable), impact on governance controls, actions taken, and any actions required by the consumer
- **Notification timeline:** Within 24 hours of confirmed impact for Critical; within 72 hours for High
- **Notification channel:** Dedicated security advisory channel established during customer onboarding

### 11.5 SBOM Maintenance

The SBOM is maintained as a living document:

- **Automated generation:** SBOMs in CycloneDX and SPDX formats are generated as part of the CI/CD pipeline on every release
- **Scope:** Includes all direct and transitive dependencies for the Cognigate application, development tools, and deployment infrastructure
- **Storage:** SBOMs are stored in the compliance artifacts repository and are available to consumer organizations upon request
- **Review:** The SBOM is reviewed quarterly to identify components that are end-of-life, unmaintained, or have a history of security issues

---

## 12. Plan Maintenance

### 12.1 Review Schedule

| Review Type | Frequency | Trigger |
|-------------|-----------|---------|
| Scheduled review | Annually | Calendar-based; coincides with annual security assessment |
| Post-incident review | After every Critical or High incident | Incident closure |
| Post-exercise review | After every IR test or exercise | Exercise completion |
| Triggered review | As needed | Architecture changes, new threat intelligence, regulatory changes |

### 12.2 Change Triggers

This plan must be reviewed and updated within 30 days of any of the following:

- A Critical or High incident that revealed gaps in response procedures
- Changes to the Cognigate architecture that affect detection or response capabilities (e.g., new governance pipeline layers, new data stores, changes to the circuit breaker)
- Changes to the threat landscape for AI governance systems (e.g., new attack techniques against trust models, new supply chain attack vectors)
- Changes to regulatory requirements affecting incident response (e.g., GDPR notification timelines, FedRAMP incident reporting requirements)
- Organizational changes affecting IR team composition or roles
- Changes to cloud service providers or their incident response interfaces
- Results from IR tests or exercises that identify plan deficiencies

### 12.3 Version Control

This plan is maintained under version control in the project repository at `compliance/policies/incident-response-plan.md`. All changes are tracked via Git commit history, reviewed via pull request, and approved by the Security Officer before merging. Major version changes (e.g., structural changes, new sections) require System Owner approval.

---

## 13. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Incident Response Coordinator | _________________ | _________________ | ________ |
| Information System Security Officer (ISSO) | _________________ | _________________ | ________ |
| Authorizing Official | _________________ | _________________ | ________ |

---

*This document is part of the Vorion Cognigate compliance evidence package. It is reviewed annually and updated as described in Section 12. For the machine-readable OSCAL SSP, see `compliance/oscal/ssp-draft.json`.*
