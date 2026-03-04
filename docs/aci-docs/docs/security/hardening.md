---
sidebar_position: 1
title: Security Hardening
---

# ACI Security Hardening Specification

Defines mandatory and recommended cryptographic and runtime security controls for production ACI deployments.

## Sender-Constrained Tokens (DPoP)

ACI mandates DPoP (RFC 9449) sender-constrained tokens to prevent token theft and replay attacks.

### Flow

1. Agent generates an ephemeral key pair
2. Agent creates a DPoP proof JWT signed with the private key
3. Authorization server binds the access token to the public key
4. Resource server verifies both the token and the DPoP proof

```typescript
// DPoP proof header
{
  "typ": "dpop+jwt",
  "alg": "ES256",
  "jwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." }
}

// DPoP proof payload
{
  "htm": "POST",
  "htu": "https://api.example.com/action",
  "iat": 1738713600,
  "jti": "unique-id",
  "ath": "<sha256 of access token>"
}
```

## TEE Binding

Agents at T5+ MUST provide hardware attestation from a Trusted Execution Environment:

| TEE Platform | Attestation Type |
|-------------|-----------------|
| Intel SGX | DCAP attestation |
| AWS Nitro Enclave | Nitro attestation document |
| AMD SEV-SNP | SEV-SNP report |
| ARM TrustZone | PSA attestation token |

### DID Document TEE Binding

```json
{
  "aciTEEBinding": {
    "platform": "aws-nitro",
    "enclaveId": "enclave-xxxx",
    "attestationEndpoint": "https://attestation.example.com",
    "pcrValues": { "PCR0": "...", "PCR1": "...", "PCR2": "..." }
  }
}
```

## Pairwise Identity

To prevent correlation attacks, agents SHOULD use pairwise DIDs:

```
pairwise_did = HKDF(master_secret, "did:aci:pairwise:" + relying_party_id)
```

| Data Classification | Pairwise Required |
|--------------------|-------------------|
| Public | No |
| Internal | Recommended |
| Confidential | Yes |
| Restricted | Yes + TEE attestation |

## Revocation Enforcement

| Trust Tier | SLA | Check Type |
|------------|-----|------------|
| T5–T7 | ≤ 1 second | Synchronous, pre-action |
| T3–T4 | ≤ 15 seconds | Pre-action check |
| T1–T2 | ≤ 60 seconds | Periodic polling |
| T0 | ≤ 5 minutes | Best effort |

**Critical Operations**: For actions classified as critical (financial transactions, medical decisions), revocation MUST be checked synchronously regardless of trust tier.

### Recursive Revocation

When an agent is revoked, all delegated agents in the chain are revoked:

```
Agent A (revoked)
 └── Agent B (auto-revoked)
      └── Agent C (auto-revoked)
```

## Delegation Chain Security

| Trust Tier | Max Delegation Depth |
|------------|---------------------|
| T0–T2 | 0 (no delegation) |
| T3–T4 | 2 |
| T5–T6 | 4 |
| T7 | 8 |

**Scope Reduction**: Each delegation MUST reduce scope — a delegatee cannot exceed the delegator's capabilities.

## Security Levels Summary

| Level | Name | Requirements |
|-------|------|-------------|
| **SH-1** | Basic | TLS, signed tokens, basic key management |
| **SH-2** | Standard | DPoP, pairwise DIDs, revocation checks, signed attestations |
| **SH-3** | Hardened | TEE binding, ≤1s revocation SLA, delegation verification, audit logging |
