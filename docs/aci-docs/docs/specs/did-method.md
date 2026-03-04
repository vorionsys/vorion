---
sidebar_position: 3
title: DID Method (did:aci)
---

# DID Method Specification: did:aci

The `did:aci` method bridges the Categorical Agentic Registry with W3C Decentralized Identifiers, enabling cryptographic verification of agent identity and capabilities via DID Documents with ACI-specific properties.

## Method Syntax

```
did:aci:<registry>:<org>:<agent-class>[:<instance>]
```

**Examples:**

```
did:aci:agentanchor:vorion:classifier          (class-level)
did:aci:agentanchor:vorion:classifier:inst-001  (instance-level)
```

### ABNF

```abnf
did-aci      = "did:aci:" registry ":" org ":" agent-class [ ":" instance ]
registry     = 1*ALPHA
org          = 1*( ALPHA / DIGIT / "-" )
agent-class  = 1*( ALPHA / DIGIT / "-" )
instance     = 1*( ALPHA / DIGIT / "-" )
```

## DID Document

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://aci.agentanchor.io/ns/aci/v1"
  ],
  "id": "did:aci:agentanchor:vorion:classifier",
  "verificationMethod": [{
    "id": "#key-1",
    "type": "JsonWebKey2020",
    "controller": "did:aci:agentanchor:vorion:classifier",
    "publicKeyJwk": { "kty": "EC", "crv": "P-256", "..." : "..." }
  }],
  "authentication": ["#key-1"],
  "assertionMethod": ["#key-1"],
  "aciCapabilities": {
    "aci": "aci:agentanchor:vorion:classifier/FH/L3/T5/1.0.0",
    "domains": ["F", "H"],
    "level": 3,
    "trust": 5,
    "version": "1.0.0"
  },
  "aciAttestations": [{
    "type": "CapabilityAttestation",
    "issuer": "did:aci:agentanchor:vorion:registry",
    "issuanceDate": "2026-01-15T00:00:00Z",
    "expirationDate": "2027-01-15T00:00:00Z"
  }],
  "service": [{
    "id": "#aci-registry",
    "type": "ACIRegistry",
    "serviceEndpoint": "https://registry.agentanchor.io"
  }]
}
```

## CRUD Operations

| Operation | Method | Endpoint |
|-----------|--------|----------|
| **Create** | POST | `/api/v1/did` |
| **Read** | GET | `/api/v1/did/{did}` |
| **Update** | PUT | `/api/v1/did/{did}` |
| **Deactivate** | DELETE | `/api/v1/did/{did}` |

## Resolution

DID resolution follows the [W3C DID Resolution](https://w3c-ccg.github.io/did-resolution/) specification:

1. Parse the DID string to extract registry, org, agent-class, and optional instance
2. Query the appropriate registry endpoint
3. Return the DID Document with resolution metadata

```typescript
const result = await resolve('did:aci:agentanchor:vorion:classifier');
// result.didDocument contains the full DID Document
// result.didResolutionMetadata contains resolution info
// result.didDocumentMetadata contains document metadata
```

## Security Considerations

- **Pairwise DIDs**: Agents SHOULD use pairwise DIDs when interacting with different relying parties to prevent correlation
- **Key Management**: Private keys MUST be stored in secure enclaves (TEE) for T5+ agents
- **DID Method Selection**: Use `did:aci` for ACI-native contexts; bridge to `did:web` or `did:key` for interop

## Privacy Considerations

- **Correlation Risk**: Class-level DIDs can be correlated across services — use instance-level or pairwise DIDs for privacy
- **Capability Exposure**: DID Documents expose capability information — consider redaction for sensitive domains
