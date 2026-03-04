# Vorion Cognigate Access Control Policy

**Document ID:** VOR-POL-AC-001
**Version:** 1.0.0
**Effective Date:** 2026-02-19
**Classification:** PUBLIC
**Owner:** Vorion Security Engineering
**Review Cadence:** Annual (next review: 2027-02-19)
**Satisfies:** NIST SP 800-53 Rev 5 AC-2(2), AC-8, AC-11

---

## 1. Purpose and Scope

This policy defines access control procedures for the Vorion Cognigate AI Agent Governance Engine. Cognigate is a FastAPI/Python application deployed on Vercel that enforces the BASIS (Behavioral AI Safety Interoperability Standard) for autonomous AI agent operations through its INTENT, ENFORCE, and PROOF pipeline.

This policy applies to:

- All agent entities registered with Cognigate
- All human administrators accessing admin endpoints
- Emergency and temporary accounts created during incident response
- Dashboard users accessing the AgentAnchor compliance interface

Cognigate operates as a stateless API gateway where "accounts" are agent entity registrations authenticated via API keys (`X-API-Key` header) and admin operations authenticated via admin API keys (`X-Admin-Key` header). This policy adapts traditional account management controls to the AI governance runtime context.

---

## 2. Temporary and Emergency Account Management (AC-2.2)

### 2.1 Agent Entity Lifecycle

Every agent entity registered with Cognigate receives a bounded lifecycle. The entity model (`app/models/common.py`) defines entities with:

- **`entity_id`**: Unique identifier (e.g., `agent_001`)
- **`trust_level`**: Integer trust tier (0-7), mapping to the 8-tier trust model defined in `TRUST_LEVELS` in `app/models/common.py`
- **`trust_score`**: Numeric score (0-1000) within the trust tier, decayed over inactivity

The 8-tier trust model maps scores as follows: T0 Sandbox (0-199), T1 Observed (200-349), T2 Provisional (350-499), T3 Monitored (500-649), T4 Standard (650-799), T5 Trusted (800-875), T6 Certified (876-950), T7 Autonomous (951-1000). New entities default to GRAY_BOX (T1, Observed) with a trust score of 200 unless a different observation tier is specified.

### 2.2 Expiration Enforcement

Agent entities receive an `expiresAt` timestamp at registration time. The system enforces expiration as follows:

| Account Type | Default Expiration | Maximum Extension | Approval Required |
|---|---|---|---|
| Standard Agent | 365 days | Renewable via admin API | No |
| Provisional Agent (T0) | 90 days | 365 days upon promotion to T1+ | No |
| Emergency Admin | 24 hours | Not extendable | CISO or delegate |
| Service Account | 365 days | Renewable via admin API | Admin |

Expired entities lose authentication capability. The `verify_admin_key` function in `app/core/auth.py` performs constant-time comparison (`secrets.compare_digest`) to prevent timing attacks, and expired credentials are rejected before any comparison occurs.

### 2.3 Emergency Accounts

Emergency accounts are temporary admin keys issued during incident response scenarios. These accounts are governed by the following constraints:

1. **Creation**: Emergency admin keys are generated via `generate_api_key()` (`app/core/auth.py`) with a minimum of 32 bytes of entropy (64 hex characters).
2. **Expiration**: Hard-coded 24-hour expiration. No extension is permitted.
3. **Circuit Breaker Integration**: When the circuit breaker (`app/core/circuit_breaker.py`) trips due to safety threshold violations, it records a `CircuitTrip` with an `auto_reset_at` timestamp. Emergency accounts created to investigate the trip inherit this reset window. The `CircuitTrip` dataclass stores:
   - `reason`: The `TripReason` enum value (e.g., `INJECTION_DETECTED`, `MANUAL_HALT`)
   - `auto_reset_at`: Timestamp when the circuit auto-resets (default: 300 seconds / 5 minutes)
   - `entity_id`: Optional entity that triggered the trip
4. **Audit Trail**: All emergency account creation, usage, and expiration events are recorded in the PROOF ledger (`app/models/proof.py`) with `action_type: "emergency_account"` and a full hash chain linkage via `previous_hash`.

### 2.4 Automated Cleanup

The system performs automated cleanup of expired accounts and sessions:

- **Entity Expiration**: Entities past their `expiresAt` timestamp are rejected at authentication time. No background cleanup process is required because Cognigate is stateless -- expired credentials simply fail validation.
- **Trust Decay**: Inactive entities experience trust score decay at a configurable rate (`trust_decay_rate: 0.01` in `app/config.py`). After 182 days of inactivity, an entity's trust score decays to approximately 50% of its original value (half-life model). Entities that decay below T0 thresholds require re-registration.
- **Circuit Breaker Auto-Reset**: The `CircuitBreaker._check_auto_reset()` method transitions circuits from `OPEN` to `HALF_OPEN` state when `auto_reset_at` is reached, allowing limited test requests before full recovery.
- **Halted Entity Recovery**: Entities halted via `halt_entity()` or `cascade_halt()` remain halted until explicitly unhalted by an administrator via `unhalt_entity()`. There is no automatic unhalt -- this is a deliberate safety design.

---

## 3. System Use Notification (AC-8)

### 3.1 API Banner

All Cognigate API responses include the following governance notification header:

```
X-Governance-Notice: This system is operated by Vorion under the BASIS governance standard. All actions are monitored, recorded in a cryptographic proof chain, and subject to automated policy enforcement. Unauthorized use is prohibited. By using this API, you consent to monitoring and recording of all interactions.
```

This header is injected by middleware applied to all `/v1/*` endpoints.

### 3.2 Documentation Landing Page

The Cognigate API documentation (served at the root endpoint and `/docs`) includes the following system use notification prominently displayed before any endpoint documentation:

> **NOTICE**: This is a monitored AI governance system. All API interactions are:
> - Authenticated via API key (`X-API-Key` or `X-Admin-Key` headers)
> - Subject to BASIS policy enforcement through the ENFORCE layer
> - Recorded in a tamper-evident proof chain with Ed25519 digital signatures
> - Subject to trust-based velocity caps and circuit breaker protections
> - Auditable by authorized assessors via compliance endpoints
>
> Unauthorized use, attempted bypass of governance controls, or adversarial manipulation of the trust system is prohibited and will be reported.

### 3.3 Entity Registration Acceptance

At entity registration time, the calling system must acknowledge the following terms:

1. All actions submitted through Cognigate will be recorded in the PROOF ledger
2. The proof chain uses SHA-256 hash linkage and Ed25519 digital signatures (`app/core/signatures.py`) for tamper evidence
3. Trust scores are computed algorithmically and may be adjusted based on behavioral patterns
4. The AI Critic (`app/core/critic.py`) performs adversarial analysis of submitted plans and may flag, escalate, or block actions
5. Velocity caps (`app/core/velocity.py`) enforce per-entity rate limits across four tiers: L0 (burst/second), L1 (sustained/minute), L2 (hourly), L2 (daily)
6. Circuit breakers (`app/core/circuit_breaker.py`) may halt the entire system or individual entities when safety thresholds are exceeded

### 3.4 Notification Text

The canonical system use notification text is:

> This system is monitored and protected by the Vorion Cognigate AI governance engine. All agent actions are recorded in an immutable, cryptographically signed proof chain. Trust scores, policy evaluations, and enforcement decisions are logged for audit and compliance purposes. Velocity caps and circuit breakers protect against abuse. Unauthorized use is prohibited and may result in entity revocation, trust score penalties, and reporting to relevant authorities.

---

## 4. Session Management (AC-11)

### 4.1 Stateless API Architecture

Cognigate operates as a stateless REST API. There are no persistent sessions in the traditional sense. Each request is authenticated independently via API key headers:

- **Agent Requests**: Authenticated via `X-API-Key` header, validated against registered entity credentials
- **Admin Requests**: Authenticated via `X-Admin-Key` header, validated by `verify_admin_key()` in `app/core/auth.py` using constant-time comparison

This architecture inherently satisfies session lock requirements because there is no session to lock -- each request stands alone.

### 4.2 Token and Key Expiration

| Credential Type | Expiration | Configuration |
|---|---|---|
| API Key (Agent) | Configurable, default 365 days | Entity `expiresAt` field |
| Admin API Key | Configurable via `admin_api_key` setting | `app/config.py` |
| Access Token (JWT) | 30 minutes | `access_token_expire_minutes: 30` in `app/config.py` |
| Dashboard Session | 1 hour | AgentAnchor session configuration |

### 4.3 Trust Decay as Session Timeout Analog

In lieu of traditional session timeouts, Cognigate implements trust decay as a behavioral inactivity control:

- **Decay Rate**: Configurable via `trust_decay_rate` (`app/config.py`, default: 0.01)
- **Half-Life**: Approximately 182 days -- after 182 days of inactivity, an entity's effective trust score drops to ~50%
- **Effect**: As trust decays, the entity's velocity caps tighten (lower-trust entities have stricter rate limits per `VELOCITY_LIMITS_BY_TRUST` in `app/core/velocity.py`) and enforcement rigor increases (lower-trust entities receive `STRICT` rigor mode per `RigorMode` in `app/models/enforce.py`)

Trust decay tiers and their corresponding velocity limits (representative values by trust tier):

| Trust Tier | Name | Score Range | Policy Rigor |
|---|---|---|---|
| T0 | Sandbox | 0-199 | STRICT |
| T1 | Observed | 200-349 | STRICT |
| T2 | Provisional | 350-499 | STRICT |
| T3 | Monitored | 500-649 | STANDARD |
| T4 | Standard | 650-799 | STANDARD |
| T5 | Trusted | 800-875 | LITE |
| T6 | Certified | 876-950 | LITE |
| T7 | Autonomous | 951-1000 | LITE |

An entity that decays from a higher trust tier to a lower one experiences progressively tighter velocity caps and stricter policy enforcement, effectively enforcing a progressive "session timeout" through behavioral constraints.

### 4.4 Circuit Breaker Entity Halt

The circuit breaker provides a hard session termination mechanism:

- **Entity-Level Halt**: When an entity accumulates 10+ violations (`entity_violation_threshold` in `CircuitConfig`), it is added to `_halted_entities` and all subsequent requests are blocked
- **Cascade Halt**: Parent entities can be halted along with all registered child agents via `cascade_halt()`
- **System-Wide Halt**: When the circuit trips (e.g., >10% high-risk requests, 3+ tripwire cascades, 2+ injection attempts, or 5+ Critic blocks), all requests are blocked until auto-reset or manual reset

---

## 5. Compliance Mapping

### NIST SP 800-53 Rev 5

| Control | Enhancement | Title | Section | Implementation Status |
|---|---|---|---|---|
| AC-2 | (2) | Automated Temporary and Emergency Account Management | 2 | Implemented |
| AC-8 | -- | System Use Notification | 3 | Implemented |
| AC-11 | -- | Device Lock (Session Lock) | 4 | Implemented (stateless analog) |

### Cross-Framework Mapping

| Control | SOC 2 | ISO 27001:2022 | FedRAMP | CMMC 2.0 |
|---|---|---|---|---|
| AC-2(2) | CC6.1, CC6.2 | A.5.16, A.5.18 | AC-2(2) | AC.L2-3.1.1 |
| AC-8 | CC6.1 | A.5.10 | AC-8 | AC.L2-3.1.9 |
| AC-11 | CC6.1 | A.8.1 | AC-11 | AC.L2-3.1.10 |

### Evidence Artifacts

| Evidence | Location | Type |
|---|---|---|
| Entity lifecycle management | `app/models/common.py`, `app/core/auth.py` | Code |
| Trust decay configuration | `app/config.py` (trust_decay_rate) | Configuration |
| Velocity caps by trust level | `app/core/velocity.py` (VELOCITY_LIMITS_BY_TRUST) | Code |
| Circuit breaker entity halt | `app/core/circuit_breaker.py` | Code |
| Proof chain audit trail | `app/models/proof.py` (ProofRecord) | Code |
| Ed25519 signature system | `app/core/signatures.py` (SignatureManager) | Code |
| Admin authentication | `app/core/auth.py` (verify_admin_key) | Code |
| System use notification | API middleware, documentation | Configuration |

---

## 6. Metrics and Performance Indicators

| Metric | Target | Frequency | Data Source |
|--------|--------|-----------|-------------|
| API key lifecycle compliance rate (% keys within TTL) | >= 98% | Monthly | Entity registry, `app/core/auth.py` |
| Unauthorized access attempt rate | < 0.1% of total requests | Weekly | Structured logs (`admin_auth_invalid_key`, `admin_auth_missing_key`) |
| Trust tier distribution across active entities | No more than 5% at T6-T7 without documented justification | Monthly | Trust engine, `/v1/admin/status` |
| Session timeout enforcement rate (trust decay applied to inactive entities) | 100% | Monthly | Trust engine, `app/config.py` (`trust_decay_rate`) |

Metrics are reported monthly to the ISSO and quarterly to the Authorizing Official as part of the continuous monitoring program (VOR-POL-CONMON-001).

---

## 7. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Information System Security Officer (ISSO) | _________________ | _________________ | ________ |
| System Owner | _________________ | _________________ | ________ |
| Authorizing Official | _________________ | _________________ | ________ |

---

*This document is maintained by Vorion Security Engineering and reviewed annually or upon significant system changes. Changes to this policy require approval from the Vorion CISO or delegate.*
