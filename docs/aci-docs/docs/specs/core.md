---
sidebar_position: 1
title: Core Specification
---

# ACI Core Specification

The ACI Core Specification defines the Categorical Agentic Registry format — a hierarchical, human-readable, machine-parseable string that encodes AI agent identity, capability domains, autonomy level, trust tier, and version.

## Format

```
aci:<registry>:<organization>:<agent-class>/<domains>/<level>/<trust>/<version>
```

### ABNF Grammar

```abnf
aci-string  = "aci:" registry ":" organization ":" agent-class
              "/" domains "/" level "/" trust "/" version

registry     = 1*ALPHA
organization = 1*( ALPHA / DIGIT / "-" )
agent-class  = 1*( ALPHA / DIGIT / "-" )
domains      = 1*ALPHA           ; one or more domain codes (A-S)
level        = "L" DIGIT         ; L0 through L5
trust        = "T" DIGIT         ; T0 through T7
version      = semver            ; e.g. 1.0.0
```

### Regex

```regex
^aci:[a-z]+:[a-z0-9-]+:[a-z0-9-]+\/[A-S]+\/L[0-5]\/T[0-7]\/\d+\.\d+\.\d+$
```

## Identity Segment

| Component | Description | Rules |
|-----------|-------------|-------|
| Registry | Hosting registry | Lowercase alpha, globally unique |
| Organization | Registering org | Lowercase alphanumeric + hyphens |
| Agent Class | Agent type name | Lowercase alphanumeric + hyphens |

## Capability Domains

10 standardized domain codes with bitmask encoding:

| Code | Domain | Bit | Hex |
|------|--------|-----|-----|
| A | Administrative | 0x001 | 1 |
| C | Communication | 0x002 | 2 |
| D | Data | 0x004 | 4 |
| E | Engineering | 0x008 | 8 |
| F | Financial | 0x010 | 16 |
| G | General | 0x020 | 32 |
| H | Healthcare | 0x040 | 64 |
| L | Legal | 0x080 | 128 |
| R | Research | 0x100 | 256 |
| S | Security | 0x200 | 512 |

Multiple domains are concatenated alphabetically: `FH` = Financial + Healthcare.

## Capability Levels

Monotonic enforcement — an agent at L3 implicitly has L0–L2 capabilities:

| Level | Name | Description |
|-------|------|-------------|
| L0 | Observe | Read-only monitoring, no side effects |
| L1 | Suggest | Can propose actions, human must execute |
| L2 | Assist | Execute with explicit human approval per action |
| L3 | Supervised | Autonomous within defined policy bounds |
| L4 | Autonomous | Full autonomy with post-hoc audit review |
| L5 | Sovereign | System-level authority, no constraints |

## Trust Tiers

Trust tiers map to ATSF trust scores:

| Tier | Name | Score Range | Color |
|------|------|-------------|-------|
| T0 | Sandbox | 0–199 | Stone |
| T1 | Observed | 200–349 | Red |
| T2 | Provisional | 350–499 | Orange |
| T3 | Monitored | 500–649 | Yellow |
| T4 | Standard | 650–799 | Green |
| T5 | Trusted | 800–875 | Blue |
| T6 | Certified | 876–950 | Purple |
| T7 | Autonomous | 951–1000 | Cyan |

## Validation

```typescript
interface ACIValidationResult {
  valid: boolean;
  aci?: ParsedACI;
  errors?: ACIValidationError[];
}

interface ParsedACI {
  scheme: 'aci';
  registry: string;
  organization: string;
  agentClass: string;
  domains: string[];
  level: number;
  trust: number;
  version: string;
}
```

## Security Considerations

- **Cryptographic Signing**: ACI strings SHOULD be signed using the agent's DID key
- **Escalation Prevention**: Capability level and trust tier MUST NOT increase without re-attestation
- **Registry Trust**: Relying parties MUST verify the registry is trusted before accepting an ACI
- **Version Compatibility**: Breaking changes require major version increment

## References

- [W3C DID Core](https://www.w3.org/TR/did-core/)
- [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html)
- [OAuth 2.0 (RFC 6749)](https://datatracker.ietf.org/doc/html/rfc6749)
- [Verifiable Credentials (W3C)](https://www.w3.org/TR/vc-data-model/)
