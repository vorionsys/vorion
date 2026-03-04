# CISA Secure Software Attestation — Common Form

**Reference:** OMB Memorandum M-22-18 (September 2022) and M-23-16 (June 2023)  
**Form Version:** CISA Secure Software Attestation Common Form (October 2023 revision)  
**Classification:** PUBLIC  

---

## Part I — Software Producer Identification

| Field | Value |
|---|---|
| **Organization Name** | Vorion, Inc. |
| **DBA / Product Brand** | Vorion |
| **Legal Address** | United States |
| **Primary Contact** | Ryan Cason |
| **Contact Email** | Ryan@Vorion.org |
| **Contact Role** | Chief Executive Officer / Authorizing Official |

---

## Part II — Software Identification

| Field | Value |
|---|---|
| **Software Name** | Cognigate AI Agent Governance Engine |
| **Software Description** | SaaS platform providing trust scoring, policy enforcement, proof-chain auditing, and delegated-authority governance for AI agent systems operating under the BASIS (Behavioral AI Safety Interoperability Standard) specification. |
| **Version(s) Covered** | 2.0.0 and subsequent minor/patch releases until superseded by a new attestation |
| **CPE (Common Platform Enumeration)** | `cpe:2.3:a:vorion:cognigate:2.0.0:*:*:*:*:*:*:*` |
| **Deployment Mode** | Cloud-hosted SaaS (Vercel + Neon PostgreSQL); self-hosted Docker also available |
| **Repository** | https://github.com/vorionsys/vorion (private) |
| **SBOM Location** | `sbom-history/` directory; CycloneDX JSON format; generated per release via `@cyclonedx/cyclonedx-npm` |
| **Primary Frameworks** | NIST SP 800-53 Rev 5, NIST AI RMF 1.0, FedRAMP Moderate, SOC 2 Type II, EU AI Act, ISO/IEC 42001 |

---

## Part III — Attestation of Conformance

By signing below, the undersigned executive of Vorion, Inc. (the "Software Producer") hereby attests, to the best of their knowledge and belief, that Vorion, Inc. conforms to the following secure software development practices as defined in the NIST Secure Software Development Framework (SSDF), SP 800-218 Rev 1, for the software product identified in Part II.

### PO — Prepare the Organization

| ID | Practice | Attestation |
|---|---|---|
| PO.1 | Define security requirements for software development. | ✅ **Attested.** Security requirements are defined in `compliance/control-registry.yaml` (97 KB) and mapped to all 13 regulatory frameworks. Security requirements are enforced via pull-request checks and policy engine rules. |
| PO.2 | Implement roles and responsibilities for software security. | ✅ **Attested.** Roles are defined in the SSP (OSCAL 1.1.2 `ssp-draft.json`): AO (Ryan Cason), ISSO (Alex Blanc), System Owner (Ryan Cason), and functional roles (system-administrator, auditor, agent-entity). |
| PO.3 | Implement supporting toolchains. | ✅ **Attested.** Toolchain includes: GitHub Actions CI/CD, CodeQL (SAST), Trivy (SCA/container), pip-audit + Bandit (Python), ESLint + TypeScript strict mode, Vitest + Playwright for automated testing, Stryker mutation testing, and SBOM generation via CycloneDX. |
| PO.4 | Define and use criteria for software security checks. | ✅ **Attested.** Branch protection on `main` requires all of: CI pass, CodeQL pass, secrets scan pass, and dependency review. Criteria are encoded in `.github/workflows/`. |
| PO.5 | Implement and maintain secure environments for software development. | ✅ **Attested.** Builds run in ephemeral GitHub Actions runners (Ubuntu, isolated). Secrets are managed via GitHub Actions secrets and environment variables; no secrets are stored in code. Mutation reports and SBOM outputs are `.gitignore`d. |

### PS — Protect the Software

| ID | Practice | Attestation |
|---|---|---|
| PS.1 | Protect all forms of code from unauthorized access and tampering. | ✅ **Attested.** Main branch is protected; all commits require review. DLP scanning via `@vorion/security` prevents credential leakage. Signed releases are planned for v2.1. |
| PS.2 | Provide a mechanism for verifying software integrity. | ✅ **Attested.** Every release generates a CycloneDX SBOM stored in `sbom-history/`. SHA-256 checksums are recorded for release artifacts. The PROOF ledger provides an internal dual-hash chain (SHA-256 + Ed25519) for runtime audit events. |
| PS.3 | Archive and protect each software release. | ✅ **Attested.** Releases are tagged via `release.yml` GitHub Actions workflow, Docker images are versioned, and SBOM history is retained in the repository under `sbom-history/`. |

### PW — Produce Well-Secured Software

| ID | Practice | Attestation |
|---|---|---|
| PW.1 | Design software to meet security requirements and mitigate security risks. | ✅ **Attested.** Threat model is documented in `docs/SECURITY.md` and `SECURITY_GAMEPLAN.md`. Architecture decisions including TEE hardening, trust-dynamics, semantic governance, and proof-chain are documented in `PHASE-6-ARCHITECTURE-DECISIONS.md`. |
| PW.2 | Review the software design to verify compliance with security requirements. | ✅ **Attested.** Architecture review is part of the sprint cycle. Security-relevant design changes require a dedicated `PHASE-*-ARCHITECTURE-DECISIONS.md` document before merge. |
| PW.3 | Reuse existing, well-secured software where feasible. | ✅ **Attested.** Dependencies are managed via `package.json` (npm) and `requirements.txt` (pip). Dependency review action blocks PRs introducing HIGH/CRITICAL vulnerabilities or GPL-3.0/AGPL-3.0 licenses. |
| PW.4 | Create source code by following secure coding practices. | ✅ **Attested.** TypeScript strict mode enforced via `tsconfig.json`. ESLint with security rules enforced in `eslint.config.mjs`. Bandit enforced for Python with medium-severity threshold. |
| PW.5 | Create comprehensive test cases for the software. | ✅ **Attested.** Test suite includes: >400 unit/integration tests (Vitest), E2E tests (Playwright), mutation testing (Stryker, >60% mutation score target), and performance tests (k6). Test coverage is tracked via Codecov (`codecov.yml`). |
| PW.6 | Configure the compilation, interpreter, and build processes to improve software security. | ✅ **Attested.** TypeScript compiler runs in strict mode. Build outputs are deterministic. Docker multi-stage builds separate build and runtime layers. `Dockerfile.lite` ships a minimal runtime image. |
| PW.7 | Review and/or analyze human-readable code to identify vulnerabilities. | ✅ **Attested.** CodeQL semantic analysis runs on every push to `main` and every PR (`security-scan.yml`). Queries include `security-extended` and `security-and-quality` packs. Results appear in the GitHub Security tab as SARIF findings. |
| PW.8 | Test executable code to identify vulnerabilities. | ✅ **Attested.** Trivy filesystem scan runs on every PR checking CRITICAL and HIGH CVEs. Results are uploaded as SARIF to the GitHub Security tab. pip-audit scans Python dependencies on `main` pushes. |
| PW.9 | Configure software to have secure settings by default. | ✅ **Attested.** Cognigate defaults: authentication required, delegation chains require explicit grant, agent trust scores default to `0.0` (untrusted) until positive signal accumulation, rate limiting enforced, CORS restricted. |

### RV — Respond to Vulnerabilities

| ID | Practice | Attestation |
|---|---|---|
| RV.1 | Identify and confirm vulnerabilities on an ongoing basis. | ✅ **Attested.** CodeQL, Trivy, pip-audit, and Bandit scans run on CI. A weekly scheduled scan runs every Monday at 06:00 UTC (`security-scan.yml`). Dependency Review action runs on all PRs. |
| RV.2 | Assess, prioritize, and remediate vulnerabilities. | ✅ **Attested.** Vulnerabilities are tracked in the OSCAL Plan of Action and Milestones (`compliance/oscal/poam.json`). Critical findings block merge. High findings require a documented remediation plan within 30 days. |
| RV.3 | Analyze vulnerabilities to identify their root causes. | ✅ **Attested.** Post-incident reviews are documented in the POAM with root-cause analysis fields. Vulnerability disclosure policy is published at `security.txt` and `SECURITY.md`. |

---

## Part IV — Vulnerability Disclosure Policy

Vorion, Inc. maintains a public vulnerability disclosure policy:

- **Disclosure document:** [`SECURITY.md`](../SECURITY.md) in the repository root
- **Machine-readable policy:** [`security.txt`](../security.txt) (RFC 9116)
- **Reporting email:** security@vorion.org
- **Response SLA:** Critical findings acknowledged within 24 hours; remediation patch within 14 days for Critical, 30 days for High

---

## Part V — Software Bill of Materials (SBOM)

SBOMs are generated per release in CycloneDX JSON format and stored in `sbom-history/`:

| Field | Value |
|---|---|
| **Format** | CycloneDX 1.4 JSON |
| **Generation tool** | `@cyclonedx/cyclonedx-npm` |
| **Availability** | On request to Ryan@Vorion.org for government customers; public releases available via GitHub Release assets |
| **Minimum components covered** | All production npm dependencies + Python packages |

---

## Part VI — Known Exceptions and Deviations

| SSDF Practice | Exception | Justification | Remediation Plan |
|---|---|---|---|
| PS.1 (signed commits/releases) | Release signing (GPG/Sigstore) not yet enforced | Pre-revenue startup; signing infrastructure planned | Target: v2.1 (Q3 2026) — `sigstore/cosign` integration planned in `release.yml` |
| PO.5 (air-gapped build environment) | Builds run on GitHub-hosted runners (shared infrastructure) | GitHub-hosted runners provide sufficient isolation for current risk tier | Evaluate self-hosted runners when FedRAMP Low authorization is pursued |

---

## Part VII — Signature and Attestation

I, the undersigned, am an authorized representative of Vorion, Inc. and have the authority to make this attestation on behalf of Vorion, Inc. I hereby certify that the statements made in this attestation are accurate and complete to the best of my knowledge and belief.

| Field | Value |
|---|---|
| **Signatory Name** | Ryan Cason |
| **Title** | Chief Executive Officer |
| **Organization** | Vorion, Inc. |
| **Date of Attestation** | 2026-02-20 |
| **Attestation Covers** | Cognigate AI Agent Governance Engine v2.0.0 |
| **Next Review Date** | 2027-02-20 (annual review) or upon major version release |

> **Note:** This attestation is provided electronically. A wet-ink or digitally signed PDF version is available upon request to Ryan@Vorion.org for government procurement purposes.

---

## Appendix A — Supporting Documentation Index

| Document | Location | Description |
|---|---|---|
| OSCAL SSP | `compliance/oscal/ssp-draft.json` | OSCAL 1.1.2 System Security Plan, 313 controls |
| Control Registry | `compliance/control-registry.yaml` | Multi-framework control mapping (13 frameworks) |
| OSCAL POAM | `compliance/oscal/poam.json` | Plan of Action and Milestones |
| OSCAL Assessment Plan | `compliance/oscal/assessment-plan.json` | Continuous assessment approach |
| SBOM History | `sbom-history/` | CycloneDX SBOMs per release |
| Security Policy | `SECURITY.md` | Vulnerability disclosure policy |
| Threat Model | `SECURITY_GAMEPLAN.md` | Threat analysis and mitigations |
| Architecture Decisions | `PHASE-6-ARCHITECTURE-DECISIONS.md` | Security-relevant architecture choices |
| CI/CD Workflows | `.github/workflows/` | Automated security toolchain configuration |
| CodeQL Analysis | `.github/workflows/security-scan.yml` | SAST + SCA configuration |

---

*This document is maintained by: Vorion Compliance Engineering*  
*Classification: PUBLIC*  
*Last Updated: 2026-02-20*
