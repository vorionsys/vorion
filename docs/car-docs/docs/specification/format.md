---
sidebar_position: 1
title: CAR String Format
---

# CAR String Format

The CAR string is a compact, immutable identifier encoding an agent's identity, capability domains, autonomy level, and version.

## Canonical Format

```
{registry}.{organization}.{agentClass}:{domains}-L{level}@{version}[#extensions]
```

### Components

| Component | Description | Rules |
|-----------|-------------|-------|
| `registry` | Hosting registry | Lowercase alphanumeric |
| `organization` | Registering org | Lowercase alphanumeric + hyphens |
| `agentClass` | Agent type name | Lowercase alphanumeric + hyphens |
| `domains` | Capability domain codes | Uppercase A–Z, sorted alphabetically |
| `level` | Capability level | 0–7 |
| `version` | Agent registration profile version | Semver (major.minor.patch) |
| `extensions` | Optional extensions | Comma-separated shortcodes after `#` |

### Examples

```
a3i.vorion.banquet-advisor:FHC-L3@1.2.0
a3i.acme-corp.invoice-bot:ABF-L3@1.0.0
a3i.hospital-net.triage-agent:DHS-L4@2.0.0
a3i.vorion.classifier:DF-L2@1.0.0#cognigate
```

## Validation Regex

```typescript
const CAR_REGEX = /^([a-z0-9]+)\.([a-z0-9-]+)\.([a-z0-9-]+):([A-Z]+)-L([0-7])@(\d+\.\d+\.\d+)(?:#([a-z0-9,_-]+))?$/;
```

## ABNF Grammar

```abnf
car-string   = registry "." organization "." agent-class
               ":" domains "-L" level "@" version [ "#" extensions ]

registry     = 1*( ALPHA / DIGIT )
organization = 1*( ALPHA / DIGIT / "-" )
agent-class  = 1*( ALPHA / DIGIT / "-" )
domains      = 1*ALPHA                    ; uppercase A-Z, sorted
level        = DIGIT                       ; 0-7
version      = 1*DIGIT "." 1*DIGIT "." 1*DIGIT
extensions   = shortcode *( "," shortcode )
shortcode    = 1*( ALPHA / DIGIT / "-" / "_" )
```

## Design Decisions

### Trust Tier is NOT in the CAR String

Unlike the legacy identifier format, the canonical CAR string does **not** include a trust tier. Trust is:

1. **Dynamic** — changes based on behavior, context, and time
2. **Context-dependent** — different in different deployments
3. **Computed at runtime** from:

```
Trust Score = (Certification × 0.3) + (Behavior History × 0.4) + (Context × 0.3)
```

The effective autonomy an agent receives is:

```
Effective Autonomy = MIN(CAR_Certification_Tier, Vorion_Runtime_Tier)
```

### Domain Codes are Sorted Alphabetically

`FHC` → `CHF` (Communications, Finance, Hospitality sorted). This ensures the same set of domains always produces the same string.

### Extensions are Optional

The `#extensions` suffix enables [Layer 4 runtime governance](/specification/extensions) without breaking backward compatibility.

### Version Semantics

The `version` field identifies the **agent registration profile version**, not the specification version. It tracks changes to an agent's registered capabilities:

- **Major** — Capability level change or domain removal (breaking change to agent's capability profile)
- **Minor** — Domain addition or extension addition (additive capability change)
- **Patch** — Metadata updates, re-attestation with same capabilities

Level graduation (e.g., L3 → L4) produces a new major version: `a3i.vorion.bot:CF-L3@1.2.0` → `a3i.vorion.bot:CF-L4@2.0.0`

## Legacy Format (Deprecated)

The old identifier format included trust tier in the string:

```
{registry}.{organization}.{agentClass}:{domains}-L{level}-T{tier}@{version}
```

This format is still parsed for backward compatibility but should not be used for new registrations.

## TypeScript Types

```typescript
interface ParsedCAR {
  car: string;               // Original CAR string
  registry: string;
  organization: string;
  agentClass: string;
  domains: DomainCode[];     // Sorted array of domain codes
  domainBitmask: number;     // Bitmask encoding of domains
  level: CapabilityLevel;    // 0-7
  version: string;           // Semver
  extensions?: string[];     // Optional extension shortcodes
}
```
