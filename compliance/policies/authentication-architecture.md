# Vorion Cognigate Authentication Architecture

**Document ID**: VOR-ARCH-AUTHN-001
**Version**: 1.0
**Classification**: Internal -- Compliance
**Last Updated**: 2026-02-20
**Owner**: Vorion Security Engineering
**Review Cycle**: Quarterly

**NIST SP 800-53 Rev. 5 Controls Addressed**: IA-2(1), IA-2(2), IA-2(12), IA-5(1), IA-8(1), IA-8(2), IA-8(4), IA-12(5), PE-10

---

## Table of Contents

1. [Purpose and Scope](#1-purpose-and-scope)
2. [Current Authentication Architecture](#2-current-authentication-architecture)
3. [Multi-Factor Authentication Strategy](#3-multi-factor-authentication-strategy)
4. [PIV Credential Acceptance](#4-piv-credential-acceptance)
5. [Password-Based Authentication](#5-password-based-authentication)
6. [External Authenticator Acceptance](#6-external-authenticator-acceptance)
7. [Identity Proofing](#7-identity-proofing)
8. [Emergency Shutoff](#8-emergency-shutoff)
9. [Cryptographic Module Inventory](#9-cryptographic-module-inventory)
10. [Authentication Roadmap](#10-authentication-roadmap)
11. [Compliance Mapping](#11-compliance-mapping)

---

## 1. Purpose and Scope

This document defines the authentication architecture for the Vorion Cognigate AI Governance Engine. Cognigate is a governance gateway that mediates autonomous AI agent operations through a structured pipeline: INTENT (goal normalization), ENFORCE (policy evaluation), and PROOF (immutable audit). Authentication mechanisms described herein secure access to this governance pipeline and its administrative interfaces.

### Scope

- **In scope**: All authentication mechanisms for the Cognigate API (v1), including agent entity authentication, administrative access control, cryptographic identity binding, and trust-tier-based authorization.
- **Out of scope**: Authentication for upstream AI model providers (Anthropic, OpenAI, Google, xAI), end-user-facing applications consuming Cognigate decisions, and physical facility access controls (except application-level emergency shutoff per PE-10).

### Audience

This document serves NIST SP 800-53 assessors, Vorion security engineers, and compliance auditors. It distinguishes clearly between **currently implemented** mechanisms and **planned** enhancements to ensure ICP (Initial Compliance Posture) credibility.

### Conventions

Throughout this document:
- **[IMPLEMENTED]** indicates a mechanism that exists in the current production codebase and is verifiable by source code review.
- **[PLANNED]** indicates a mechanism on the development roadmap that is NOT yet implemented.
- **[COMPENSATING]** indicates an interim control that partially addresses a requirement pending full implementation.

---

## 2. Current Authentication Architecture

Cognigate authenticates three categories of principals: AI agent entities, human administrators, and the system itself (for proof record signing). The following subsections describe each mechanism as implemented in the current codebase.

### 2.1 API Key Authentication (Primary Mechanism for AI Agents)

**Status**: [IMPLEMENTED]
**Source**: `cognigate-api/app/config.py`, request headers

AI agent entities authenticate to the Cognigate API by presenting an API key in the `X-API-Key` HTTP header. This is the primary authentication mechanism for all governance pipeline endpoints (`/v1/intent`, `/v1/enforce`, `/v1/proof`).

**Implementation details**:

| Property | Value |
|----------|-------|
| Header name | `X-API-Key` (configurable via `api_key_header` setting) |
| Key entropy | 256-bit (generated via `secrets.token_hex(32)`) |
| Key format | 64-character hexadecimal string |
| Storage | SHA-256 hash of the key (not plaintext) |
| Comparison | `secrets.compare_digest()` for timing-safe validation |
| Transport security | TLS 1.2+ enforced at the edge (Vercel/AWS CloudFront) |

**Key generation** (from `app/core/auth.py`):
```python
def generate_api_key(length: int = 32) -> str:
    return secrets.token_hex(length)  # 256-bit entropy
```

**Security properties**:
- Timing-safe comparison prevents timing side-channel attacks.
- 256-bit entropy makes brute-force infeasible (2^256 keyspace).
- SHA-256 hashing of stored keys means a database compromise does not directly expose usable credentials.
- Keys are not human-memorable and are not passwords; they are machine-generated bearer tokens.

**Limitations**:
- Single-factor authentication only. The API key is a "something you have" factor.
- No built-in key rotation mechanism (operators must manually rotate and redeploy).
- No per-agent key scoping (a valid API key grants access to all pipeline endpoints).

### 2.2 Admin Key Authentication (Privileged Operations)

**Status**: [IMPLEMENTED]
**Source**: `cognigate-api/app/core/auth.py`, `cognigate-api/app/routers/admin.py`

Administrative endpoints (`/v1/admin/*`) require a separate `X-Admin-Key` header. This key gates access to circuit breaker controls, entity halt/unhalt operations, velocity management, and system status monitoring.

**Implementation details**:

| Property | Value |
|----------|-------|
| Header name | `X-Admin-Key` |
| Validation | `secrets.compare_digest(api_key, settings.admin_api_key)` |
| Error on missing | HTTP 401 with `WWW-Authenticate: ApiKey` |
| Error on invalid | HTTP 403 Forbidden |
| Configuration | `ADMIN_API_KEY` environment variable |

**Protected endpoints**:

| Endpoint | Method | Function |
|----------|--------|----------|
| `/v1/admin/circuit` | GET | Get circuit breaker status |
| `/v1/admin/circuit/history` | GET | Get trip history |
| `/v1/admin/circuit/halt` | POST | Manually trip circuit breaker |
| `/v1/admin/circuit/reset` | POST | Manually reset circuit breaker |
| `/v1/admin/entity/halt` | POST | Halt specific entity |
| `/v1/admin/entity/unhalt` | POST | Unhalt specific entity |
| `/v1/admin/entity/cascade-halt` | POST | Halt parent and all children |
| `/v1/admin/velocity` | GET | Get all velocity statistics |
| `/v1/admin/velocity/{entity_id}` | GET | Get entity velocity |
| `/v1/admin/velocity/throttle` | POST | Manually throttle entity |
| `/v1/admin/velocity/unthrottle` | POST | Remove throttle |
| `/v1/admin/status` | GET | Comprehensive system status |

**Security properties**:
- Constant-time comparison via `secrets.compare_digest()`.
- Separate key from the agent API key, enforcing privilege separation.
- All admin actions are logged via `structlog` with structured fields.

**Limitations**:
- Single-factor authentication only (bearer token).
- Single shared admin key (no per-administrator identity).
- No session management or token expiration (key is valid until rotated).

### 2.3 Ed25519 Identity Binding (Proof Record Signing)

**Status**: [IMPLEMENTED]
**Source**: `cognigate-api/app/core/signatures.py`, `cognigate-api/app/routers/proof.py`

Cognigate uses Ed25519 digital signatures for PROOF record integrity and non-repudiation. This mechanism signs governance decisions into an immutable, cryptographically linked audit chain.

**Important clarification**: Ed25519 signatures are currently used for **proof record signing**, not for **request authentication**. Agent entities do not present Ed25519 signatures to authenticate API requests. The signing key is held server-side and applied to PROOF records after governance decisions are made.

**Implementation details**:

| Property | Value |
|----------|-------|
| Algorithm | Ed25519 (RFC 8032) |
| Library | `cryptography` (Python) -- hazmat primitives |
| Key size | 256-bit private key, 256-bit public key |
| Signature size | 64 bytes (base64-encoded for storage) |
| Key sources | PEM file, base64 environment variable, or generated in-memory (dev) |
| Serialization | JSON with `sort_keys=True` for deterministic input |

**Key management modes**:

| Mode | Configuration | Use Case |
|------|---------------|----------|
| File-based | `SIGNATURE_KEY_PATH` env var | Production (key on disk) |
| Environment | `SIGNATURE_PRIVATE_KEY` env var (base64 PEM) | Cloud deployment (Vercel) |
| Ephemeral | Auto-generated at startup | Development only |

**Proof record signing flow**:
1. Governance decision is made (allow/deny/escalate).
2. Record data is serialized deterministically (`json.dumps(data, sort_keys=True)`).
3. SHA-256 hash of the serialized record is computed.
4. Ed25519 signature is computed over the serialized data.
5. Hash and signature are stored in the proof record.
6. Each record's `previous_hash` links to the preceding record, forming a chain.

**Verification** is available via `GET /v1/proof/{proof_id}/verify`, which checks:
- Hash integrity (recomputes and compares)
- Chain linkage (previous_hash matches prior record's hash)
- Signature validity (Ed25519 verification)

### 2.4 Trust Tier Access Control (Capability-Based Authorization)

**Status**: [IMPLEMENTED]
**Source**: `cognigate-api/app/models/common.py`, `cognigate-api/app/core/velocity.py`, `cognigate-api/app/core/policy_engine.py`

Cognigate implements an 8-tier trust model (T0-T7) that controls what capabilities an authenticated entity may exercise. Trust tiers function as an authorization layer that operates after authentication.

**Trust tier definitions**:

| Tier | Name | Score Range | Policy Rigor |
|------|------|-------------|--------------|
| T0 | Sandbox | 0-199 | STRICT |
| T1 | Observed | 200-349 | STRICT |
| T2 | Provisional | 350-499 | STRICT |
| T3 | Monitored | 500-649 | STANDARD |
| T4 | Standard | 650-799 | STANDARD |
| T5 | Trusted | 800-875 | LITE |
| T6 | Certified | 876-950 | LITE |
| T7 | Autonomous | 951-1000 | LITE |

**Capability gating by trust tier** (from the policy engine):
- Shell execution (`shell` tool): Requires T3 (Monitored) or higher.
- PII data access: Requires T2 (Provisional) or higher.
- File deletion: Requires human approval at any trust level.
- Credential access: Requires audit logging at any trust level.
- High-risk actions (risk_score > 0.8): Blocked at all trust levels.
- Medium-risk actions (risk_score > 0.5): Blocked below T3.

The trust tier system is an authorization mechanism, not an authentication mechanism.

---

## 3. Multi-Factor Authentication Strategy

**Controls addressed**: IA-2(1), IA-2(2)

### 3.1 Current State Assessment

**Cognigate currently implements single-factor authentication for all principal types.**

| Principal Type | Current Factor | Factor Category |
|---------------|---------------|-----------------|
| AI agent entities | X-API-Key header | Something you have (bearer token) |
| Human administrators | X-Admin-Key header | Something you have (bearer token) |

This is a known gap against IA-2(1) (MFA for privileged accounts) and IA-2(2) (MFA for non-privileged accounts).

### 3.2 Compensating Controls [COMPENSATING]

Pending MFA implementation, the following compensating controls reduce the risk of single-factor authentication:

**For administrative access (X-Admin-Key)**:
1. **Rate limiting**: All admin endpoints are subject to velocity caps. Brute-force attempts are throttled.
2. **Circuit breaker protection**: Repeated failures or anomalous patterns trigger automatic system halt, blocking all requests including admin operations.
3. **Proof chain recording**: All admin actions that modify system state (halt, reset, throttle) are logged via `structlog` with entity identification, timestamps, and reasons. These logs feed into the PROOF audit chain.
4. **Transport encryption**: TLS 1.2+ is enforced for all connections via the Vercel edge network (AWS CloudFront), preventing credential interception in transit.
5. **Key entropy**: The admin key uses the same 256-bit entropy generation as API keys, making offline brute-force infeasible.
6. **Constant-time comparison**: `secrets.compare_digest()` prevents timing-based oracle attacks against the admin key.

**For agent entity access (X-API-Key)**:
1. **Trust tier isolation**: Even with a valid API key, agents are constrained by their trust tier. A compromised key for a T0 entity cannot perform privileged operations.
2. **Velocity caps**: Per-entity rate limits prevent a stolen key from executing more than the entity's trust-tier-appropriate volume of operations.
3. **Tripwire detection**: Deterministic pattern matching blocks obviously malicious inputs regardless of authentication status.
4. **Critic pattern**: For high-risk operations, an adversarial AI evaluation provides a secondary check on the intent, independent of the entity's authentication status.

### 3.3 MFA Roadmap [PLANNED]

| Phase | Target Date | Mechanism | Principal Type | Implementation |
|-------|------------|-----------|----------------|----------------|
| Phase 1 | Q2 2026 | TOTP (RFC 6238) | Human administrators | Integration with admin dashboard via Auth0 or equivalent OIDC provider. TOTP as second factor for admin API access. |
| Phase 2 | Q3 2026 | Ed25519 challenge-response | AI agent entities | Sign-on-request: agent must sign a server-issued nonce with its registered Ed25519 key in addition to presenting the API key. This leverages the existing Ed25519 infrastructure. |
| Phase 3 | Q4 2026 | FIDO2/WebAuthn | Human administrators | Hardware security key or platform authenticator support for admin access, replacing TOTP. |

**Phase 2 detail -- Ed25519 as second factor for agents**:
The existing Ed25519 signing infrastructure (currently used only for PROOF records) will be extended so that:
1. At entity registration, the agent's Ed25519 public key is recorded.
2. On each authenticated request, the server issues a nonce.
3. The agent must return an Ed25519 signature over the nonce.
4. The server verifies the signature against the registered public key.
5. This transforms authentication from single-factor (API key) to two-factor (API key + cryptographic proof of private key possession).

This approach is architecturally consistent with Cognigate's existing cryptographic infrastructure and does not require agents to support browser-based authentication protocols.

---

## 4. PIV Credential Acceptance

**Controls addressed**: IA-2(12), IA-8(1)

### 4.1 Architectural Approach

Cognigate does not implement a direct CCID/smart card reader interface. The system is a cloud-deployed API gateway (Vercel serverless functions), which precludes direct physical token interaction. Instead, Cognigate supports PIV credential acceptance through **derived credentials**.

### 4.2 PIV Acceptance Path [IMPLEMENTED -- Architectural Support]

The PIV acceptance path leverages Cognigate's existing Ed25519 public key acceptance:

```
PIV Smart Card
  |
  +--> PIV Authentication Certificate (slot 9A)
  |       |
  |       +--> Extract public key
  |               |
  |               +--> Derive Ed25519 key (via key derivation)
  |                       |
  |                       +--> Register at POST /v1/agents
  |                               (entity registration with Ed25519 public key)
  |
  +--> PIV Digital Signature Certificate (slot 9C)
          |
          +--> Used for signing requests (Phase 2 MFA)
```

**Current capability**: Cognigate's entity registration accepts any valid Ed25519 public key. The source of that key -- whether generated locally, extracted from a PIV card, or derived from an X.509 certificate -- is opaque to Cognigate. This means:

- A government PIV cardholder can derive an Ed25519 key from their PIV authentication certificate.
- The derived key is registered as the entity's public key.
- Subsequent operations are authenticated using the standard Cognigate mechanisms.

**Limitations**:
- No direct PIV-to-Cognigate protocol (no PKCS#11, no CCID).
- The key derivation step from PIV to Ed25519 must be performed by client-side tooling.
- No certificate chain validation against a government root CA (planned).

### 4.3 SAML/OIDC Federation [PLANNED -- Interface Defined]

**Source**: `cognigate-api/app/core/federation.py`

To directly accept government identity provider assertions (e.g., login.gov, MAX.gov), Cognigate provides architecturally defined federation interfaces:

| Feature | Status | Standard | Source |
|---------|--------|----------|--------|
| OIDC token validation | [PLANNED -- interface defined] | OpenID Connect Core 1.0 | `validate_oidc_token()` in `federation.py` |
| SAML assertion validation | [PLANNED -- interface defined] | OASIS SAML 2.0 | `validate_saml_assertion()` in `federation.py` |
| Federated identity verification | [PLANNED -- interface defined] | N/A | `verify_federated_identity()` FastAPI dependency |
| Federated identity-to-entity mapping | [PLANNED -- interface defined] | N/A | `map_federated_identity_to_entity()` |
| PIV certificate validation | [PLANNED] | FIPS 201-3, NIST SP 800-73-4 | Not yet defined |

**Configuration** (from `app/config.py`):

| Setting | Type | Default | Purpose |
|---------|------|---------|---------|
| `oidc_enabled` | bool | `False` | Enable OIDC federation |
| `oidc_issuer_url` | str | `""` | OIDC IdP issuer URL (e.g., `https://login.gov`) |
| `oidc_client_id` | str | `""` | OIDC client/application ID |
| `oidc_audience` | str | `""` | Expected audience claim in ID tokens |
| `saml_enabled` | bool | `False` | Enable SAML federation |
| `saml_idp_metadata_url` | str | `""` | SAML IdP metadata URL |

**Architecture**: The federation module defines a `FederatedIdentity` dataclass that captures the validated identity assertion (subject, issuer, protocol, claims) and maps it to a Cognigate `entity_id`. The `verify_federated_identity()` FastAPI dependency provides a drop-in integration point for route handlers, with automatic token format detection (JWT for OIDC, base64 XML for SAML).

**Current state**: All federation functions return HTTP 501 (Not Implemented) with clear [PLANNED] markers and target dates. The interfaces, error handling, configuration integration, and logging are production-ready. When a production IdP is connected (target Q3 2026), the stubs will be replaced with cryptographic token/assertion validation logic.

Federation will enable Cognigate to accept identity assertions from government-operated identity providers, mapping federated identities to Cognigate entity registrations with appropriate trust tier assignment.

---

## 5. Password-Based Authentication

**Control addressed**: IA-5(1)

### 5.1 Agent Authentication: No Passwords

**Cognigate does not use passwords for AI agent entity authentication.** Agent authentication is exclusively key-based (API keys and, in the future, Ed25519 challenge-response). This is a deliberate design decision:

- AI agents are software systems, not humans. They do not benefit from human-memorable credentials.
- API keys with 256-bit entropy provide stronger security than any feasible password policy.
- Key-based authentication eliminates the entire class of password-related vulnerabilities (weak passwords, password reuse, credential stuffing, phishing of passwords).

### 5.2 API Key Strength Validation [IMPLEMENTED]

**Source**: `cognigate-api/app/core/auth.py` -- `validate_api_key_strength()`

Cognigate enforces IA-5(1) authenticator complexity requirements through programmatic validation of all API keys at generation time and at the key creation endpoint. The `validate_api_key_strength(key: str) -> tuple[bool, str]` function validates:

1. **Minimum length**: 32 characters (128-bit entropy minimum). Default generation produces 64-character hex keys (256-bit entropy).
2. **Character class diversity**: Both digits and letters must be present (hex keys naturally satisfy this).
3. **Weak value rejection**: A curated set of known weak/default values is rejected (e.g., `CHANGE_ME_IN_PRODUCTION`, all-zeros, sequential hex).
4. **Pattern-based weakness detection**: Regular expressions detect and reject:
   - All-same-character strings (e.g., `aaaa...a`)
   - Two-character repeating patterns (e.g., `abababab...`)
   - Sequential hex ascending/descending
   - Short patterns repeated 8+ times

**Integration points**:
- `generate_api_key()` validates each generated key and regenerates if weak (up to 5 attempts, with CSPRNG failure alerting).
- `POST /v1/auth/keys` in `app/routers/auth_keys.py` validates generated keys before storage.
- The minimum key length parameter to `generate_api_key()` is enforced at 16 bytes (128-bit minimum).

**Weak value registry** (excerpt from `_KNOWN_WEAK_VALUES`):
```python
_KNOWN_WEAK_VALUES = {
    "CHANGE_ME_IN_PRODUCTION", "changeme", "secret", "password",
    "admin", "test", "default", "0" * 32, "0" * 64, ...
}
```

### 5.3 API Key Properties (Comparison to IA-5(1) Password Requirements)

While API keys are not passwords, the following table maps IA-5(1) password requirements to equivalent API key properties:

| IA-5(1) Requirement | API Key Equivalent | Status |
|---------------------|-------------------|--------|
| Minimum length | 64 hex characters (256-bit); minimum 32 enforced by validation | [IMPLEMENTED] |
| Complexity | Full hexadecimal alphabet, cryptographically random, validated by `validate_api_key_strength()` | [IMPLEMENTED] |
| Prohibition of weak values | Known weak values and patterns rejected at generation and creation | [IMPLEMENTED] |
| Prohibition of reuse | Each key generated independently via `secrets.token_hex()` | [IMPLEMENTED] |
| Lifetime/expiration | No built-in expiration | [PLANNED] -- key rotation policy |
| Storage protection | SHA-256 hashed, never stored in plaintext | [IMPLEMENTED] |
| Transmission protection | TLS 1.2+ for all API communication | [IMPLEMENTED] |
| Resistance to guessing | 2^256 keyspace, timing-safe comparison | [IMPLEMENTED] |

### 5.4 Human Dashboard Access [PLANNED]

When a human-facing administrative dashboard is implemented, password-based authentication will be delegated to an external OIDC provider (Auth0 or equivalent). Cognigate will not implement its own password storage or validation. The external provider will enforce:

- Minimum 12-character passwords
- Bcrypt or Argon2id hashing
- Breach database checking (HaveIBeenPwned integration)
- Account lockout after 5 failed attempts
- Mandatory MFA (see Section 3.3)

This delegation ensures that password policy enforcement is handled by a purpose-built identity provider rather than custom application code.

---

## 6. External Authenticator Acceptance

**Controls addressed**: IA-8(2), IA-8(4)

### 6.1 Current External Authenticator Support [IMPLEMENTED]

Cognigate currently accepts one form of external authenticator:

**Ed25519 public keys**: At entity registration, any valid Ed25519 public key conforming to RFC 8032 is accepted. The key may originate from:
- Client-side key generation (any Ed25519 implementation)
- Hardware security modules (HSMs)
- PIV-derived keys (see Section 4)
- External key management services

The `SignatureManager` class validates Ed25519 keys using the `cryptography` library's `Ed25519PublicKey` interface, which enforces RFC 8032 compliance.

### 6.2 Planned External Authenticator Support [PLANNED]

| Authenticator Type | Standard | Target Date | Use Case |
|-------------------|----------|-------------|----------|
| JWT bearer tokens | RFC 7519 | Q2 2026 | Service-to-service authentication |
| OIDC ID tokens | OpenID Connect Core 1.0 | Q3 2026 | Federated human identity |
| SAML assertions | OASIS SAML 2.0 | Q3 2026 | Government IdP integration |
| FIDO2 attestations | W3C WebAuthn Level 2 | Q4 2026 | Hardware authenticator support |

### 6.3 Approved Authentication Profiles

The following profiles define the accepted external authentication mechanisms and the standards they must conform to:

**Profile 1: Ed25519 Key-Based Authentication** [IMPLEMENTED]
- Standard: RFC 8032 (Edwards-Curve Digital Signature Algorithm)
- Key encoding: PEM (PKCS#8 for private, SubjectPublicKeyInfo for public)
- Signature encoding: Base64
- Verification: `cryptography.hazmat.primitives.asymmetric.ed25519`

**Profile 2: JWT Bearer Token** [PLANNED]
- Standard: RFC 7519 (JSON Web Token)
- Signing algorithms: EdDSA (Ed25519), RS256 (RSA-PKCS1-v1_5)
- Token validation: Issuer verification, audience restriction, expiration enforcement
- Key discovery: JWKS endpoint (RFC 7517)

**Profile 3: OIDC Identity Assertion** [PLANNED]
- Standard: OpenID Connect Core 1.0
- Flow: Authorization Code with PKCE
- Claims required: `sub`, `iss`, `aud`, `exp`, `iat`
- Provider validation: Discovery document verification, JWKS key rotation

---

## 7. Identity Proofing

**Control addressed**: IA-12(5)

### 7.1 Agent Identity Verification [IMPLEMENTED]

When an AI agent entity registers with Cognigate, the following identity proofing steps are performed:

**Entity ID namespace validation**:
- Each entity receives a unique `entity_id` (format: `{prefix}{uuid_hex[:12]}`).
- Entity IDs are generated server-side using `uuid.uuid4()`, preventing client-supplied ID collisions.
- The entity_id namespace prevents cross-entity impersonation within the governance pipeline.

**Public key uniqueness**:
- When Ed25519 signing is enabled, each entity's public key serves as a cryptographic identity.
- Key uniqueness is enforced at registration -- no two entities may register the same public key.

**Contextual metadata capture**:
- Registration requests include contextual metadata that is recorded for identity proofing purposes.
- IP-based geolocation context is available via Vercel edge headers (`x-vercel-ip-city`, `x-vercel-ip-country`, `x-forwarded-for`).
- These headers provide address confirmation context without requiring active geolocation verification.

### 7.2 Trust Tier Escalation Proofing [IMPLEMENTED]

Identity proofing requirements increase with trust tier:

| Trust Tier | Proofing Requirement | Status |
|------------|---------------------|--------|
| T0 (Sandbox) | API key only, self-registration | [IMPLEMENTED] |
| T1 (Observed) | Default registration tier; demonstrated initial behavior | [IMPLEMENTED] |
| T2 (Provisional) | Sustained positive behavior, no violations | [IMPLEMENTED] |
| T3 (Monitored) | Extended compliance history | [IMPLEMENTED] |
| T4 (Standard) | Manual review of behavior history | [IMPLEMENTED -- via admin endpoints] |
| T5 (Trusted) | Administrator review and approval | [IMPLEMENTED -- admin key gated] |
| T6 (Certified) | Administrator authorization required | [IMPLEMENTED -- admin key gated] |
| T7 (Autonomous) | Explicit administrator authorization with documented justification | [IMPLEMENTED -- admin key gated] |

For T6+ trust tiers, escalation requires explicit administrator authorization through the admin API. This ensures that the highest-privilege entities have been identity-proofed through an out-of-band process controlled by the system operator.

### 7.3 Enhanced Identity Proofing [PLANNED]

| Enhancement | Target | Description |
|-------------|--------|-------------|
| Domain verification | Q2 2026 | Entities registering on behalf of an organization must prove control of the organization's domain via DNS TXT record. |
| Certificate-based identity | Q3 2026 | Accept X.509 certificates from trusted CAs for entity identity proofing. |
| Delegated proofing | Q4 2026 | Accept identity proofing assertions from federated identity providers (see Section 4.3). |

---

## 8. Emergency Shutoff

**Control addressed**: PE-10

### 8.1 Application-Level Emergency Shutoff [IMPLEMENTED]

Cognigate implements an application-level emergency shutoff via the circuit breaker system. This provides the functional equivalent of PE-10 (Emergency Shutoff) for a cloud-deployed software system.

**Manual emergency halt**:

```
POST /v1/admin/circuit/halt
Headers: X-Admin-Key: <admin_key>
Body: {"reason": "Emergency shutoff -- <reason>"}
```

**Effect**: When the circuit breaker is tripped (state transitions to `OPEN`):
- ALL incoming requests to the governance pipeline are blocked.
- The `allow_request()` check returns `False` for every entity.
- The block is immediate and system-wide.
- No governance decisions can be made, enforced, or recorded.
- The system returns HTTP responses indicating the circuit is open, with the trip reason.

**Recovery paths**:

| Path | Mechanism | Trigger |
|------|-----------|---------|
| Manual reset | `POST /v1/admin/circuit/reset` with X-Admin-Key | Administrator decision |
| Auto-reset | Timer-based (default 300 seconds) | `auto_reset_at` timestamp expiry |
| Half-open test | 3 successful requests in half-open state | Gradual recovery verification |

**Automatic trip conditions** (in addition to manual halt):

| Condition | Threshold | Source |
|-----------|-----------|--------|
| High-risk action ratio | >10% of requests in window (min 10 requests) | `CircuitBreaker._check_trip_conditions()` |
| Tripwire cascade | 3+ tripwire triggers in 60-second window | Tripwire detection system |
| Injection detection | 2+ injection attempts in metrics window | Intent analysis |
| Critic block cascade | 5+ critic blocks in metrics window | Adversarial AI critic |
| Entity misbehavior | 10+ violations per entity | Per-entity tracking |

**Source references**:
- Circuit breaker implementation: `cognigate-api/app/core/circuit_breaker.py`
- Admin halt endpoint: `cognigate-api/app/routers/admin.py` (`manual_circuit_halt()`)
- Admin reset endpoint: `cognigate-api/app/routers/admin.py` (`manual_circuit_reset()`)

### 8.2 Entity-Level Emergency Shutoff [IMPLEMENTED]

In addition to system-wide shutoff, Cognigate supports targeted entity shutoff:

- **Single entity halt**: `POST /v1/admin/entity/halt` blocks a specific entity while the rest of the system continues operating.
- **Cascade halt**: `POST /v1/admin/entity/cascade-halt` blocks a parent entity and all registered child entities, preventing an entire agent tree from operating.
- **Entity unhalt**: `POST /v1/admin/entity/unhalt` restores a halted entity.

### 8.3 Infrastructure-Level Emergency Shutoff [INHERITED]

Cloud infrastructure emergency shutoff capabilities are inherited from the deployment platform:

| Layer | Provider | Shutoff Mechanism |
|-------|----------|-------------------|
| Edge network | Vercel (AWS CloudFront) | Deployment deactivation, domain removal |
| Serverless compute | Vercel Functions | Function deactivation, environment variable removal |
| Database | PostgreSQL (Neon) | Connection termination, database pause |
| DNS | Vercel DNS | Record removal, CNAME redirection |

These infrastructure-level controls are outside Cognigate's application code but provide defense-in-depth emergency shutoff capability.

---

## 9. Cryptographic Module Inventory

The following table enumerates all cryptographic modules used in Cognigate's authentication and integrity systems.

| Module | Library | Algorithm | Purpose | FIPS Mode |
|--------|---------|-----------|---------|-----------|
| Ed25519 signing | `cryptography` (Python) | Ed25519 (RFC 8032) | PROOF record digital signatures | Supports FIPS mode via OpenSSL backend |
| SHA-256 hashing | `hashlib` (Python, OpenSSL backend) | SHA-256 (FIPS 180-4) | API key storage hashing, proof record chain hashing | FIPS 180-4 compliant |
| SHA3-256 hashing | `hashlib` (Python, OpenSSL backend) | SHA3-256 (FIPS 202) | Not currently used in Cognigate; available in the Python standard library for future use | FIPS 202 compliant |
| API key generation | `secrets` (Python) | CSPRNG (OS-provided) | 256-bit API key generation via `token_hex(32)` | Uses OS CSPRNG (`/dev/urandom` or CryptGenRandom) |
| Timing-safe comparison | `secrets.compare_digest()` | Constant-time byte comparison | API key and admin key validation | N/A (comparison, not cryptographic) |
| TLS termination | Vercel edge (AWS CloudFront) | TLS 1.2+ (AES-GCM, ChaCha20-Poly1305) | Transport encryption for all API traffic | AWS CloudFront supports FIPS endpoints |
| JSON serialization | `json` (Python stdlib) | Deterministic serialization (`sort_keys=True`) | Canonical form for hashing and signing | N/A (serialization, not cryptographic) |

### 9.1 Key Storage Locations

| Key Type | Storage Location | Protection |
|----------|-----------------|------------|
| Admin API key | Environment variable (`ADMIN_API_KEY`) | Vercel encrypted environment variables |
| Agent API keys | SHA-256 hash in database | Hashed at rest, TLS in transit |
| Ed25519 private key (signing) | Environment variable (`SIGNATURE_PRIVATE_KEY`) or PEM file (`SIGNATURE_KEY_PATH`) | Base64-encoded PEM in Vercel encrypted env vars |
| Ed25519 public keys (entities) | Database | Plaintext (public keys are not secret) |

### 9.2 Cryptographic Upgrade Path [PLANNED]

| Current | Planned | Rationale | Target |
|---------|---------|-----------|--------|
| SHA-256 for API key hashing | bcrypt or Argon2id | Memory-hard hashing provides better resistance to GPU-based offline attacks | Q2 2026 |
| No nonce/replay detection | HMAC-based nonce with timestamp window | Prevents request replay attacks | Q3 2026 |
| OpenSSL default mode | FIPS-validated OpenSSL module | Required for FedRAMP environments | Q4 2026 |

---

## 10. Authentication Roadmap

### Phase 1: Foundation Hardening (Q2 2026)

| Item | Description | Controls Addressed |
|------|-------------|-------------------|
| TOTP for admin access | Time-based one-time password as second factor for admin dashboard | IA-2(1) |
| API key rotation | Automated key rotation with configurable lifetime and grace period | IA-5(1) |
| JWT bearer tokens | Accept JWT tokens for service-to-service authentication | IA-8(2) |
| Key hashing upgrade | Migrate from SHA-256 to bcrypt/Argon2id for API key storage hashing | IA-5(1) |
| Domain verification | DNS-based domain verification for organizational identity proofing | IA-12(5) |

### Phase 2: Agent MFA and Federation (Q3 2026)

| Item | Description | Controls Addressed |
|------|-------------|-------------------|
| Ed25519 challenge-response | Sign-on-request as second factor for agent entities | IA-2(2) |
| Nonce-based replay detection | HMAC nonce with timestamp window to prevent request replay | IA-5(1) |
| OIDC federation | Accept identity assertions from external OIDC providers | IA-8(1), IA-8(2), IA-8(4) |
| SAML 2.0 integration | Accept SAML assertions from government identity providers | IA-8(1) |
| Certificate-based identity | Accept X.509 certificates for enhanced identity proofing | IA-12(5) |

### Phase 3: Advanced Authentication (Q4 2026)

| Item | Description | Controls Addressed |
|------|-------------|-------------------|
| FIDO2/WebAuthn | Hardware security key support for human administrators | IA-2(1), IA-2(12) |
| PIV certificate validation | Direct validation of PIV authentication certificates against government root CAs | IA-2(12), IA-8(1) |
| FIPS-validated crypto | Deploy with FIPS-validated OpenSSL module for FedRAMP readiness | IA-5(1) |
| Delegated identity proofing | Accept proofing assertions from federated identity providers | IA-12(5) |

---

## 11. Compliance Mapping

### IA-2(1): Multi-Factor Authentication for Privileged Accounts

| Requirement | Current State | Compensating Controls | Planned Enhancement |
|-------------|--------------|----------------------|-------------------|
| MFA for privileged access | **Not implemented.** Admin access uses single-factor (X-Admin-Key). | Rate limiting, circuit breaker protection, structured audit logging, 256-bit key entropy, TLS transport. | Phase 1: TOTP for admin dashboard. Phase 3: FIDO2/WebAuthn. |

### IA-2(2): Multi-Factor Authentication for Non-Privileged Accounts

| Requirement | Current State | Compensating Controls | Planned Enhancement |
|-------------|--------------|----------------------|-------------------|
| MFA for non-privileged access | **Not implemented.** Agent access uses single-factor (X-API-Key). | Trust tier isolation, per-entity velocity caps, tripwire detection, critic pattern analysis. | Phase 2: Ed25519 challenge-response as second factor. |

### IA-2(12): Acceptance of PIV Credentials

| Requirement | Current State | Compensating Controls | Planned Enhancement |
|-------------|--------------|----------------------|-------------------|
| Accept PIV credentials | **Architecturally supported via derived credentials.** Ed25519 keys from any source (including PIV-derived) are accepted. No direct CCID/smart card interface. | Ed25519 key registration accepts PIV-derived keys. | Phase 3: Direct PIV certificate validation. Phase 2: SAML/OIDC federation for government IdPs. |

### IA-5(1): Password-Based Authentication

| Requirement | Current State | Compensating Controls | Planned Enhancement |
|-------------|--------------|----------------------|-------------------|
| Authenticator complexity enforcement | **Implemented for API keys** via `validate_api_key_strength()` in `app/core/auth.py`. Enforces 128-bit minimum entropy, character class diversity, weak value rejection, and pattern-based weakness detection. Integrated into `generate_api_key()` and `POST /v1/auth/keys`. **Not applicable** for agent passwords (key-based only). **Not yet implemented** for human dashboard access. | API keys exceed all password strength requirements (256-bit entropy). SHA-256 hashing with timing-safe comparison. Programmatic strength validation at generation and creation time. | Phase 1: OIDC provider delegation with configurable password policies for human dashboard. Phase 1: bcrypt/Argon2id key hashing. |

### IA-8(1): Acceptance of External Credentials

| Requirement | Current State | Compensating Controls | Planned Enhancement |
|-------------|--------------|----------------------|-------------------|
| Accept external credentials | **Partially implemented.** Ed25519 public keys from external sources are accepted at registration [IMPLEMENTED]. SAML federation interface defined in `app/core/federation.py` with `validate_saml_assertion()` and configuration settings in `app/config.py` [PLANNED -- interface defined]. | Ed25519 RFC 8032 compliance ensures interoperability with standard key sources. SAML interface architecture is production-ready pending IdP connection. | Phase 2: Connect SAML federation to production government IdPs (login.gov, MAX.gov). Phase 3: Direct PIV certificate validation. |

### IA-8(2): Acceptance of External Authenticators

| Requirement | Current State | Compensating Controls | Planned Enhancement |
|-------------|--------------|----------------------|-------------------|
| Accept third-party authenticators | **Partially implemented.** Any RFC 8032-compliant Ed25519 key is accepted [IMPLEMENTED]. OIDC federation interface defined in `app/core/federation.py` with `validate_oidc_token()`, `verify_federated_identity()` FastAPI dependency, and configuration settings (`oidc_enabled`, `oidc_issuer_url`, `oidc_client_id`, `oidc_audience`) in `app/config.py` [PLANNED -- interface defined]. | Standard-based key acceptance ensures broad authenticator compatibility. OIDC interface architecture supports JWKS-based token validation and federated identity-to-entity mapping. | Phase 1: JWT bearer tokens. Phase 2: Connect OIDC federation to production IdPs. Phase 3: FIDO2 attestations. |

### IA-8(4): Use of Defined Profiles

| Requirement | Current State | Compensating Controls | Planned Enhancement |
|-------------|--------------|----------------------|-------------------|
| Use defined authentication profiles | **One profile defined and implemented** (Ed25519 per RFC 8032). | Strict RFC 8032 compliance via `cryptography` library. | Phase 1: JWT per RFC 7519. Phase 2: OIDC Core 1.0. Phase 3: WebAuthn Level 2. |

### IA-12(5): Address Confirmation

| Requirement | Current State | Compensating Controls | Planned Enhancement |
|-------------|--------------|----------------------|-------------------|
| Identity proofing with address confirmation | **Partially implemented.** IP-based geolocation context captured at registration. Entity ID namespace validation. Admin authorization required for T4+. | Server-side entity ID generation prevents impersonation. Public key uniqueness enforced. | Phase 1: Domain verification. Phase 2: Certificate-based identity. Phase 3: Delegated proofing. |

### PE-10: Emergency Shutoff

| Requirement | Current State | Compensating Controls | Planned Enhancement |
|-------------|--------------|----------------------|-------------------|
| Emergency shutoff capability | **Implemented.** Circuit breaker provides immediate system-wide halt via `POST /v1/admin/circuit/halt`. Auto-trip on safety threshold violations. Entity-level and cascade halt. Auto-reset and manual reset recovery paths. | Multiple automatic trip conditions (high-risk ratio, injection, tripwire cascade, critic blocks). Infrastructure-level shutoff inherited from Vercel/AWS. | No additional enhancement required. Current implementation fully satisfies PE-10. |

---

## 12. Metrics and Performance Indicators

| Metric | Target | Frequency | Data Source |
|--------|--------|-----------|-------------|
| Authentication failure rate by method (API key, admin key) | < 1% of legitimate requests | Weekly | Structured logs (`admin_auth_invalid_key`, HTTP 401/403 responses) |
| Key strength compliance (% meeting 256-bit minimum entropy) | 100% | Monthly | `app/core/auth.py` (`generate_api_key`), entity registry |
| MFA adoption rate (target for roadmap items) | Phase 1 TOTP: 100% admin users by Q2 2026 | Quarterly | Authentication provider logs, roadmap tracking |
| Credential rotation compliance rate | 100% of keys rotated within policy lifetime | Monthly | Entity registry (`expiresAt`), Vercel environment variable audit |

Metrics are reported monthly to the ISSO and quarterly to the Authorizing Official as part of the continuous monitoring program (VOR-POL-CONMON-001).

---

## 13. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Security Architect | _________________ | _________________ | ________ |
| Information System Security Officer (ISSO) | _________________ | _________________ | ________ |
| Authorizing Official | _________________ | _________________ | ________ |

---

## Appendix A: Source Code References

| Component | File Path | Key Functions |
|-----------|-----------|---------------|
| Admin key authentication | `cognigate-api/app/core/auth.py` | `verify_admin_key()`, `optional_admin_key()`, `generate_api_key()`, `validate_api_key_strength()` |
| Federation (OIDC/SAML) | `cognigate-api/app/core/federation.py` | `validate_oidc_token()`, `validate_saml_assertion()`, `verify_federated_identity()`, `map_federated_identity_to_entity()` [PLANNED] |
| Ed25519 signatures | `cognigate-api/app/core/signatures.py` | `SignatureManager`, `sign_proof_record()`, `verify_proof_signature()` |
| Circuit breaker | `cognigate-api/app/core/circuit_breaker.py` | `CircuitBreaker`, `allow_request()`, `manual_halt()`, `manual_reset()` |
| Velocity caps | `cognigate-api/app/core/velocity.py` | `VelocityTracker`, `check_velocity()`, `record_action()` |
| Policy engine | `cognigate-api/app/core/policy_engine.py` | `PolicyEngine`, `evaluate()` |
| Admin endpoints | `cognigate-api/app/routers/admin.py` | All `/admin/*` route handlers |
| Proof chain | `cognigate-api/app/routers/proof.py` | `create_proof_record()`, `verify_proof()` |
| Trust tier model | `cognigate-api/app/models/common.py` | `TRUST_LEVELS`, `TrustLevel` |
| Configuration | `cognigate-api/app/config.py` | `Settings` class (all security-relevant settings) |

## Appendix B: Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-19 | Vorion Security Engineering | Initial document creation |
| 1.1 | 2026-02-20 | Vorion Security Engineering | IA-5(1): Added validate_api_key_strength() implementation. IA-8(1)/IA-8(2): Added federation.py OIDC/SAML interface stubs. Updated compliance mapping and source code references. |
