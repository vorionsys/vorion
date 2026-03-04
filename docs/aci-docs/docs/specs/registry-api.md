---
sidebar_position: 5
title: Registry API (ANS)
---

# Agent Registry API Specification

The Agent Naming Service (ANS) provides a RESTful API for agent registration, capability-based discovery, DID resolution, attestation management, and revocation.

**Base URL:** `https://registry.agentanchor.io/api/v1`

## Authentication

| Client Type | Method |
|-------------|--------|
| Organizations | OAuth 2.0 Client Credentials |
| Agents | DID Authentication |

## Agent Registration

### Register Agent

```http
POST /api/v1/agents
Authorization: Bearer <org-token>
Content-Type: application/json

{
  "aci": "aci:agentanchor:vorion:classifier/FH/L3/T5/1.0.0",
  "did": "did:aci:agentanchor:vorion:classifier",
  "publicKey": { "kty": "EC", "crv": "P-256", "..." : "..." },
  "metadata": {
    "description": "Financial and healthcare document classifier",
    "homepage": "https://vorion.org/agents/classifier"
  }
}
```

### Get Agent

```http
GET /api/v1/agents/{did}
```

### Update Agent

```http
PUT /api/v1/agents/{did}
Authorization: DPoP <agent-token>
```

### Deregister Agent

```http
DELETE /api/v1/agents/{did}
Authorization: Bearer <org-token>
```

## Agent Discovery

### Simple Query

```http
GET /api/v1/agents?domains=FH&minLevel=L2&minTrust=T4
```

### Advanced Query

```http
POST /api/v1/agents/query
Content-Type: application/json

{
  "filter": {
    "domains": { "$all": ["F", "H"] },
    "level": { "$gte": 2 },
    "trust": { "$gte": 4 },
    "registry": "agentanchor",
    "extensions": { "$in": ["cognigate"] }
  },
  "sort": { "trust_score": -1 },
  "limit": 20,
  "offset": 0
}
```

## DID Resolution

```http
GET /api/v1/did/{did}
Accept: application/did+json
```

Returns a full DID Document as specified in the [DID Method](/specs/did-method) specification.

## Attestations

### Issue Attestation

```http
POST /api/v1/attestations
Authorization: Bearer <ca-token>
Content-Type: application/json

{
  "subject": "did:aci:agentanchor:vorion:classifier",
  "type": "CapabilityAttestation",
  "claims": {
    "domains": ["F", "H"],
    "level": 3,
    "trust": 5
  },
  "expiresAt": "2027-01-15T00:00:00Z"
}
```

### List Attestations

```http
GET /api/v1/attestations?subject={did}
```

### Revoke Attestation

```http
DELETE /api/v1/attestations/{attestation-id}
Authorization: Bearer <ca-token>
```

## Revocation

### Check Status

```http
GET /api/v1/revocation/{did}
```

### Revocation SLA Tiers

| Trust Tier | Max Propagation | Check Required |
|------------|-----------------|----------------|
| T5–T7 | 1 second | Synchronous |
| T3–T4 | 15 seconds | Pre-action |
| T1–T2 | 60 seconds | Periodic |
| T0 | 5 minutes | Best effort |

### Recursive Revocation

When an agent is revoked, all agents delegated from it are also revoked recursively.

## Commit-Reveal Registration

Anti-front-running mechanism for agent name registration:

1. **Commit**: Hash the desired ACI + nonce, submit with bond
2. **Reveal**: After commit window (10 blocks), reveal the ACI + nonce
3. **Register**: If no conflict, registration proceeds and bond is returned

```http
POST /api/v1/register/commit
{ "commitment": "0x<sha256(aci + nonce)>", "bond": "0.01 ETH" }

POST /api/v1/register/reveal
{ "aci": "aci:agentanchor:vorion:classifier/FH/L3/T5/1.0.0", "nonce": "..." }
```

## Webhooks

| Event | Description |
|-------|-------------|
| `agent.registered` | New agent registered |
| `agent.updated` | Agent metadata updated |
| `agent.revoked` | Agent or attestation revoked |
| `attestation.issued` | New attestation created |
| `trust.changed` | Trust score changed |

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| Registration | 10/minute |
| Discovery | 100/minute |
| DID Resolution | 1000/minute |
| Attestation | 50/minute |

## Error Responses

```json
{
  "error": {
    "code": "AGENT_NOT_FOUND",
    "message": "No agent registered with the specified DID",
    "status": 404
  }
}
```
