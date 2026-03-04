# Vorion Cognigate -- System Maintenance Policy

**Document ID:** VOR-POL-MA-001
**Version:** 1.0.0
**Effective Date:** 2026-02-19
**Last Reviewed:** 2026-02-19
**Next Review:** 2027-02-19
**Owner:** Vorion Security Engineering
**Classification:** PUBLIC
**Applicable Controls:** MA-1, MA-2, MA-3, MA-3(1), MA-3(2), MA-3(3), MA-5

---

## 1. Purpose, Scope, and Applicability

### 1.1 Purpose

This policy establishes the maintenance requirements for the Vorion Cognigate AI Agent Governance Runtime. It defines how Cognigate is maintained, what tools are authorized for maintenance activities, how maintenance personnel are controlled, and how maintenance records are preserved.

Because Cognigate is a cloud-native SaaS application deployed on Vercel with no physical hardware managed by Vorion, "maintenance" in this policy refers exclusively to **software maintenance**: code updates, dependency patches, configuration changes, database schema migrations, and security remediation. Physical infrastructure maintenance is inherited from cloud service providers (Vercel, AWS, Neon) and is addressed separately in the inherited controls documentation.

### 1.2 Scope

This policy applies to:

- All software changes to the Cognigate Engine codebase (`cognigate-api/`)
- Dependency updates and security patches for runtime and development dependencies
- Database schema migrations for PostgreSQL (Neon) and SQLite
- Configuration changes to Vercel environment variables, GitHub Actions workflows, and deployment settings
- CI/CD pipeline modifications that affect build, test, or deployment processes
- Security tool updates (Semgrep rule sets, CodeQL queries, Gitleaks configurations)

### 1.3 Applicability

This policy applies to all Vorion personnel, contractors, and automated systems (CI/CD pipelines, bots) that perform maintenance on Cognigate. It does not apply to consumer organizations that deploy applications on top of Cognigate's governance API -- those organizations are responsible for their own maintenance policies for their integration code.

### 1.4 Inherited Controls

The following maintenance responsibilities are inherited from cloud service providers and are outside the scope of this policy:

| Provider | Inherited Responsibility |
|----------|--------------------------|
| **Vercel** | Serverless runtime patching, edge network maintenance, TLS certificate rotation, CDN infrastructure |
| **AWS (via Vercel)** | Compute infrastructure, hypervisor patching, physical server maintenance, network hardware |
| **Neon** | PostgreSQL engine patching, database server maintenance, storage infrastructure, automated backups |
| **GitHub** | Git hosting infrastructure, Actions runner maintenance, security advisory database updates |

---

## 2. Policy Statements

### 2.1 MA-1: Maintenance Policy and Procedures

**Control Requirement:** Develop, document, and disseminate a maintenance policy; review and update annually.

**Cognigate Implementation:**

a. This document constitutes the formal maintenance policy for the Cognigate system. It is maintained in the compliance repository at `compliance/policies/maintenance-policy.md` under version control.

b. This policy is reviewed **annually** by Vorion Security Engineering, or sooner when triggered by:
   - A significant architecture change (new cloud provider, database migration, new deployment target)
   - A security incident involving the maintenance pipeline
   - A change in regulatory requirements affecting maintenance controls
   - Addition or removal of a CI/CD security scanning tool

c. Maintenance procedures are codified in:
   - GitHub Actions workflows (`.github/workflows/ci-python.yml`, `.github/workflows/security-scan.yml`, `.github/workflows/deploy.yml`) that define the automated maintenance pipeline
   - Architecture Decision Records (ADRs) documenting maintenance-relevant design choices
   - The BASIS specification (`docs/basis-docs/`) which governs system behavior contracts

d. Policy dissemination occurs through:
   - Repository access: all authorized maintainers have read access to this policy in the compliance directory
   - Onboarding: new team members are directed to the compliance policies as part of repository access provisioning
   - Change notifications: pull requests modifying this policy require review from the security team

### 2.2 MA-2: Controlled Maintenance

**Control Requirement:** Schedule, document, review, and approve maintenance activities; maintain records.

**Cognigate Implementation:**

a. **All maintenance follows the CI/CD pipeline.** No changes reach production without traversing:

   1. **Pull Request** -- Developer creates a PR against the `master` branch. The PR description documents the maintenance purpose, scope, and testing approach.
   2. **Automated Testing** -- GitHub Actions executes the full test suite (97 tests, pytest) with coverage validation. Tests exercise all three governance layers (INTENT, ENFORCE, PROOF).
   3. **SAST Scanning** -- Semgrep performs static analysis for security vulnerabilities, injection patterns, and suspicious constructs. CodeQL runs semantic security analysis on JavaScript/TypeScript components.
   4. **Secret Detection** -- Gitleaks scans all committed code for accidentally included credentials, API keys, private keys, or tokens.
   5. **Dependency Audit** -- pip-audit and Trivy check all dependencies against vulnerability databases (OSV, NVD).
   6. **Code Review** -- At least one authorized maintainer must approve the PR before merge.
   7. **Merge to Master** -- Approved PRs are merged (no force-push permitted due to branch protection).
   8. **Deployment** -- Vercel automatically deploys from `master` using zero-downtime rolling updates.

b. **Maintenance records** are preserved in:
   - Git history: complete record of every change with author, timestamp, commit message, and diff
   - Pull request records: review comments, approval decisions, CI/CD results, and merge metadata
   - GitHub Actions logs: tool execution records with versions, inputs, outputs, and pass/fail status
   - Vercel deployment logs: deployment timestamps, build logs, and deployment status

c. **Maintenance scheduling:**
   - Routine dependency updates: monthly, aligned with security advisory review cycles
   - Security patches: within 72 hours of critical vulnerability disclosure; within 14 days for high severity
   - Feature releases: as needed, following the standard CI/CD pipeline
   - Database migrations: coordinated with deployment, using versioned migration scripts

d. **Maintenance approval authority:**
   - Routine updates: any authorized maintainer may approve
   - Security patches: Vorion Security Engineering approval required
   - Architecture changes: require ADR documentation and team-level review
   - CI/CD pipeline changes: require security team review

### 2.3 MA-3: Maintenance Tools

**Control Requirement:** Approve, control, and monitor the use of maintenance tools.

**Cognigate Implementation:**

a. **Approved maintenance tools** are defined in version-controlled configuration files:

   | Tool | Purpose | Configuration Source |
   |------|---------|---------------------|
   | Python 3.11+ | Runtime and development | `cognigate-api/pyproject.toml` |
   | pip | Package management | `cognigate-api/requirements.txt` |
   | pytest 8.0+ | Test execution | `cognigate-api/pyproject.toml` [dev] |
   | Ruff | Linting | `cognigate-api/pyproject.toml` |
   | Black | Code formatting | `cognigate-api/pyproject.toml` |
   | mypy | Type checking | `cognigate-api/pyproject.toml` |
   | Semgrep | SAST scanning | `.github/workflows/ci-python.yml` |
   | CodeQL | Semantic security analysis | `.github/workflows/security-scan.yml` |
   | Gitleaks | Secret detection | `.github/workflows/secrets-scan.yml` |
   | Trivy | Vulnerability scanning | `.github/workflows/security-scan.yml` |
   | pip-audit | Dependency vulnerability scanning | CI pipeline |
   | Git | Version control | Repository-level |
   | GitHub Actions | CI/CD orchestration | `.github/workflows/*.yml` |
   | Vercel CLI | Deployment management | `vercel.json` |

b. **Tool inventory** is maintained through:
   - Runtime dependencies: `cognigate-api/requirements.txt` (pinned versions)
   - Development dependencies: `cognigate-api/pyproject.toml` `[project.optional-dependencies.dev]`
   - CI/CD tools: GitHub Actions workflow files with pinned action versions (e.g., `actions/checkout@v4`, `github/codeql-action/init@v3`)

c. **Unauthorized tool prevention:**
   - Only tools referenced in workflow files and dependency manifests execute in the CI/CD pipeline
   - GitHub Actions runners are ephemeral (destroyed after each job), preventing persistent unauthorized tool installation
   - Branch protection prevents modifying workflow files without PR review

### 2.4 MA-3(1): Inspect Maintenance Tools

**Control Requirement:** Inspect maintenance tools for improper or unauthorized modifications.

**Cognigate Implementation:**

a. **Dependency integrity verification:**
   - pip installs from PyPI with hash verification when `--require-hashes` mode is enabled
   - All runtime dependencies in `requirements.txt` specify exact version pins (e.g., `fastapi==0.128.0`, `uvicorn==0.40.0`, `pydantic==2.12.5`)
   - pip-audit validates all installed packages against the OSV vulnerability database before every deployment
   - Dependabot monitors the dependency graph and alerts on newly disclosed vulnerabilities

b. **CI/CD tool integrity:**
   - GitHub Actions uses pinned action versions with SHA-based references for critical actions
   - Semgrep rules are loaded from the verified Semgrep registry with version pinning
   - CodeQL queries use the `security-extended,security-and-quality` query suites maintained by GitHub
   - GitHub Actions runners are GitHub-hosted, ephemeral, and provisioned from verified base images

c. **Source integrity:**
   - Git commit signing verifies that maintenance changes originate from authorized developer accounts
   - Branch protection rules on `master` prevent force-pushes, ensuring the commit history is append-only and tamper-evident

### 2.5 MA-3(2): Media Inspection for Malicious Code

**Control Requirement:** Check media containing diagnostic and test programs for malicious code before use.

**Cognigate Implementation:**

Since Cognigate has no physical media, this control is satisfied through scanning of all digital artifacts (code, dependencies, configuration) before they enter the production environment:

a. **SAST scanning of all code changes:**
   - Semgrep scans every pull request for security vulnerabilities, injection patterns (SQL injection, command injection, XSS), insecure cryptographic usage, and hardcoded secrets
   - CodeQL performs deep semantic analysis of code for data-flow vulnerabilities, taint tracking, and security-relevant code patterns
   - Scanning runs on every PR and weekly on the `master` branch (scheduled cron: `0 6 * * 1`)

b. **Dependency scanning:**
   - pip-audit checks all Python dependencies (runtime and dev) against the Open Source Vulnerability (OSV) database
   - Trivy performs filesystem vulnerability scanning at `CRITICAL,HIGH` severity levels, with results uploaded to GitHub Security (SARIF format)
   - GitHub Dependency Review blocks PRs that introduce dependencies with known vulnerabilities

c. **Secret detection:**
   - Gitleaks scans all committed code, including test files, scripts, and configuration, for patterns matching credentials, API keys, private keys, JWT tokens, and connection strings
   - Detected secrets block the PR from merging

d. **No bypass mechanism:** All scanning jobs are required to pass before a PR can be merged. Branch protection rules enforce this as a mandatory status check.

### 2.6 MA-3(3): Prevent Unauthorized Removal

**Control Requirement:** Prevent the unauthorized removal of maintenance equipment containing organizational information.

**Cognigate Implementation:**

For a cloud SaaS system, "equipment containing organizational information" maps to source code, database contents, configuration, and proof chain records. Cognigate prevents unauthorized extraction through:

a. **Source code protection:**
   - The Cognigate repository is private on GitHub, accessible only to authorized organization members
   - Branch protection prevents force-push to `master`, maintaining an append-only, auditable history
   - All commits are attributed to authenticated GitHub accounts

b. **Database extraction prevention:**
   - PostgreSQL (Neon) databases are accessible only through authenticated API connections; no direct SQL access is permitted from outside the Vercel deployment environment
   - Application-layer access controls enforce data isolation through SQLAlchemy query scoping and trust-tier authorization middleware
   - Bulk data export from the PROOF chain requires administrative API authentication (X-Admin-Key)

c. **Configuration protection:**
   - Environment variables (ADMIN_KEY, database credentials, API keys) are stored in Vercel's encrypted environment variable store
   - Environment variables are not readable through the application runtime (only available as process environment)
   - Vercel audit logs track all team member access to project settings

d. **Audit trail:**
   - Git history provides a tamper-evident record of all code changes
   - GitHub audit logs record repository access events, permission changes, and administrative actions
   - Vercel deployment logs record all deployment activities

### 2.7 MA-5: Maintenance Personnel

**Control Requirement:** Establish a process for authorizing maintenance personnel; maintain a list of authorized personnel.

**Cognigate Implementation:**

a. **Authorized maintenance personnel** are defined through platform access controls:

   | Access Level | Platform | Authorization Mechanism | Capabilities |
   |-------------|----------|------------------------|--------------|
   | **Developer** | GitHub | Organization team membership, `write` role | Create branches, submit PRs, run CI |
   | **Reviewer** | GitHub | CODEOWNERS file designation | Approve PRs, required reviewer for protected paths |
   | **Admin** | GitHub | Organization `admin` role | Manage branch protection, team membership, repository settings |
   | **Deployer** | Vercel | Team membership with deploy role | Trigger deployments, manage environment variables |
   | **DB Admin** | Neon | Project member with admin role | Database schema changes, backup management |
   | **System Admin** | Cognigate | Possession of X-Admin-Key | Runtime administrative API operations |

b. **Personnel authorization process:**
   - New maintainers are added to the GitHub organization by an existing admin
   - Access level is assigned based on role (developer, reviewer, admin) per the principle of least privilege
   - All platform accounts (GitHub, Vercel, Neon) require individual identification and multi-factor authentication
   - MFA is mandatory for all accounts with write access or above

c. **Personnel monitoring:**
   - GitHub organization audit log tracks all membership changes, permission grants, and repository access
   - Vercel team audit log tracks all team membership and access changes
   - Access reviews are conducted quarterly to verify that all authorized maintainers still require their access level

d. **Personnel deauthorization:**
   - When a maintainer leaves the organization or changes roles, their platform access is revoked within 24 hours
   - If the departing maintainer had X-Admin-Key access, the admin key is rotated
   - Deauthorization is documented in the access review records

---

## 3. Maintenance Windows and Scheduling

### 3.1 Routine Maintenance

| Activity | Frequency | Window | Impact |
|----------|-----------|--------|--------|
| Dependency updates | Monthly | Any business day | Zero-downtime (rolling deploy) |
| Security patches (Critical) | Within 72 hours | Immediate | Zero-downtime (rolling deploy) |
| Security patches (High) | Within 14 days | Any business day | Zero-downtime (rolling deploy) |
| Database migrations | As needed | Coordinated with release | Typically zero-downtime; major schema changes may require brief maintenance |
| CI/CD pipeline updates | As needed | Any business day | No production impact |
| Semgrep rule updates | Monthly | Any business day | No production impact |

### 3.2 Vercel Deployment Characteristics

Vercel provides zero-downtime deployments through its serverless architecture:
- New deployments are built and validated before receiving traffic
- Traffic is atomically shifted from the old deployment to the new deployment
- Failed deployments do not receive traffic; rollback is instantaneous via Vercel dashboard
- Preview deployments allow validation before production promotion

---

## 4. Emergency Maintenance Procedures

### 4.1 Triggering Conditions

Emergency maintenance is initiated when:
- A critical vulnerability is disclosed in a Cognigate dependency (CVSS 9.0+)
- A security incident is detected in the production environment
- The PROOF chain integrity is compromised or verification fails
- The circuit breaker trips system-wide due to a systemic issue
- Cognigate API availability drops below the 99.9% SLA target

### 4.2 Emergency Procedure

1. **Triage:** Vorion Security Engineering assesses the severity and scope of the issue
2. **Hotfix Branch:** A hotfix branch is created from `master`
3. **Expedited Review:** Security team provides expedited code review (single reviewer sufficient for emergency patches)
4. **Abbreviated Testing:** Critical path tests must pass; full test suite may be deferred to a follow-up PR if immediate remediation is required
5. **Emergency Deploy:** Merge to `master` triggers automatic Vercel deployment
6. **Rollback Readiness:** Previous deployment remains available for instant rollback via Vercel
7. **Post-Incident:** Within 48 hours, a post-incident review documents:
   - Root cause analysis
   - Changes made during emergency maintenance
   - Any deferred testing or review items
   - Lessons learned and preventive measures

### 4.3 Emergency Rollback

If an emergency deployment introduces a regression:
1. Revert to the previous deployment via Vercel dashboard (instant, zero-downtime)
2. Create a revert PR against `master` to restore the codebase to the pre-emergency state
3. Investigate the root cause before re-attempting the fix

---

## 5. Roles and Responsibilities

| Role | Responsibilities |
|------|-----------------|
| **Vorion Security Engineering** | Maintain this policy; review annually; approve security patches; conduct emergency maintenance triage; manage maintenance personnel authorization |
| **Developers** | Submit maintenance changes via PR; write tests for all changes; respond to CI/CD failures; document changes in PR descriptions |
| **Reviewers** | Review and approve PRs; verify CI/CD status checks pass; validate that changes are within approved scope |
| **DevOps / Platform** | Maintain CI/CD pipeline configuration; manage Vercel deployment settings; coordinate database maintenance windows with Neon |
| **Cloud Providers (Vercel, AWS, Neon)** | Physical infrastructure maintenance; runtime patching; storage management; network infrastructure |

---

## 6. Compliance Mapping

This policy satisfies or contributes to the following NIST SP 800-53 Rev 5 controls:

| Control | Title | How This Policy Satisfies |
|---------|-------|--------------------------|
| **MA-1** | Policy and Procedures | This document; annual review commitment; version-controlled procedures in CI/CD workflows |
| **MA-2** | Controlled Maintenance | CI/CD pipeline enforces controlled, documented, reviewed, and approved maintenance for all changes |
| **MA-3** | Maintenance Tools | Approved tool inventory in requirements.txt, pyproject.toml, and GitHub Actions workflows |
| **MA-3(1)** | Inspect Tools | pip hash verification, version pinning, pinned GitHub Actions versions, ephemeral runners |
| **MA-3(2)** | Media Inspection | Semgrep SAST, CodeQL semantic analysis, Gitleaks secret detection, Trivy vulnerability scanning on every PR |
| **MA-3(3)** | Prevent Unauthorized Removal | Private repository, branch protection, database access controls, encrypted environment variables |
| **MA-5** | Maintenance Personnel | Platform-based access control (GitHub, Vercel, Neon), MFA requirement, quarterly access reviews |

### Cross-Framework Applicability

| Framework | Relevant Controls |
|-----------|-------------------|
| FedRAMP Moderate | MA-1 through MA-5 (identical to NIST 800-53) |
| ISO 27001:2022 | A.8.9 (Configuration management), A.8.32 (Change management) |
| SOC 2 Type II | CC6.1 (Logical access), CC8.1 (Change management) |
| CMMC 2.0 Level 2 | MA.L2-3.7.1 through MA.L2-3.7.6 |

---

## 7. Metrics and Performance Indicators

| Metric | Target | Frequency | Data Source |
|--------|--------|-----------|-------------|
| Maintenance window compliance rate (% changes via CI/CD pipeline) | 100% | Monthly | Git history, GitHub Actions logs, Vercel deployment logs |
| Pre/post maintenance security scan pass rate | >= 99% | Per maintenance event | CodeQL, Trivy, Semgrep, Gitleaks scan results |
| Emergency maintenance frequency | < 2 per quarter | Quarterly | Incident tracking system, Git hotfix branch history |
| Maintenance tool authorization compliance (% tools on approved list) | 100% | Monthly | `pyproject.toml`, `requirements.txt`, `.github/workflows/*.yml` |

Metrics are reported monthly to the ISSO and quarterly to the Authorizing Official as part of the continuous monitoring program (VOR-POL-CONMON-001).

---

## 8. Document History

| Version | Date | Author | Change Description |
|---------|------|--------|--------------------|
| 1.0.0 | 2026-02-19 | Vorion Security Engineering | Initial policy document |

---

## 9. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Information System Security Officer (ISSO) | _________________ | _________________ | ________ |
| System Owner | _________________ | _________________ | ________ |
| Authorizing Official | _________________ | _________________ | ________ |

---

*This document is part of the Vorion Cognigate NIST SP 800-53 Rev 5 compliance evidence package. For the full OSCAL SSP, see `compliance/oscal/ssp-draft.json`.*
