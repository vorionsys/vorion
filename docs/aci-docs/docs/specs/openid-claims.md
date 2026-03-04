---
sidebar_position: 4
title: OpenID Connect Claims
---

# OpenID Connect Claims Extension for ACI

Defines custom JWT/OIDC claims for embedding agent capability information in ID Tokens and Access Tokens, enabling capability-aware authorization in OAuth 2.0 flows.

## ACI Claims

| Claim | Type | Description |
|-------|------|-------------|
| `aci` | string | Full ACI string |
| `aci_registry` | string | Registry identifier |
| `aci_org` | string | Organization identifier |
| `aci_class` | string | Agent class name |
| `aci_domains` | string[] | Capability domain codes |
| `aci_domains_bitmask` | number | Bitmask of domains |
| `aci_level` | number | Capability level (0–5) |
| `aci_trust` | number | Trust tier (0–7) |
| `aci_trust_score` | number | Numeric trust score (0–1000) |
| `aci_version` | string | ACI version (semver) |
| `aci_attestations` | object[] | Active attestation references |
| `aci_extensions` | string[] | Active extension shortcodes |

## Example Token Payload

```json
{
  "iss": "https://registry.agentanchor.io",
  "sub": "did:aci:agentanchor:vorion:classifier",
  "aud": "https://api.example.com",
  "exp": 1738800000,
  "iat": 1738713600,
  "aci": "aci:agentanchor:vorion:classifier/FH/L3/T5/1.0.0",
  "aci_registry": "agentanchor",
  "aci_org": "vorion",
  "aci_class": "classifier",
  "aci_domains": ["F", "H"],
  "aci_domains_bitmask": 80,
  "aci_level": 3,
  "aci_trust": 5,
  "aci_trust_score": 842,
  "aci_version": "1.0.0",
  "aci_attestations": [{
    "type": "CapabilityAttestation",
    "issuer": "did:aci:agentanchor:vorion:registry",
    "expires": "2027-01-15T00:00:00Z"
  }],
  "aci_extensions": ["cognigate"]
}
```

## ACI-Based OAuth Scopes

ACI defines capability-aware OAuth scopes:

```
aci:F:L3     — Financial domain, Supervised level
aci:FH:L2    — Financial+Healthcare, Assist level
aci:*:L0     — All domains, Observe only
```

### Scope Enforcement

```typescript
// Resource server validates token scopes
function checkAccess(token: ACIToken, requiredDomain: string, requiredLevel: number) {
  if (!token.aci_domains.includes(requiredDomain)) {
    throw new Error(`Domain ${requiredDomain} not in token scope`);
  }
  if (token.aci_level < requiredLevel) {
    throw new Error(`Level L${token.aci_level} insufficient, need L${requiredLevel}`);
  }
}
```

## Security Considerations

- **DPoP Required**: ACI tokens MUST use DPoP sender-constrained tokens (RFC 9449)
- **Token Lifetime**: Max 1 hour for L3+, max 5 minutes for L4+
- **Downgrade Prevention**: `aci_level` and `aci_trust` MUST NOT exceed the agent's registered values
- **Introspection**: Resource servers SHOULD verify tokens via introspection for T4+ agents

## OIDC Provider Metadata

```json
{
  "claims_supported": [
    "aci", "aci_registry", "aci_org", "aci_class",
    "aci_domains", "aci_domains_bitmask", "aci_level",
    "aci_trust", "aci_trust_score", "aci_version",
    "aci_attestations", "aci_extensions"
  ],
  "scopes_supported": [
    "aci:*:L0", "aci:*:L1", "aci:*:L2",
    "aci:*:L3", "aci:*:L4", "aci:*:L5"
  ]
}
```
