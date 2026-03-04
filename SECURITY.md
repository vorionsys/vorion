# Security Policy

**Vorion** takes the security of our software and platform seriously. This document outlines our security policy, supported versions, and vulnerability reporting process.

---

## Supported Versions

We provide security updates for the latest minor release of each active major version.

| Package | Version Range | Supported |
|---------|---------------|-----------|
| `@vorionsys/shared-constants` | Latest 0.x | :white_check_mark: Yes |
| `@vorionsys/contracts` | Latest 0.x | :white_check_mark: Yes |
| `@vorionsys/cognigate` | Latest 0.x | :white_check_mark: Yes |
| `@vorionsys/car-spec` | Latest 1.x | :white_check_mark: Yes |
| `@vorionsys/atsf-core` | Latest 0.x | :white_check_mark: Yes |
| `@vorionsys/basis` | Latest 0.x | :white_check_mark: Yes |
| Platform (apps/*) | Latest release | :white_check_mark: Yes |
| All packages | Older minors | :x: No |

> Only the latest minor release within each major version receives security patches. We recommend upgrading to the latest supported version promptly.

---

## Reporting a Vulnerability

If you discover a security vulnerability in Vorion, please report it responsibly through our private disclosure process.

### How to Report

**Email:** [security@vorion.org](mailto:security@vorion.org)

> **Do NOT open a public GitHub issue for security vulnerabilities.** Public disclosure of unpatched vulnerabilities puts all users at risk.

### What to Include

Please provide as much of the following information as possible to help us triage and resolve the issue efficiently:

- **Description** -- A clear explanation of the vulnerability and the affected component(s)
- **Reproduction Steps** -- Detailed, step-by-step instructions to reproduce the issue
- **Impact Assessment** -- Your evaluation of the potential security impact (e.g., data exposure, privilege escalation, denial of service)
- **Affected Versions** -- Which package versions or platform components are affected
- **Proof of Concept** -- Code, screenshots, or logs demonstrating the issue (if available)
- **Suggested Fix** -- Recommended remediation approach (if any)

### Response Timeline

| Stage | Timeline |
|-------|----------|
| Acknowledgment | Within **48 hours** of receipt |
| Triage and initial assessment | Within **7 business days** |
| Fix development | Based on severity (see below) |
| Patch release | Coordinated with reporter |
| Public disclosure | After fix is deployed or per disclosure timeline |

### Severity Classification

We follow the [CVSS v3.1](https://www.first.org/cvss/v3.1/specification-document) scoring system:

| Severity | CVSS Score | Target Resolution |
|----------|------------|-------------------|
| **Critical** | 9.0 -- 10.0 | Emergency patch within 48 hours |
| **High** | 7.0 -- 8.9 | Fix within current sprint |
| **Medium** | 4.0 -- 6.9 | Fix within next release cycle |
| **Low** | 0.1 -- 3.9 | Scheduled for next maintenance window |

---

## Scope

### In Scope

The following are covered by this security policy:

- All `@vorionsys/*` npm packages published to the npm registry
- Vorion platform applications (everything under `apps/`)
- Vorion APIs and backend services
- Authentication and authorization systems
- The PROOF evidence chain and trust scoring model
- CI/CD pipelines and build infrastructure
- Documentation that may inadvertently expose secrets or internal details

### Out of Scope

The following are **not** covered and should be reported to their respective maintainers:

- **Third-party dependencies** -- Report vulnerabilities in upstream packages (e.g., via npm, Snyk, or the maintainer's own security policy). We monitor these via automated scanning but do not patch them directly.
- **Third-party services** -- Issues in Supabase, Vercel, GitHub, or other SaaS providers should be reported to those providers.
- **Social engineering attacks** against Vorion employees or contributors
- **Denial of service** attacks that do not exploit a software vulnerability
- **Issues in archived or deprecated packages** (see Supported Versions above)

---

## Responsible Disclosure

Vorion follows a coordinated disclosure policy:

- **90-day disclosure timeline** -- We request that reporters allow up to 90 days from the initial report before public disclosure, giving us time to develop, test, and deploy a fix.
- **Credit and recognition** -- Security researchers who report valid vulnerabilities will be credited in our security advisories, unless they request anonymity.
- **Safe harbor** -- We will not pursue legal action against individuals who discover and report security vulnerabilities in good faith, provided they:
  - Make a good-faith effort to avoid privacy violations, data destruction, and service disruption
  - Do not access or modify data belonging to other users
  - Do not exploit the vulnerability beyond what is necessary to demonstrate the issue
  - Report the vulnerability promptly through the channels described above

---

## Security Architecture

Vorion is a governed AI execution platform built on control theory principles (STPA). Our security architecture is designed around the following core tenets:

### Core Security Principles

| Principle | Description |
|-----------|-------------|
| **Multi-Tenant Isolation** | Row-Level Security (RLS) in PostgreSQL ensures strict tenant boundary enforcement. All database queries are scoped by `tenant_id`. |
| **Zero-Trust Model** | Every request is authenticated and authorized regardless of source. No implicit trust between components. |
| **Cryptographic Auditability** | The PROOF system provides an immutable, dual-hash (SHA-256 + SHA3-256) append-only evidence chain for every governance decision. |
| **Separation of Powers** | No single component can define rules (BASIS), execute actions (Cognigate), and record evidence (PROOF). |
| **Fail Secure** | All systems default to deny on failure. |

### Trust Scoring Model

Vorion implements a **16-factor trust scoring model** across an **8-tier system (T0--T7)** on a 0--1000 point scale:

| Tier | Score Range | Name | Autonomy Level |
|------|------------|------|----------------|
| T0 | 0 -- 199 | Sandbox | Isolated environment, no external access |
| T1 | 200 -- 349 | Observed | Read-only operations, fully monitored |
| T2 | 350 -- 499 | Provisional | Basic operations with supervision |
| T3 | 500 -- 649 | Monitored | Standard operations with active monitoring |
| T4 | 650 -- 799 | Standard | External API access, policy-governed |
| T5 | 800 -- 875 | Trusted | Cross-agent communication enabled |
| T6 | 876 -- 950 | Certified | Administrative tasks, minimal oversight |
| T7 | 951 -- 1000 | Autonomous | Full autonomy, self-governance |

Trust scores decay over inactivity using a stepped decay model with a 182-day half-life.

### Data Protection

- **Encryption at rest** -- AES-256-GCM for all stored data, with tenant-specific keys managed via KMS/HSM
- **Encryption in transit** -- TLS 1.3 enforced for all external connections; mTLS for service-to-service communication
- **Cryptographic signatures** -- Ed25519/ECDSA signatures on all proof records
- **SBOM generated for every release** -- Full software bill of materials produced in CI

For a comprehensive technical overview, see the [Security Whitepaper](docs/VORION_V1_FULL_APPROVAL_PDFS/SECURITY_WHITEPAPER_ENTERPRISE.md) and [Security Overview](docs/security/SECURITY.md).

---

## Dependency Security

Vorion maintains rigorous supply chain security practices:

- **Automated dependency scanning** -- Dependabot alerts are enabled across all repositories; Renovate is used for automated dependency update PRs
- **SAST in CI** -- [Semgrep](https://semgrep.dev/) static analysis runs on every push and pull request, with blocking rules for high-severity findings
- **Secret scanning** -- Gitleaks scans every commit; secrets in source control are a blocking CI failure
- **License compliance** -- Automated license checking in CI ensures no incompatible licenses enter production
- **npm audit** -- Critical and high severity vulnerabilities in production dependencies are blocking
- **No known critical vulnerabilities** -- Production dependencies must be free of known critical vulnerabilities before release
- **SBOM generation** -- Software Bill of Materials produced on every release via the [`sbom.yml`](.github/workflows/sbom.yml) workflow

---

## Compliance

Vorion is committed to meeting enterprise security and AI governance standards:

| Framework | Status |
|-----------|--------|
| **SOC 2 Type II** | In progress |
| **GDPR** | Compliant |
| **NIST AI RMF** | Aligned (Govern, Map, Measure, Manage) |
| **EU AI Act** | Prepared -- ceiling enforcement caps for high-risk AI systems |
| **ISO/IEC 42001** | In progress -- AI management system alignment |
| **AI TRiSM** | Compliant |

For detailed compliance mappings, see:

- [NIST AI RMF Compliance Mapping](docs/compliance/nist-ai-rmf-mapping.md)
- [ISO 42001 Gap Analysis](docs/VORION_V1_FULL_APPROVAL_PDFS/ISO_42001_GAP_ANALYSIS.md)
- [AI TRiSM Compliance Mapping](docs/VORION_V1_FULL_APPROVAL_PDFS/AI_TRISM_COMPLIANCE_MAPPING.md)

---

## Security Practices

### Static Analysis and CI

- Semgrep SAST on every push (blocking)
- CodeQL analysis via GitHub Advanced Security
- Gitleaks secret scanning on every commit
- npm audit with critical/high blocking thresholds
- License compliance checking in CI

### Authentication and Authorization

- Supabase Auth with Row-Level Security (RLS) for tenant isolation
- JWT (RS256/ES256) with 15-minute token lifetime
- Multi-factor authentication (WebAuthn/FIDO2, TOTP) for elevated access
- API key authentication with 90-day maximum lifetime and per-key scoping

### Infrastructure

- All secrets managed via GitHub Secrets and Vercel Environment Variables
- No secrets committed to source control; `.env` files excluded via `.gitignore`
- Proof chain integrity verifiable via `/api/v1/verify/:proof_hash`

---

## Security.txt

A machine-readable security policy is available at [`security.txt`](security.txt), following the [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116) standard.

---

## Contact

- **Security reports:** [security@vorion.org](mailto:security@vorion.org)
- **General support:** [support@agentanchorai.com](mailto:support@agentanchorai.com)
- **Documentation:** [learn.vorion.org](https://learn.vorion.org)

---

*Maintained by Vorion. Last updated: 2026-02-23.*
