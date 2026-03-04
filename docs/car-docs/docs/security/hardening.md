---
sidebar_position: 1
title: Security Hardening
---

# Security Hardening

Production CAR deployments require multiple layers of security controls to prevent token theft, identity spoofing, behavioral manipulation, and data exfiltration.

## Sender-Constrained Tokens (DPoP)

CAR mandates DPoP (RFC 9449) tokens to prevent bearer token theft:

```
Agent → generates ephemeral key pair
Agent → creates DPoP proof JWT
Auth Server → binds access token to public key
Resource Server → verifies token + DPoP proof match
```

Token lifetimes are capped by trust tier:

| Tier | Max Token Lifetime |
|------|-------------------|
| T0–T2 | 5 minutes |
| T3–T4 | 30 minutes |
| T5–T6 | 1 hour |
| T7 | 4 hours |

## TEE Binding

Agents at T5+ MUST provide Trusted Execution Environment attestation:

| Platform | Attestation |
|----------|-------------|
| Intel SGX | DCAP |
| AWS Nitro | Nitro document |
| AMD SEV-SNP | SEV report |
| ARM TrustZone | PSA token |

TEE binding ensures code integrity — the agent binary hasn't been tampered with.

## Semantic Governance

Layer 3 controls prevent prompt injection and data exfiltration:

### Instruction Integrity
Agents are bound to pre-approved instruction sets. Unapproved instructions are rejected.

### Output Schema Binding
Agent outputs must conform to approved schemas. Data exfiltration patterns are blocked.

### Context Authentication
Context sources are authenticated to prevent indirect prompt injection.

### Dual-Channel Authorization
Control plane (config changes) and data plane (content processing) are separated.

## Revocation

### SLA by Tier

| Tier | Max Propagation | Check Type |
|------|----------------|------------|
| T5–T7 | ≤ 1 second | Synchronous |
| T3–T4 | ≤ 15 seconds | Pre-action |
| T1–T2 | ≤ 60 seconds | Periodic |
| T0 | ≤ 5 minutes | Best effort |

### Recursive Revocation

When a delegator is revoked, all delegatees in the chain are automatically revoked.

## Security Levels

| Level | Name | Requirements |
|-------|------|-------------|
| **SH-1** | Basic | TLS, signed tokens, basic key management |
| **SH-2** | Standard | DPoP, pairwise DIDs, revocation checks |
| **SH-3** | Hardened | TEE binding, ≤1s revocation, delegation verification, full audit |

## Anti-Gaming Measures

- **Sudden score jumps**: Trigger manual review
- **Oscillating behavior**: Caps maximum achievable tier
- **Rapid context switching**: Resets behavior scoring
- **Coordinated manipulation**: Cross-agent correlation detection
