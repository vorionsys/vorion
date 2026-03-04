# Vorion Cognigate Risk Assessment and Supply Chain Addendum

**Document ID:** VOR-POL-SR-001
**Version:** 1.0.0
**Effective Date:** 2026-02-19
**Classification:** PUBLIC
**Owner:** Vorion Security Engineering
**Review Cadence:** Annual (next review: 2027-02-19)
**Satisfies:** NIST SP 800-53 Rev 5 RA-5(11), SR-11(1)

---

## 1. Vulnerability Disclosure (RA-5.11)

### 1.1 Public Disclosure Channel

Vorion uses GitHub Security Advisories as the primary public disclosure channel for vulnerabilities affecting Cognigate and the broader Vorion platform. This channel provides:

- **Structured Reporting**: GitHub's advisory format captures CVE IDs, affected versions, severity ratings, and remediation guidance
- **Coordinated Disclosure**: Advisories can be drafted privately, shared with reporters, and published when remediation is available
- **Ecosystem Integration**: Published advisories automatically appear in the GitHub Advisory Database, enabling downstream consumers to detect affected versions via Dependabot and other tooling

### 1.2 Automated Vulnerability Detection and Reporting

Cognigate's CI/CD pipeline integrates multiple automated vulnerability detection tools that feed into the GitHub Security tab:

**Gitleaks SARIF Integration** (`.github/workflows/secrets-scan.yml`):

The Gitleaks Action v2 performs secret detection on every push to `master`/`main` and every pull request. Results are uploaded as SARIF reports to the GitHub Security tab:

```yaml
- name: Run Gitleaks
  uses: gitleaks/gitleaks-action@v2
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    GITLEAKS_LICENSE: ${{ secrets.GITLEAKS_LICENSE }}
    GITLEAKS_ENABLE_SUMMARY: true

- name: Upload SARIF report
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: results.sarif
```

A supplementary pattern-based check scans for hardcoded API keys and accidentally committed `.env` files.

**CodeQL SARIF Integration** (`.github/workflows/security-scan.yml`):

CodeQL performs semantic analysis with the `security-extended` and `security-and-quality` query suites, uploading results to the GitHub Security tab:

```yaml
- name: Perform CodeQL Analysis
  uses: github/codeql-action/analyze@v3
  with:
    category: /language:javascript-typescript
```

**Trivy SARIF Integration** (`.github/workflows/security-scan.yml`):

Trivy performs filesystem vulnerability scanning at CRITICAL and HIGH severity, with SARIF output uploaded to GitHub Security:

```yaml
- name: Run Trivy filesystem scan
  uses: aquasecurity/trivy-action@master
  with:
    scan-type: 'fs'
    severity: 'CRITICAL,HIGH'
    format: 'sarif'
    output: 'trivy-results.sarif'
```

### 1.3 Dependabot Alerts

Dependabot is enabled on the Vorion repository for:

- **npm dependencies**: TypeScript monorepo packages
- **pip dependencies**: Cognigate Python packages
- **GitHub Actions**: Workflow action version pinning

Dependabot alerts appear in the GitHub Security tab and generate pull requests for version updates when safe upgrades are available. The dependency review action in the security scan pipeline blocks PRs that introduce dependencies with HIGH+ severity vulnerabilities or GPL-3.0/AGPL-3.0 licenses.

### 1.4 Responsible Disclosure Policy

Vorion follows a responsible disclosure timeline for vulnerabilities reported by external researchers:

| Phase | Timeline | Activity |
|---|---|---|
| **Receipt** | Day 0 | Acknowledgment of report via GitHub Security Advisory or `security@vorion.org` |
| **Acknowledgment** | Within 48 hours | Written confirmation to reporter with tracking ID |
| **Triage** | Within 5 business days | Severity assessment, reproduction, and impact analysis |
| **Remediation** | Within 30 days (critical), 60 days (high), 90 days (medium/low) | Develop and test fix |
| **Notification** | 7 days before disclosure | Notify reporter that disclosure is imminent, share advisory draft |
| **Disclosure** | Day 90 maximum | Publish GitHub Security Advisory with CVE (if applicable) |

**Disclosure Principles**:

1. Reporters receive credit in the advisory unless they request anonymity
2. Vorion does not pursue legal action against researchers acting in good faith
3. If a fix cannot be deployed within the disclosure timeline, Vorion publishes a mitigation advisory at the timeline deadline and updates it when the fix is available
4. Critical vulnerabilities affecting production systems may trigger accelerated disclosure (within 7 days) if active exploitation is detected

### 1.5 CISA Coordination

For critical vulnerabilities that may affect the broader AI governance ecosystem or US federal systems:

1. **Notification**: Vorion notifies CISA via the CISA Vulnerability Disclosure Policy portal within 24 hours of confirming a critical vulnerability
2. **CVE Assignment**: Vorion requests CVE assignment through the GitHub CNA (CVE Numbering Authority) program
3. **Advisory Coordination**: For vulnerabilities affecting Cognigate's use in federal AI governance contexts (FedRAMP, NIST compliance), Vorion coordinates advisory timing with CISA
4. **SBOM Cross-Reference**: Vulnerability disclosures reference the affected SBOM version(s) from `sbom-history/` to enable downstream impact analysis

---

## 2. Anti-Counterfeit Awareness and Component Provenance (SR-11.1)

### 2.1 SBOM Component Provenance

The Cognigate SBOM generation pipeline (`.github/workflows/sbom.yml`) provides component provenance through multiple mechanisms:

**Package URL (PURL) Identifiers**:

Every component in the CycloneDX 1.5 SBOM includes a PURL (Package URL) identifier that provides cryptographically verifiable provenance to the original package registry:

- **Python packages**: `pkg:pypi/<package>@<version>` (e.g., `pkg:pypi/fastapi@0.115.0`)
- **npm packages**: `pkg:npm/<package>@<version>` (e.g., `pkg:npm/@vorion/security@1.0.0`)

PURLs enable:
- Verification that the installed package matches the registry-published version
- Cross-referencing with vulnerability databases (NVD, OSV, GitHub Advisory Database)
- Supply chain provenance tracking from developer to deployed artifact

**Component Hashes**:

SBOM components include SHA-256 cryptographic hashes when available from package registries. These hashes are validated during the NTIA minimum elements check in the SBOM pipeline:

```javascript
const hashedComps = (sbom.components || []).filter(c =>
  c.hashes && c.hashes.length > 0
).length;
check('Component Hashes', hashedComps > 0, ...);
```

**Dependency Relationships**:

The full transitive dependency tree is captured in the SBOM `dependencies[]` array, enabling auditors to trace the complete supply chain from root package to leaf dependencies.

### 2.2 Package Installation Integrity

**pip Hash Verification** (Python):

Cognigate Python dependencies use pip's hash-checking mode to prevent installation of tampered packages. When a `requirements.txt` with hashes is present:

```
fastapi==0.115.0 --hash=sha256:<expected_hash>
```

pip verifies the downloaded package hash against the expected hash and refuses installation if they do not match. This prevents:

- Man-in-the-middle attacks on package downloads
- Registry compromise where a malicious package replaces the legitimate one
- Local cache poisoning

**npm Integrity** (TypeScript):

The `package-lock.json` records integrity hashes (SHA-512) for every installed package. `npm ci` (used in CI/CD) verifies these hashes during installation and fails if any integrity check fails.

### 2.3 GitHub Actions Version Pinning

All GitHub Actions in the Cognigate CI/CD pipeline use pinned versions:

| Action | Pinning Strategy | Example |
|---|---|---|
| `actions/checkout` | Major version tag | `@v4` |
| `actions/setup-python` | Major version tag | `@v5` |
| `github/codeql-action/*` | Major version tag | `@v3` |
| `gitleaks/gitleaks-action` | Major version tag | `@v2` |
| `aquasecurity/trivy-action` | Branch reference | `@master` |

**Recommended Hardening** (tracked in POA&M): Migrate from tag-based pinning to SHA-based pinning for all actions. SHA-based pinning (e.g., `actions/checkout@<full-sha>`) prevents tag substitution attacks where a compromised action tag is redirected to malicious code.

### 2.4 Dependency Source Verification

Cognigate enforces the following source restrictions:

**Python Packages**:
- **Authorized Source**: PyPI (Python Package Index) at `https://pypi.org/` only
- **Private Packages**: No private PyPI indexes are used for Cognigate dependencies
- **Verification**: pip verifies package signatures and checksums against PyPI's published metadata

**npm Packages**:
- **Authorized Source**: npm public registry at `https://registry.npmjs.org/` only
- **Organization Scope**: `@vorion/*` scoped packages are published to the npm public registry under the Vorion organization
- **Verification**: npm verifies package integrity via `package-lock.json` SHA-512 hashes

**Prohibited Sources**:
- Packages installed from arbitrary URLs, Git repositories, or local paths in production builds
- Packages from unofficial registries, mirrors, or proxies without cryptographic verification
- Packages that have been deprecated, archived, or flagged as malicious by the registry

### 2.5 Dependency License Verification

The CI/CD pipeline enforces license compliance at the PR level:

```yaml
- name: Dependency Review
  uses: actions/dependency-review-action@v4
  with:
    fail-on-severity: high
    deny-licenses: GPL-3.0, AGPL-3.0
    comment-summary-in-pr: always
```

This ensures that no copyleft-licensed dependencies enter the Cognigate supply chain, maintaining Apache 2.0 license compatibility.

### 2.6 Supply Chain Attack Awareness Training

Vorion maintains awareness of supply chain attack vectors relevant to the Cognigate technology stack:

| Attack Vector | Description | Mitigation |
|---|---|---|
| **Typosquatting** | Packages with names similar to legitimate packages | SBOM review, lock file pinning |
| **Dependency Confusion** | Private package name claimed on public registry | No private registries; `@vorion/` scope protection |
| **Malicious Maintainer** | Legitimate package compromised by a malicious maintainer update | Dependabot alerts, pinned versions, SBOM diff on update |
| **Build System Compromise** | CI/CD pipeline or build tools compromised | Pinned action versions, minimal permissions, OIDC tokens |
| **Registry Compromise** | Package registry itself compromised | Hash verification, SBOM provenance tracking |
| **Protestware** | Maintainer introduces intentional sabotage | Dependabot monitoring, Trivy scanning, SBOM vulnerability correlation |
| **AI Model Poisoning** | Critic AI provider returns manipulated assessments | Multi-provider support, fallback to cautious verdict on error |

The Cognigate-specific risk of AI model poisoning is mitigated by the Critic's fail-safe design (`app/core/critic.py`): when the Critic encounters any error, it returns a cautious verdict (`judgment: "suspicious"`, `requires_human_review: true`, `recommended_action: "escalate"`) rather than silently passing:

```python
# On error, return a cautious verdict
return CriticVerdict(
    judgment="suspicious",
    confidence=0.3,
    risk_adjustment=0.1,
    hidden_risks=["Critic analysis failed - proceeding with caution"],
    reasoning=f"Critic analysis error: {str(e)}. Defaulting to suspicious.",
    requires_human_review=True,
    recommended_action="escalate",
)
```

---

## 3. Compliance Mapping

### NIST SP 800-53 Rev 5

| Control | Enhancement | Title | Section | Implementation Status |
|---|---|---|---|---|
| RA-5 | (11) | Public Disclosure Program | 1 | Implemented |
| SR-11 | (1) | Anti-Counterfeit Training | 2 | Implemented |

### Cross-Framework Mapping

| Control | SOC 2 | ISO 27001:2022 | FedRAMP | CMMC 2.0 |
|---|---|---|---|---|
| RA-5(11) | CC7.1, CC7.4 | A.5.24, A.8.8 | RA-5(11) | RA.L2-3.11.2 |
| SR-11(1) | CC9.2 | A.5.19, A.5.21, A.5.22 | SR-11(1) | SR.L2-3.17.1 |

### Additional Framework Mapping

| Control | EU AI Act | ISO 42001 | NIST AI RMF |
|---|---|---|---|
| RA-5(11) | Article 15(4) -- resilience to unauthorized third parties | A.10.3 -- monitoring | MANAGE 4.1 -- incident response plans |
| SR-11(1) | Article 15(1) -- cybersecurity by design | A.6.2.6 -- AI system security | MAP 3.5 -- risk identification |

### Evidence Artifacts

| Evidence | Location | Type |
|---|---|---|
| GitHub Security Advisories | Repository security tab | Platform |
| Gitleaks SARIF reports | `.github/workflows/secrets-scan.yml` | Configuration |
| CodeQL SARIF reports | `.github/workflows/security-scan.yml` | Configuration |
| Trivy SARIF reports | `.github/workflows/security-scan.yml` | Configuration |
| Dependabot configuration | Repository settings | Configuration |
| Dependency review (license deny) | `.github/workflows/security-scan.yml` | Configuration |
| SBOM generation pipeline | `.github/workflows/sbom.yml` | Configuration |
| SBOM compliance mapping | `compliance/sbom-compliance.yaml` | Documentation |
| SBOM with PURL identifiers | `sbom/sbom-cyclonedx.json` (generated) | Artifact |
| SBOM NTIA validation | `sbom.yml` (NTIA minimum elements check) | Configuration |
| Package-lock.json (integrity hashes) | Repository root | Configuration |
| AI Critic fail-safe design | `cognigate-api/app/core/critic.py` (error handling) | Code |
| Control registry | `compliance/control-registry.yaml` | Documentation |

---

## 4. Metrics and Performance Indicators

| Metric | Target | Frequency | Data Source |
|--------|--------|-----------|-------------|
| SBOM generation compliance rate (% releases with valid CycloneDX/SPDX SBOM) | 100% | Per release + Monthly | `.github/workflows/sbom.yml`, `sbom-history/` |
| Dependency vulnerability remediation time | <= 72 hours (critical), <= 14 days (high) | Weekly | Trivy, pip-audit, Dependabot alerts, GitHub Security tab |
| Supplier assessment completion rate (% cloud providers with current certifications verified) | 100% | Annually | Vercel/Neon/AWS SOC 2 and FedRAMP certification records |
| Anti-counterfeit verification rate (% dependencies with hash/integrity verification) | >= 95% | Monthly | `requirements.txt` hash pins, `package-lock.json` integrity, SBOM PURL validation |

Metrics are reported monthly to the ISSO and quarterly to the Authorizing Official as part of the continuous monitoring program (VOR-POL-CONMON-001).

---

## 5. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Information System Security Officer (ISSO) | _________________ | _________________ | ________ |
| System Owner | _________________ | _________________ | ________ |
| Authorizing Official | _________________ | _________________ | ________ |

---

*This addendum is maintained by Vorion Security Engineering and reviewed annually or upon significant changes to the vulnerability disclosure process or supply chain practices. Changes require approval from the Vorion CISO or delegate.*
