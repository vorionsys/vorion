# Vorion Cognigate -- Media Protection Policy

**Document ID:** VOR-POL-MP-001
**Version:** 1.0.0
**Effective Date:** 2026-02-19
**Last Reviewed:** 2026-02-19
**Next Review:** 2027-02-19
**Owner:** Vorion Security Engineering
**Classification:** PUBLIC
**Applicable Controls:** MP-1, MP-2, MP-3, MP-4, MP-5, MP-6

---

## 1. Purpose and Scope

### 1.1 Purpose

This policy establishes the media protection requirements for the Vorion Cognigate AI Agent Governance Runtime. It defines how Cognigate's digital assets are classified, stored, transported, accessed, and sanitized.

Cognigate is a cloud-native SaaS application. It does not create, handle, store, or transport physical media (tapes, disks, USB drives, optical media, printed output). All data is digital and cloud-hosted. Therefore, this policy addresses **digital media** exclusively: databases, proof chain records, configuration data, application logs, code repositories, cached data, and API payloads.

Physical media protection for the underlying infrastructure (disk encryption, drive sanitization, hardware disposal) is inherited from cloud service providers (Vercel/AWS, Neon) who maintain FedRAMP-authorized and SOC 2-certified infrastructure.

### 1.2 Scope

This policy covers the following digital media:

| Media Type | Description | Storage Location |
|------------|-------------|------------------|
| **PROOF chain records** | Immutable, SHA-256 hash-chained governance decision records with Ed25519 signatures | PostgreSQL (Neon) |
| **Entity registry** | AI agent registration records, trust scores, Ed25519 public keys | PostgreSQL (Neon) |
| **Policy definitions** | BASIS policy rules, capability taxonomy, trust tier configurations | PostgreSQL (Neon) + YAML in repository |
| **Application logs** | Structured logs from Cognigate API operations | Vercel log drains |
| **Source code** | Cognigate application code, tests, configuration | GitHub (private repository) |
| **Configuration** | Environment variables, API keys, database connection strings | Vercel encrypted environment store |
| **Cache data** | Session state, velocity counters, policy evaluation cache | Redis (ephemeral, TTL-based) |
| **Development data** | Local SQLite databases, test fixtures | Developer workstations (non-production) |
| **Backup data** | Database backups, point-in-time recovery snapshots | Neon managed backups (AWS S3) |

### 1.3 Not in Scope

- Physical media of any kind (Cognigate does not handle physical media)
- Consumer organization data outside of Cognigate's authorization boundary
- End-user PII (Cognigate governs AI agent entities, not human end-user data)

---

## 2. Policy Statements

### 2.1 MP-1: Media Protection Policy and Procedures

**Control Requirement:** Develop, document, and disseminate a media protection policy; review and update annually.

**Cognigate Implementation:**

a. This document constitutes the formal media protection policy for the Cognigate system. It is maintained under version control at `compliance/policies/media-protection-policy.md`.

b. This policy is reviewed **annually** by Vorion Security Engineering, or sooner when triggered by:
   - A change in cloud service provider (new database, new hosting platform)
   - A change in data classification requirements or retention obligations
   - A security incident involving data exposure, unauthorized access, or data loss
   - A regulatory change affecting digital media handling (GDPR, FedRAMP, etc.)

c. Media protection procedures are enforced through:
   - Cognigate's authentication and authorization middleware (`app/core/auth.py`)
   - Application-layer access controls that enforce data isolation through SQLAlchemy query scoping and trust-tier authorization middleware
   - Vercel's platform-level encryption and access controls
   - Neon's database-level encryption and backup management
   - CI/CD pipeline controls that prevent credential exposure (Gitleaks)

d. This policy is disseminated to all Vorion personnel with access to Cognigate's digital assets and is available in the compliance directory of the repository.

### 2.2 MP-2: Media Access

**Control Requirement:** Restrict access to digital media to authorized individuals.

**Cognigate Implementation:**

a. **Database access restrictions:**
   - Production PostgreSQL (Neon) is accessible only through the Cognigate API layer. No direct SQL connections are permitted from outside the Vercel deployment environment.
   - Application-layer access controls enforce data isolation through SQLAlchemy query scoping and trust-tier authorization middleware. Each query is scoped to the authenticated entity's permissions.
   - The `/v1/proof` API endpoint requires authentication (API key) for all read operations on proof chain data.
   - Bulk export of proof chain records requires administrative authentication via the X-Admin-Key header.
   - The `/v1/admin/entities` endpoint restricts entity enumeration to authenticated administrators.

b. **PROOF chain immutability:**
   - Proof chain records are append-only by design. The data model does not expose UPDATE or DELETE operations on proof records through any API endpoint.
   - Each proof record is integrity-sealed with SHA-256 hashing and Ed25519 digital signature, making unauthorized modification cryptographically detectable.
   - Chain linkage (each record's `previous_hash` references the preceding record's `hash`) ensures that insertion, deletion, or reordering of records breaks the chain and is detectable via the `/v1/proof/{id}/verify` endpoint.

c. **Configuration access:**
   - Environment variables (ADMIN_KEY, DATABASE_URL, API provider keys) are stored in Vercel's encrypted environment variable store, accessible only to authorized Vercel team members with appropriate roles.
   - Vercel audit logs record all access to project settings and environment variables.

d. **Source code access:**
   - The Cognigate repository is private on GitHub, accessible only to members of the Vorion GitHub organization.
   - Repository access is controlled via GitHub organization teams with role-based permissions (read, write, admin).

### 2.3 MP-3: Media Marking and Classification

**Control Requirement:** Mark information system media indicating distribution limitations, handling caveats, and applicable security markings.

**Cognigate Implementation:**

Since Cognigate has no physical media to label, "marking" is implemented as **logical data classification** within the system:

a. **Capability taxonomy classification:**

   Cognigate classifies data access through its capability taxonomy, which defines 24 capabilities across 7 categories. Each capability is bound to minimum trust tier requirements, creating a hierarchical classification scheme:

   | Category | Example Capabilities | Minimum Trust Tier | Sensitivity |
   |----------|---------------------|-------------------|-------------|
   | Data Access (Read) | CAP-READ-PUBLIC | T0 (Sandbox) | Low |
   | Data Access (Write) | CAP-WRITE-SCOPED | T3 (Monitored) | Moderate |
   | Code Execution | CAP-EXECUTE-SANDBOXED | T2 (Provisional) | Moderate |
   | API Access | CAP-API-EXTERNAL | T4 (Standard) | Moderate-High |
   | Financial | CAP-FINANCIAL-READ | T5 (Trusted) | High |
   | Administration | CAP-ADMIN-CONFIG | T6 (Certified) | High |
   | Self-Modification | CAP-SELF-MODIFY | T7 (Autonomous) | Critical |

b. **Trust tier as sensitivity label:**

   The 8-tier trust model (T0 through T7) functions as a sensitivity classification system:
   - **T0-T1 (Sandbox, Observed):** Public and non-sensitive data only
   - **T2-T3 (Provisional, Monitored):** Internal operational data
   - **T4-T5 (Standard, Trusted):** Sensitive operational and financial data
   - **T6-T7 (Certified, Autonomous):** Administrative and system-critical data

c. **Proof chain classification markers:**
   - Every proof record includes the `capability_namespace` field identifying which data classification category the action belongs to (sandbox, data, comm, execute, financial, admin, efficiency, custom)
   - Every proof record includes the acting entity's `trust_tier` at the time of the action, recording the authorization level
   - These fields serve as machine-readable classification markers on every governance decision

d. **API response classification context:**
   - API responses include the authenticated entity's trust tier and applicable capability set, indicating the classification level of the returned data
   - Error responses do not leak classification context for unauthorized requests (generic 401/403 responses)

### 2.4 MP-4: Media Storage

**Control Requirement:** Physically control and securely store digital media.

**Cognigate Implementation:**

a. **Primary production storage -- PostgreSQL (Neon):**
   - Encryption at rest: AES-256 encryption provided by Neon (built on AWS infrastructure)
   - Automated backups: Neon provides continuous backups with point-in-time recovery (PITR)
   - High availability: Neon manages database replicas and failover
   - Access control: database connections require authenticated credentials; connection strings are stored in Vercel's encrypted environment variable store
   - Physical storage security: inherited from AWS data center controls (SOC 2, FedRAMP authorized)

b. **PROOF chain storage:**
   - Stored in the primary PostgreSQL database with the same encryption-at-rest protections
   - Integrity protection: each record is SHA-256 hashed and Ed25519-signed, providing application-level tamper detection independent of storage-level encryption
   - Retention: 7-year retention policy for all proof chain records (regulatory and audit compliance)
   - Immutability: no API endpoints expose UPDATE or DELETE operations on proof records

c. **Cache storage -- Redis:**
   - Used for session data, velocity counters, and policy evaluation cache (`app/core/cache.py`)
   - Ephemeral by design: all cache entries have configurable TTL (time-to-live)
   - No persistent sensitive data stored in cache; cache loss triggers re-computation from authoritative database
   - Graceful degradation: Cognigate operates without Redis using in-memory fallback

d. **Development storage -- SQLite:**
   - SQLite (`cognigate.db`) is used for local development and single-instance testing only
   - SQLite databases are NOT used in production
   - Developer workstation security is the responsibility of individual developers and organizational IT policy
   - SQLite files are excluded from version control via `.gitignore`

e. **Source code storage -- GitHub:**
   - Private repository with organization-level access controls
   - GitHub provides encryption at rest for all repository data
   - Branch protection rules prevent unauthorized modifications to the `master` branch

### 2.5 MP-5: Media Transport

**Control Requirement:** Protect and control digital media during transport.

**Cognigate Implementation:**

Since Cognigate has no physical media to transport, "transport" refers to digital data in transit:

a. **API communication:**
   - All API communication uses HTTPS with TLS 1.2+ enforced by Vercel's edge network
   - HTTP Strict Transport Security (HSTS) headers prevent protocol downgrade attacks
   - Strong cipher suites are enforced by Vercel's TLS configuration (ECDHE key exchange, AES-GCM encryption)
   - Cognigate does not accept HTTP connections; all traffic is encrypted in transit

b. **Proof chain transport integrity:**
   - When proof records are exported or transmitted to external systems (SIEM, compliance tools, auditor portals), each record carries its own integrity verification data:
     - `hash`: SHA-256 hash of the complete record content
     - `signature`: Ed25519 digital signature over the record hash
     - `previous_hash`: chain linkage enabling full chain verification
   - Recipients can independently verify proof record integrity using Cognigate's public verification key, without relying on transport-layer security alone

c. **Database replication:**
   - Neon manages database replication over encrypted channels within their AWS infrastructure
   - Backup data is stored in AWS S3 with server-side encryption (SSE)

d. **Webhook and event transport:**
   - Incident notifications and event webhooks are transmitted over HTTPS to configured endpoints
   - Webhook payloads include Ed25519 digital signatures for recipient verification, consistent with the proof chain signing infrastructure

e. **Inter-service communication:**
   - Communication between Vercel serverless functions and Neon PostgreSQL uses encrypted connections (SSL/TLS required)
   - Redis connections use TLS when configured for production environments

### 2.6 MP-6: Media Sanitization

**Control Requirement:** Sanitize digital media before disposal, release, or reuse.

**Cognigate Implementation:**

a. **Database sanitization:**
   - Neon provides secure database deletion when a project or branch is terminated
   - Underlying AWS infrastructure performs storage-level sanitization aligned with NIST SP 800-88 Guidelines for Media Sanitization
   - Cognigate does not perform physical media sanitization; this is inherited from the cloud provider

b. **Entity deregistration (credential sanitization):**
   - When an AI agent entity is deregistered via the admin API:
     - Ed25519 public key binding is severed (key removed from entity record)
     - API key hash is deleted from the database
     - Active sessions are immediately invalidated
     - Entity authentication is permanently revoked
   - Proof chain records for the deregistered entity are **retained** for the 7-year retention period (they are audit evidence, not the entity's "media")

c. **Proof chain lifecycle:**
   - Proof chain records are retained for 7 years from creation date per regulatory and audit requirements
   - After the 7-year retention period, records are eligible for purging through a scheduled sanitization process
   - Purging is performed by Vorion Security Engineering and documented in the sanitization log
   - During purging, records are deleted from the database; underlying storage sanitization is provided by Neon/AWS

d. **Cache sanitization:**
   - Redis cache entries expire automatically via TTL (default: configurable per cache type)
   - The admin API provides explicit cache flush capability for immediate sanitization
   - Redis persistence (if enabled) follows the same sanitization procedures as database storage

e. **Development data sanitization:**
   - SQLite development databases can be deleted from the filesystem using standard file deletion
   - Test fixture data does not contain production data (synthetic data only)
   - Developers are responsible for sanitizing their local development environments upon role change or departure

f. **Log sanitization:**
   - Vercel manages log retention and sanitization per their data handling policies
   - Application logs do not contain credentials, private keys, or proof chain content (only references via IDs)
   - Gitleaks in the CI/CD pipeline prevents credential data from entering the log pipeline via code commits

---

## 3. Digital Media Inventory

### 3.1 Production Digital Media

| Asset | Location | Encryption at Rest | Encryption in Transit | Retention | Classification |
|-------|----------|-------------------|----------------------|-----------|---------------|
| PROOF chain records | Neon PostgreSQL | AES-256 (Neon/AWS) | TLS 1.2+ | 7 years | High (governance evidence) |
| Entity registry | Neon PostgreSQL | AES-256 (Neon/AWS) | TLS 1.2+ | Entity lifecycle + 7y | High (identity data) |
| Policy definitions | Neon PostgreSQL + GitHub | AES-256 (Neon/AWS) | TLS 1.2+ | Indefinite (versioned) | Moderate (operational) |
| Trust scores | Neon PostgreSQL | AES-256 (Neon/AWS) | TLS 1.2+ | Entity lifecycle | Moderate (operational) |
| API keys (hashed) | Neon PostgreSQL | AES-256 (Neon/AWS) | TLS 1.2+ | Until rotation/revocation | High (credentials) |
| Ed25519 public keys | Neon PostgreSQL | AES-256 (Neon/AWS) | TLS 1.2+ | Entity lifecycle | Moderate (public key material) |
| Environment variables | Vercel encrypted store | Vercel platform encryption | TLS 1.2+ | Until rotation | Critical (secrets) |
| Application logs | Vercel log drains | Vercel platform encryption | TLS 1.2+ | Vercel retention policy | Low-Moderate |
| Session/velocity cache | Redis | Provider-dependent | TLS 1.2+ | TTL-based (ephemeral) | Low (transient) |
| Source code | GitHub | GitHub platform encryption | TLS 1.2+ / SSH | Indefinite (versioned) | Moderate (proprietary) |
| Database backups | Neon (AWS S3) | AES-256 (SSE) | TLS 1.2+ | Neon PITR window | High (full database copy) |

### 3.2 Non-Production Digital Media

| Asset | Location | Protection | Retention | Notes |
|-------|----------|------------|-----------|-------|
| SQLite dev databases | Developer workstations | Filesystem permissions | Ephemeral | Synthetic data only; not production |
| Test fixtures | GitHub repository | Repository access controls | Indefinite | No production data; no real credentials |
| CI/CD build artifacts | GitHub Actions runners | Ephemeral runners | Job duration only | Destroyed after each CI job |

---

## 4. Inherited Controls

Physical media protection is inherited from Cognigate's cloud service providers. The following table documents the inheritance:

| Physical Control | Provider | Provider Certification | Cognigate Responsibility |
|-----------------|----------|----------------------|--------------------------|
| Disk encryption (at rest) | Neon (AWS) | SOC 2 Type II, FedRAMP | Configure database encryption settings |
| Disk sanitization (disposal) | AWS | NIST SP 800-88 aligned | None (fully inherited) |
| Physical access to storage | AWS data centers | SOC 2, ISO 27001, FedRAMP | None (fully inherited) |
| Media transport (physical) | AWS | SOC 2, ISO 27001 | Not applicable (no physical media) |
| Backup media protection | Neon (AWS S3) | SOC 2 Type II | Configure backup retention settings |
| Environmental controls | AWS | SOC 2, ISO 27001, FedRAMP | None (fully inherited) |
| Fire suppression for storage | AWS | SOC 2, ISO 27001 | None (fully inherited) |
| Edge network infrastructure | Vercel (AWS) | SOC 2 Type II | None (fully inherited) |

Vorion maintains responsibility for verifying that cloud providers maintain their certifications and that their media protection practices remain aligned with Cognigate's security requirements.

---

## 5. Compliance Mapping

This policy satisfies or contributes to the following NIST SP 800-53 Rev 5 controls:

| Control | Title | How This Policy Satisfies |
|---------|-------|--------------------------|
| **MP-1** | Policy and Procedures | This document; annual review commitment; digital media protection procedures |
| **MP-2** | Media Access | Database access via authenticated API only; application-layer access controls; proof chain immutability; no direct DB access in production |
| **MP-3** | Media Marking | Capability taxonomy (7 categories, 24 capabilities) as classification; trust tiers (T0-T7) as sensitivity labels; proof records tagged with classification |
| **MP-4** | Media Storage | PostgreSQL AES-256 encryption at rest (Neon); immutable proof chain with SHA-256 hash integrity; SQLite excluded from production; cloud provider manages physical storage |
| **MP-5** | Media Transport | TLS 1.2+ for all API communication (HSTS enforced); Ed25519 signed proof records for independent integrity verification; HTTPS-only |
| **MP-6** | Media Sanitization | Cloud provider storage sanitization (NIST 800-88 aligned); credential invalidation on entity deregistration; 7-year proof chain retention then purge; cache TTL expiration |

### Cross-Framework Applicability

| Framework | Relevant Controls |
|-----------|-------------------|
| FedRAMP Moderate | MP-1 through MP-6 (identical to NIST 800-53) |
| ISO 27001:2022 | A.7.10 (Storage media), A.8.10 (Information deletion), A.8.24 (Use of cryptography) |
| SOC 2 Type II | CC6.1 (Logical access), CC6.5 (Disposal of confidential information), CC6.7 (Transmission security) |
| GDPR | Article 5(1)(f) (Integrity and confidentiality), Article 17 (Right to erasure), Article 32 (Security of processing) |
| CMMC 2.0 Level 2 | MP.L2-3.8.1 through MP.L2-3.8.9 |

---

## 6. Metrics and Performance Indicators

| Metric | Target | Frequency | Data Source |
|--------|--------|-----------|-------------|
| Encryption compliance rate (% digital assets encrypted at rest) | 100% | Monthly | Neon PostgreSQL encryption status, Vercel environment variable audit, S3 bucket policies |
| Data classification accuracy (capability taxonomy tagging) | >= 95% | Quarterly | PROOF ledger (`capability_namespace` field), policy engine evaluation logs |
| Secure deletion verification rate (entity deregistration credential purge) | 100% | Per deregistration event | Admin API logs, entity registry |
| Media access control compliance (% API accesses properly authenticated) | 100% | Weekly | Structured logs (HTTP 401/403 responses), `app/core/auth.py` |

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
