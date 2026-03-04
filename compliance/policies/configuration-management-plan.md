# Vorion Cognigate Configuration Management Plan

**Document ID:** VOR-POL-CM-001
**Version:** 1.0.0
**Effective Date:** 2026-02-19
**Classification:** PUBLIC
**Owner:** Vorion Platform Engineering
**Review Cadence:** Annual (next review: 2027-02-19)
**Satisfies:** NIST SP 800-53 Rev 5 CM-2(3), CM-4, CM-4(2), CM-7(1), CM-9, CM-10

---

## 1. Purpose and Scope

This plan establishes the configuration management practices for the Vorion Cognigate AI Agent Governance Engine. Cognigate is a FastAPI/Python application deployed on Vercel that implements the INTENT, ENFORCE, and PROOF pipeline for AI agent governance under the BASIS standard.

This plan covers:

- All source code in the `cognigate-api/` directory
- Application configuration in `app/config.py` and environment variables
- Runtime configuration changes made through admin API endpoints
- CI/CD pipeline configuration in `.github/workflows/`
- Compliance artifacts in `compliance/`
- Policy definitions loaded by the PolicyEngine (`app/core/policy_engine.py`)
- Trust tier definitions, velocity limits, circuit breaker thresholds, and tripwire patterns

This plan does not cover infrastructure configuration managed by Vercel's platform (network, CDN, edge functions), which is addressed separately in the Vercel deployment configuration.

---

## 2. Configuration Baseline and Previous Versions (CM-2.3)

### 2.1 Git Version Control

All Cognigate configurations are tracked in Git. The repository serves as the authoritative configuration baseline:

- **Repository**: `voriongit/vorion` (monorepo) containing `cognigate-api/` subdirectory
- **Primary Branch**: `master` -- represents the production-deployed configuration baseline
- **Branch Protection**: Pull request required for all changes to `master`
- **History**: Full Git history provides access to every previous configuration version

Git provides the following baseline guarantees:

| Guarantee | Mechanism |
|---|---|
| Every change is attributed | Git commit authorship |
| Every change is timestamped | Git commit timestamp |
| Every change is reversible | `git revert` on any commit |
| Full change history is preserved | Git log with unlimited retention |
| Changes are cryptographically linked | Git SHA-1/SHA-256 commit hashes |

### 2.2 Proof Chain Configuration History

Runtime configuration changes made through admin API endpoints are recorded in the PROOF ledger (`app/models/proof.py`). Each `ProofRecord` includes:

- **`previous_hash`**: SHA-256 hash of the preceding proof record, creating an immutable chain
- **`hash`**: SHA-256 hash of the current record
- **`signature`**: Optional Ed25519 digital signature from `app/core/signatures.py`
- **`inputs_hash`**: SHA-256 hash of the configuration change inputs
- **`outputs_hash`**: SHA-256 hash of the resulting configuration state
- **`action_type`**: Identifies the type of configuration change
- **`decision`**: One of `allowed`, `denied`, `escalated`, `modified`

This chain provides tamper-evident linkage between configuration states, enabling auditors to reconstruct the complete runtime configuration history.

### 2.3 Rollback Capability

| Configuration Type | Rollback Mechanism | Time to Rollback |
|---|---|---|
| Source code (app/, tests/) | `git revert <commit>` + redeploy | Minutes (CI/CD pipeline) |
| Application settings (config.py) | `git revert` + redeploy | Minutes |
| Environment variables | Vercel dashboard or CLI | Seconds |
| Runtime policy changes | Admin API reversal + proof chain audit | Seconds |
| Trust scores | Admin API reset + proof chain record | Seconds |
| Circuit breaker state | `manual_reset()` via admin API | Seconds |

### 2.4 Retention

- **Git History**: Indefinite. All commits are retained.
- **Proof Chain Records**: 7 years minimum, aligned with FedRAMP continuous monitoring requirements.
- **CI/CD Artifacts**: 90 days (GitHub Actions artifact retention for SBOM and build outputs).
- **SBOM History**: Indefinite (committed to `sbom-history/` directory on each release).

---

## 3. Impact Analysis (CM-4)

### 3.1 Automated Impact Analysis in CI/CD

Every pull request to `master` triggers the following automated impact analysis pipeline:

**Python CI Pipeline** (`.github/workflows/ci-python.yml`):

| Stage | Tool | Purpose |
|---|---|---|
| Lint & Format | Ruff, Black | Code quality and consistency |
| Type Check | mypy | Type safety verification |
| Test | pytest with coverage | Functional regression detection |
| Security | Safety, Bandit | Vulnerability and security flaw detection |
| Build | Python build | Package integrity verification |

**Security Scan Pipeline** (`.github/workflows/security-scan.yml`):

| Stage | Tool | Purpose |
|---|---|---|
| CodeQL | GitHub CodeQL | Semantic code analysis (security-extended + security-and-quality queries) |
| Trivy | Aquasecurity Trivy | Filesystem vulnerability scanning (CRITICAL, HIGH severity) |
| Dependency Review | GitHub Dependency Review | Block PRs introducing vulnerable or GPL-3.0/AGPL-3.0 dependencies |
| Python Security | pip-audit, Bandit | Python-specific vulnerability and security scanning |

**Secrets Scan Pipeline** (`.github/workflows/secrets-scan.yml`):

| Stage | Tool | Purpose |
|---|---|---|
| Gitleaks | Gitleaks Action v2 | Secret detection with SARIF upload to GitHub Security tab |
| Pattern Check | Custom regex | Detection of hardcoded API keys and .env files |

### 3.2 Impact Assessment Checklist for Architecture Changes

Changes that affect the INTENT, ENFORCE, or PROOF pipeline architecture require the following manual assessment before merge:

1. **Trust Tier Impact**: Does the change affect trust level calculations, trust tier boundaries (`TRUST_LEVELS` in `app/models/common.py`), or trust decay rates?
2. **Policy Engine Impact**: Does the change modify policy evaluation logic (`app/core/policy_engine.py`), the expression evaluator, or default BASIS policies?
3. **Proof Chain Integrity**: Does the change affect the proof record schema (`app/models/proof.py`), hash computation, or signature generation (`app/core/signatures.py`)?
4. **Velocity Cap Impact**: Does the change modify velocity limits (`VELOCITY_LIMITS_BY_TRUST` in `app/core/velocity.py`) or the velocity tracking mechanism?
5. **Circuit Breaker Impact**: Does the change modify trip thresholds (`CircuitConfig` in `app/core/circuit_breaker.py`), recovery behavior, or entity halt logic?
6. **Tripwire Impact**: Does the change add, modify, or remove tripwire patterns (`FORBIDDEN_PATTERNS` in `app/core/tripwires.py`)?
7. **Critic Impact**: Does the change modify the adversarial AI Critic's system prompt, judgment scale, or provider configuration (`app/core/critic.py`)?

### 3.3 Trust Tier Impact Analysis for Policy Changes

Policy changes are evaluated for impact across all trust tiers:

| Trust Tier | Name | Score Range | Enforcement Rigor | Affected By |
|---|---|---|---|---|
| T0 | Sandbox | 0-199 | STRICT | All policy changes |
| T1 | Observed | 200-349 | STRICT | All policy changes |
| T2 | Provisional | 350-499 | STRICT | All policy changes |
| T3 | Monitored | 500-649 | STANDARD | Policy and threshold changes |
| T4 | Standard | 650-799 | STANDARD | Threshold and privilege changes |
| T5 | Trusted | 800-875 | LITE | Only critical policy changes |
| T6 | Certified | 876-950 | LITE | Only critical policy changes |
| T7 | Autonomous | 951-1000 | LITE | Only critical policy changes |

The `RigorMode` enum (`app/models/enforce.py`) determines which policies are evaluated:
- **LITE**: Critical policies only (security violations, hard constraints)
- **STANDARD**: All BASIS policies
- **STRICT**: All policies + AI Critic validation + enhanced auditing

### 3.4 Cross-Framework Compliance Impact

Changes to Cognigate capabilities are assessed against the multi-framework control registry (`compliance/control-registry.yaml`), which maps each capability to controls across 13 regulatory frameworks:

- NIST SP 800-53 Rev 5
- NIST AI RMF 1.0
- NIST SP 800-171 Rev 3
- EU AI Act (2024/1689)
- ISO/IEC 42001:2023
- ISO/IEC 27001:2022
- SOC 2 Type II
- CMMC 2.0 Level 2
- FedRAMP Moderate
- GDPR
- Singapore PDPA
- Japan APPI
- COSAiS (Draft 2025)

Any change that affects a mapped capability triggers a compliance impact review to ensure no framework regression.

---

## 4. Periodic Functionality Review (CM-7.1)

### 4.1 Quarterly API Endpoint Review

Every quarter, the following review is conducted on all enabled Cognigate API endpoints:

1. **Endpoint Inventory**: Enumerate all routes registered under `/v1/*`
2. **Usage Analysis**: Review proof chain records to identify endpoints with zero or minimal usage over the prior quarter
3. **Security Assessment**: Evaluate each endpoint's attack surface and determine if the exposure remains justified
4. **Deprecation Candidates**: Endpoints with no usage for two consecutive quarters are flagged for deprecation review

### 4.2 Compliance Dashboard as Functionality Overview

The Cognigate compliance endpoints provide a real-time system function overview:

- **`GET /v1/compliance/dashboard`**: Aggregated compliance posture across all frameworks
- **`GET /v1/compliance/health`**: Health check assessing compliance gaps across 13 frameworks
- **`GET /v1/compliance/audit`**: Audit trail access for assessors
- **`GET /v1/compliance/access`**: Access control compliance status
- **`GET /v1/compliance/hipaa`**: HIPAA-specific compliance status
- **`GET /v1/compliance/iso27001`**: ISO 27001-specific compliance status

These endpoints are backed by the compliance framework implementation in the AgentAnchor frontend (`apps/agentanchor/lib/compliance/`) and provide continuous visibility into system capabilities.

### 4.3 Annual Capability Taxonomy Review

An annual review evaluates the complete Cognigate capability taxonomy as defined in the control registry:

- **INTENT Layer**: Tripwire detection, Critic analysis, intent normalization, risk scoring
- **ENFORCE Layer**: Policy engine evaluation, trust-gated access, velocity caps, circuit breakers
- **PROOF Layer**: Proof record generation, hash chain integrity, Ed25519 signatures, chain verification

Each capability is assessed for:
- Continued business justification
- Security posture changes
- Compliance requirement changes across all 13 mapped frameworks
- Performance and operational impact

### 4.4 Unused Endpoint Identification and Deprecation

The deprecation process follows these stages:

1. **Identification**: Endpoint flagged via quarterly review or operational monitoring
2. **Notification**: API consumers notified via `X-Deprecation-Warning` response header
3. **Grace Period**: 90 days from notification to removal
4. **Removal**: Endpoint removed from codebase via standard PR process with CM-4 impact analysis
5. **Documentation**: Deprecation recorded in changelog and control registry updated

---

## 5. Configuration Management Plan (CM-9)

### 5.1 Configuration Architecture

All Cognigate configuration is centralized in `app/config.py` using Pydantic Settings (`BaseSettings`). Configuration is loaded from environment variables with `.env` file fallback:

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )
```

The `get_settings()` function returns a cached singleton instance via `@lru_cache`.

### 5.2 Configuration Categories

#### Security Configuration

| Setting | Default | Purpose |
|---|---|---|
| `secret_key` | `CHANGE_ME_IN_PRODUCTION` | Application secret key |
| `admin_api_key` | `CHANGE_ME_IN_PRODUCTION` | Admin endpoint authentication |
| `signature_enabled` | `True` | Enable Ed25519 proof signatures |
| `signature_private_key` | `""` | Base64-encoded PEM private key |
| `signature_key_path` | `""` | Path to PEM private key file |
| `anthropic_api_key` | `""` | Critic provider API key (Claude) |
| `openai_api_key` | `""` | Critic provider API key (GPT) |
| `google_api_key` | `""` | Critic provider API key (Gemini) |
| `xai_api_key` | `""` | Critic provider API key (Grok) |

#### Operational Configuration

| Setting | Default | Purpose |
|---|---|---|
| `access_token_expire_minutes` | `30` | JWT token expiration |
| `cache_ttl_policy_results` | `60` seconds | Policy evaluation cache TTL |
| `cache_ttl_trust_scores` | `300` seconds | Trust score cache TTL |
| `cache_ttl_velocity_state` | `0` (no expiry) | Velocity state cache TTL |
| `logic_timeout_seconds` | `5.0` | External Logic API timeout |
| `redis_enabled` | `True` | Redis cache feature flag |
| `log_level` | `INFO` | Logging verbosity |
| `log_format` | `json` | Structured logging format |

#### Policy Configuration (Trust Thresholds and Velocity Caps)

| Configuration | Location | Values |
|---|---|---|
| Trust levels | `app/models/common.py` | 8 tiers: T0=Sandbox (0-199) through T7=Autonomous (951-1000) |
| Trust decay rate | `app/config.py` | `0.01` (configurable) |
| Default trust level | `app/config.py` | `1` (Provisional) |
| Velocity limits | `app/core/velocity.py` | Per-trust-level limits across 4 tiers |
| Circuit breaker thresholds | `app/core/circuit_breaker.py` | `CircuitConfig` dataclass |
| Policy constraints | `app/core/policy_engine.py` | Default BASIS policies |
| Tripwire patterns | `app/core/tripwires.py` | 22+ `FORBIDDEN_PATTERNS` |
| Critic configuration | `app/config.py` | Provider, model, temperature (0.3) |

### 5.3 Change Control

| Change Type | Process | Approval | Audit |
|---|---|---|---|
| Code configuration (app/config.py) | Pull request to `master` | Code review required | Git history |
| Environment variables | Vercel dashboard change | Admin access required | Vercel audit log |
| Runtime policy changes | Admin API with `X-Admin-Key` | Admin authentication | PROOF ledger |
| Trust score adjustments | Admin API | Admin authentication | PROOF ledger |
| Circuit breaker manual actions | Admin API (`manual_halt`, `manual_reset`) | Admin authentication | PROOF ledger + structured logging |

### 5.4 Configuration Audit

Runtime configuration changes are audited through two complementary mechanisms:

1. **PROOF Ledger**: Every runtime configuration change generates a `ProofRecord` (`app/models/proof.py`) with SHA-256 hash chain linkage and optional Ed25519 signature. The `chain_position` field provides total ordering, and `previous_hash` provides tamper detection.

2. **Structured Logging**: All configuration-relevant events are logged via `structlog` in JSON format. Key log events include:
   - `circuit_breaker_tripped` (critical)
   - `circuit_auto_reset` (info)
   - `circuit_manual_reset` (info)
   - `entity_halted` / `entity_unhalted` (warning/info)
   - `velocity_limit_exceeded` (warning)
   - `entity_throttled` / `entity_unthrottled` (warning/info)
   - `critic_completed` / `critic_error` (info/error)
   - `admin_auth_missing_key` / `admin_auth_invalid_key` (warning)

---

## 6. Software Usage Restrictions (CM-10)

### 6.1 Cognigate Licensing

Cognigate is licensed under Apache License 2.0. This license:

- Permits commercial use, modification, distribution, and private use
- Requires preservation of copyright and license notices
- Provides an express grant of patent rights
- Does not impose copyleft obligations on derivative works

### 6.2 Dependency Licensing

All Cognigate dependencies are tracked and verified for license compatibility:

**Python Dependencies (cognigate-api/)**:

| Dependency | License | Status |
|---|---|---|
| FastAPI | MIT | Compatible |
| Pydantic / Pydantic Settings | MIT | Compatible |
| Uvicorn | BSD-3-Clause | Compatible |
| structlog | MIT/Apache-2.0 | Compatible |
| PyYAML | MIT | Compatible |
| cryptography (Ed25519) | Apache-2.0/BSD | Compatible |
| anthropic | MIT | Compatible |
| openai | MIT | Compatible |

**Policy**: No copyleft dependencies (GPL-3.0, AGPL-3.0) are permitted in the Cognigate core. The security scan pipeline (`.github/workflows/security-scan.yml`) includes a dependency review step that explicitly denies GPL-3.0 and AGPL-3.0 licensed dependencies:

```yaml
- name: Dependency Review
  uses: actions/dependency-review-action@v4
  with:
    fail-on-severity: high
    deny-licenses: GPL-3.0, AGPL-3.0
```

### 6.3 SBOM-Based License Tracking

Software composition is tracked via the SBOM generation pipeline (`.github/workflows/sbom.yml`):

- **CycloneDX 1.5**: JSON and XML formats with component license data
- **SPDX 2.3**: JSON format with `licenseConcluded` and `licenseDeclared` fields
- **Generation Triggers**: Every version tag, every release, weekly schedule (Monday 6AM UTC)
- **NTIA Compliance**: Automated validation against NTIA minimum elements including license data presence
- **Retention**: SBOM artifacts retained 90 days as CI artifacts; versioned copies archived indefinitely in `sbom-history/`

The SBOM compliance mapping (`compliance/sbom-compliance.yaml`) documents how SBOM practices satisfy controls across NIST 800-53, NIST 800-218 (SSDF), EO 14028, EU AI Act, ISO 27001, CISA 2025, and NTIA requirements.

### 6.4 License Compatibility Validation

License validation occurs at multiple stages:

1. **Development**: Developers verify license compatibility before adding dependencies
2. **Pull Request**: GitHub Dependency Review Action rejects PRs with prohibited licenses
3. **Release**: SBOM generation captures license data for all direct and transitive dependencies
4. **Audit**: Quarterly review of SBOM license data against approved license list

---

## 7. Compliance Mapping

### NIST SP 800-53 Rev 5

| Control | Enhancement | Title | Section | Implementation Status |
|---|---|---|---|---|
| CM-2 | (3) | Retention of Previous Configurations | 2 | Implemented |
| CM-4 | -- | Impact Analyses | 3 | Implemented |
| CM-7 | (1) | Periodic Review | 4 | Implemented |
| CM-9 | -- | Configuration Management Plan | 5 | Implemented |
| CM-10 | -- | Software Usage Restrictions | 6 | Implemented |

### Cross-Framework Mapping

| Control | SOC 2 | ISO 27001:2022 | FedRAMP | CMMC 2.0 |
|---|---|---|---|---|
| CM-2(3) | CC8.1 | A.8.9, A.8.32 | CM-2(3) | CM.L2-3.4.1 |
| CM-4 | CC8.1 | A.8.9 | CM-4 | CM.L2-3.4.4 |
| CM-7(1) | CC6.6, CC6.8 | A.8.19 | CM-7(1) | CM.L2-3.4.7 |
| CM-9 | CC8.1 | A.8.9, A.8.32 | CM-9 | CM.L2-3.4.1 |
| CM-10 | CC6.8 | A.5.10, A.8.28 | CM-10 | CM.L2-3.4.9 |

### Evidence Artifacts

| Evidence | Location | Type |
|---|---|---|
| Git version control | Repository history | Automated |
| CI/CD pipeline configuration | `.github/workflows/ci-python.yml` | Configuration |
| Security scanning | `.github/workflows/security-scan.yml` | Configuration |
| Secrets scanning | `.github/workflows/secrets-scan.yml` | Configuration |
| SBOM generation pipeline | `.github/workflows/sbom.yml` | Configuration |
| SBOM compliance mapping | `compliance/sbom-compliance.yaml` | Documentation |
| Application configuration | `cognigate-api/app/config.py` | Code |
| Policy engine | `cognigate-api/app/core/policy_engine.py` | Code |
| Proof chain records | `cognigate-api/app/models/proof.py` | Code |
| Control registry | `compliance/control-registry.yaml` | Documentation |
| License deny list | `.github/workflows/security-scan.yml` (deny-licenses) | Configuration |
| Dependency review | GitHub Dependency Review Action | Automated |

---

## 8. Metrics and Performance Indicators

| Metric | Target | Frequency | Data Source |
|--------|--------|-----------|-------------|
| Configuration baseline drift rate (unauthorized deviations from `master`) | 0 unauthorized changes | Weekly | Git history, Vercel deployment logs |
| Unauthorized change detection rate | 100% detected within 24 hours | Monthly | Branch protection logs, PROOF ledger, structured logs |
| CI/CD pipeline pass rate (all security gates) | >= 95% | Weekly | GitHub Actions (`ci-python.yml`, `security-scan.yml`) |
| SBOM accuracy and freshness (NTIA minimum elements compliance) | 100% NTIA compliant; refreshed within 7 days of release | Monthly | `.github/workflows/sbom.yml`, `sbom-history/` |

Metrics are reported monthly to the ISSO and quarterly to the Authorizing Official as part of the continuous monitoring program (VOR-POL-CONMON-001).

---

## 9. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Information System Security Officer (ISSO) | _________________ | _________________ | ________ |
| System Owner | _________________ | _________________ | ________ |
| Authorizing Official | _________________ | _________________ | ________ |

---

*This plan is maintained by Vorion Platform Engineering and reviewed annually or upon significant system changes. Changes to this plan require approval from the Vorion CISO or delegate.*
