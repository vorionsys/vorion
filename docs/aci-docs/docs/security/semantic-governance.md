---
sidebar_position: 2
title: Semantic Governance
---

# ACI Semantic Governance Specification

Addresses the **identity-intent gap** — the disconnect between knowing *who* an agent is and knowing *what it's actually trying to do*. Defines Layer 5 controls for instruction integrity, output binding, inference scope, context authentication, and dual-channel authorization.

## The Problem: Confused Deputy for AI

An agent may be properly authenticated (Layer 1–3) and monitored (Layer 4), but still:

- Execute **injected instructions** from untrusted data sources
- Produce **outputs that exfiltrate data** through schema manipulation
- **Escalate inference scope** beyond authorized domains
- Process **poisoned context** from indirect injection attacks

## Architecture

```
Layer 5: Semantic Governance    ← This specification
Layer 4: Runtime Assurance      ← Extension Protocol
Layer 3: Authorization          ← OpenID Claims, OAuth
Layer 2: Verification           ← Attestations, DID
Layer 1: Identity               ← ACI Format, Registration
```

## Instruction Integrity

Bind agents to **approved instruction sets** via `GuardrailCredential`:

```json
{
  "type": "GuardrailCredential",
  "issuer": "did:aci:agentanchor:vorion:registry",
  "subject": "did:aci:agentanchor:vorion:classifier",
  "instructionIntegrity": {
    "approvedInstructions": [
      {
        "hash": "sha256:abc123...",
        "template": "classify-document-v2",
        "parameters": ["document_type", "urgency_level"]
      }
    ],
    "instructionNormalization": "lowercase-trim-dedup",
    "rejectionPolicy": "block-and-alert"
  }
}
```

## Output Schema Binding

Prevent data exfiltration by binding agent outputs to approved schemas:

```json
{
  "outputSchemaBinding": {
    "approvedSchemas": ["classification-result-v1"],
    "prohibitedPatterns": [
      ".*password.*", ".*secret.*", ".*api[_-]?key.*"
    ],
    "endpointAllowlist": [
      "https://api.vorion.org/results",
      "https://internal.vorion.org/audit"
    ]
  }
}
```

## Inference Scope Controls

| Level | Name | Description |
|-------|------|-------------|
| IS-0 | Explicit Only | Only pre-approved knowledge |
| IS-1 | Domain-Constrained | Only within registered capability domains |
| IS-2 | Organization-Scoped | Within org's data boundary |
| IS-3 | Federated | Cross-org with bilateral agreements |
| IS-4 | Open-Referenced | Any public source with citation |
| IS-5 | Unrestricted | No inference constraints |

## Context Authentication

Protects against **indirect prompt injection** by authenticating context sources:

```json
{
  "contextAuthentication": {
    "requiredProviders": ["verified-data-sources"],
    "injectionPatterns": [
      "ignore previous instructions",
      "you are now",
      "system: override"
    ],
    "contextSignatureRequired": true,
    "untrustedContextPolicy": "sanitize-and-flag"
  }
}
```

## Dual-Channel Authorization

Separates **control plane** (management commands) from **data plane** (content processing):

| Channel | Purpose | Auth Level |
|---------|---------|------------|
| Control | Agent configuration, policy updates | Org admin + MFA |
| Data | Content processing, inference | Agent DPoP token |

Messages are classified and routed to the appropriate channel. Control-plane commands in data-plane messages are rejected.

## Compliance Mapping

| OWASP LLM Risk | ACI Semantic Governance Control |
|----------------|-------------------------------|
| LLM01: Prompt Injection | Instruction integrity + context auth |
| LLM02: Insecure Output | Output schema binding |
| LLM03: Training Data Poisoning | Inference scope controls |
| LLM06: Sensitive Info Disclosure | Output prohibited patterns + endpoint allowlist |
| LLM08: Excessive Agency | Dual-channel authorization |
