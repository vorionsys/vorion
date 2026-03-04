# Vorion Security Policy
## Source: SECURITY.md (Repository Root)

**Vorion** takes the security of our software and platform seriously. This document outlines our security policy, supported versions, and vulnerability reporting process.

---

## Supported Versions

We provide security updates for the latest minor release of each active major version.

| Package | Version Range | Supported |
|---------|---------------|-----------|
| `@vorionsys/shared-constants` | Latest 0.x | Yes |
| `@vorionsys/contracts` | Latest 0.x | Yes |
| `@vorionsys/cognigate` | Latest 0.x | Yes |
| `@vorionsys/car-spec` | Latest 1.x | Yes |
| `@vorionsys/atsf-core` | Latest 0.x | Yes |
| `@vorionsys/basis` | Latest 0.x | Yes |
| Platform (apps/*) | Latest release | Yes |
| All packages | Older minors | No |

Only the latest minor release within each major version receives security patches. We recommend upgrading to the latest supported version promptly.

---

## Reporting a Vulnerability

If you discover a security vulnerability in Vorion, please report it responsibly through our private disclosure process.

### How to Report

**Email:** security@vorion.org

**Do NOT open a public GitHub issue for security vulnerabilities.** Public disclosure of unpatched vulnerabilities puts all users at risk.

### What to Include

- **Description** -- A clear explanation of the vulnerability and the affected component(s)
- **Reproduction Steps** -- Detailed, step-by-step instructions to reproduce the issue
- **Impact Assessment** -- Your evaluation of the potential security impact
- **Affected Versions** -- Which package versions or platform components are affected
- **Proof of Concept** -- Code, screenshots, or logs demonstrating the issue
- **Suggested Fix** -- Recommended remediation approach

### Response Timeline

| Stage | Timeline |
|-------|----------|
| Acknowledgment | Within **48 hours** of receipt |
| Triage and initial assessment | Within **7 business days** |
| Fix development | Based on severity |
| Patch release | Coordinated with reporter |
| Public disclosure | After fix is deployed |

### Severity Classification (CVSS v3.1)

| Severity | CVSS Score | Target Resolution |
|----------|------------|-------------------|
| **Critical** | 9.0 -- 10.0 | Emergency patch within 48 hours |
| **High** | 7.0 -- 8.9 | Fix within current sprint |
| **Medium** | 4.0 -- 6.9 | Fix within next release cycle |
| **Low** | 0.1 -- 3.9 | Scheduled for next maintenance window |

---

## Responsible Disclosure

- **90-day disclosure timeline** -- We request 90 days before public disclosure
- **Credit and recognition** -- Reporters credited in security advisories
- **Safe harbor** -- No legal action against good-faith researchers who:
  - Make good-faith effort to avoid privacy violations, data destruction, and service disruption
  - Do not access or modify other users' data
  - Do not exploit beyond necessary demonstration
  - Report promptly through proper channels

---

## Security Architecture

Built on control theory principles (STPA).

### Core Security Principles

| Principle | Description |
|-----------|-------------|
| **Multi-Tenant Isolation** | Row-Level Security (RLS) in PostgreSQL, all queries scoped by tenant_id |
| **Zero-Trust Model** | Every request authenticated and authorized regardless of source |
| **Cryptographic Auditability** | PROOF system: immutable dual-hash (SHA-256 + SHA3-256) evidence chain |
| **Separation of Powers** | No single component can define rules, execute actions, AND record evidence |
| **Fail Secure** | All systems default to deny on failure |

### Trust Scoring Model

16-factor trust scoring model across an 8-tier system (T0-T7) on a 0-1000 point scale:

| Tier | Score Range | Name | Autonomy Level |
|------|------------|------|----------------|
| T0 | 0-199 | Sandbox | Isolated, no external access |
| T1 | 200-349 | Observed | Read-only, fully monitored |
| T2 | 350-499 | Provisional | Basic operations with supervision |
| T3 | 500-649 | Monitored | Standard operations, active monitoring |
| T4 | 650-799 | Standard | External API access, policy-governed |
| T5 | 800-875 | Trusted | Cross-agent communication enabled |
| T6 | 876-950 | Certified | Administrative tasks, minimal oversight |
| T7 | 951-1000 | Autonomous | Full autonomy, self-governance |

Trust scores decay over inactivity using a stepped decay model with a 182-day half-life.

### Data Protection

- **Encryption at rest** -- AES-256-GCM, tenant-specific keys via KMS/HSM
- **Encryption in transit** -- TLS 1.3 (external), mTLS (service-to-service)
- **Cryptographic signatures** -- Ed25519/ECDSA on all proof records
- **SBOM** -- Generated for every release

---

## Dependency Security

- **Automated scanning** -- Dependabot + Renovate for dependency updates
- **SAST in CI** -- Semgrep static analysis on every push/PR, blocking on high severity
- **Secret scanning** -- Gitleaks on every commit, blocking CI failure
- **License compliance** -- Automated checking in CI
- **npm audit** -- Critical/high severity = blocking
- **SBOM generation** -- Every release via sbom.yml workflow

---

## Compliance

| Framework | Status |
|-----------|--------|
| **SOC 2 Type II** | In progress |
| **GDPR** | Compliant |
| **NIST AI RMF** | Aligned (Govern, Map, Measure, Manage) |
| **EU AI Act** | Prepared -- ceiling enforcement for high-risk AI |
| **ISO/IEC 42001** | In progress |
| **AI TRiSM** | Compliant |

---

## Security Practices

### Static Analysis and CI
- Semgrep SAST on every push (blocking)
- CodeQL analysis via GitHub Advanced Security
- Gitleaks secret scanning on every commit
- npm audit with critical/high blocking thresholds
- License compliance checking

### Authentication and Authorization
- Supabase Auth with Row-Level Security (RLS)
- JWT (RS256/ES256) with 15-minute token lifetime
- MFA (WebAuthn/FIDO2, TOTP) for elevated access
- API key authentication with 90-day max lifetime and per-key scoping

### Infrastructure
- Secrets managed via GitHub Secrets and Vercel Environment Variables
- No secrets in source control; `.env` files excluded via `.gitignore`
- Proof chain integrity verifiable via `/api/v1/verify/:proof_hash`

---

**Contact:**
- Security reports: security@vorion.org
- General support: support@agentanchorai.com
- Documentation: learn.vorion.org

*Maintained by Vorion. Last updated: 2026-02-23.*
