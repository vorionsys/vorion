---
sidebar_position: 10
title: Vocabulary (JSON-LD)
---

# ACI Vocabulary

The ACI vocabulary is defined as a JSON-LD context, establishing a formal namespace for ACI concepts and enabling linked data interoperability.

**Namespace:** `https://aci.agentanchor.io/ns/aci/v1#`

## Classes

### AgentClassificationIdentifier

The core ACI identifier with all components.

| Property | Type | Description |
|----------|------|-------------|
| `aci` | string | Full ACI string |
| `registry` | string | Registry identifier |
| `organization` | string | Organization identifier |
| `agentClass` | string | Agent class name |
| `domains` | string[] | Capability domain codes |
| `level` | integer | Capability level (0–5) |
| `trustTier` | integer | Trust tier (0–7) |
| `version` | string | Semver version |

### CapabilityDomain

One of the 10 standardized capability domains.

| Property | Type | Description |
|----------|------|-------------|
| `code` | string | Single-letter domain code |
| `name` | string | Human-readable domain name |
| `bitmask` | integer | Bitmask value for encoding |

### CapabilityAttestation

A verifiable assertion about an agent's capabilities.

| Property | Type | Description |
|----------|------|-------------|
| `issuer` | DID | Attestation issuer |
| `subject` | DID | Attested agent |
| `domains` | string[] | Attested domains |
| `level` | integer | Attested capability level |
| `trustTier` | integer | Attested trust tier |
| `issuanceDate` | dateTime | When issued |
| `expirationDate` | dateTime | When it expires |

### TrustScore

Continuous trust evaluation score.

| Property | Type | Description |
|----------|------|-------------|
| `score` | number | Numeric score (0–1000) |
| `tier` | integer | Mapped trust tier (0–7) |
| `evaluatedAt` | dateTime | Evaluation timestamp |
| `factors` | object | Contributing factor scores |

### ACIExtension

A registered Layer 4 extension.

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Extension identifier |
| `shortcode` | string | Short reference code |
| `version` | string | Extension version |
| `publisher` | DID | Extension publisher |
| `capabilities` | string[] | Extension capability categories |

### DelegationChain

Capability delegation from one agent to another.

| Property | Type | Description |
|----------|------|-------------|
| `delegator` | DID | Delegating agent |
| `delegatee` | DID | Receiving agent |
| `scopeReduction` | object | How capabilities are reduced |
| `depth` | integer | Position in delegation chain |
| `maxDepth` | integer | Maximum allowed depth |

## Context Document

```json
{
  "@context": {
    "aci": "https://aci.agentanchor.io/ns/aci/v1#",
    "AgentClassificationIdentifier": "aci:AgentClassificationIdentifier",
    "CapabilityDomain": "aci:CapabilityDomain",
    "CapabilityAttestation": "aci:CapabilityAttestation",
    "TrustScore": "aci:TrustScore",
    "ACIExtension": "aci:ACIExtension",
    "DelegationChain": "aci:DelegationChain",
    "registry": "aci:registry",
    "organization": "aci:organization",
    "agentClass": "aci:agentClass",
    "domains": "aci:domains",
    "level": "aci:level",
    "trustTier": "aci:trustTier"
  }
}
```
