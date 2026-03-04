# Categorical Agent Registry (CAR) Specification

> **Note:** This specification was formerly known as CAR (Agent Classification Identifier).
> It has been renamed to CAR (Categorical Agent Registry) for clarity.
> All references to "CAR" in this document refer to CAR.

---

## ⚠️ DEPRECATED SNAPSHOT

This is an archived snapshot of the specification. For the latest version, see:
- `packages/contracts/src/car/` - TypeScript implementation
- `docs/specs/SPEC-007-car-naming-guide.md` - Naming conventions

---

# Original: Agent Classification Identifier (CAR) Specification

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![npm version](https://badge.fury.io/js/@agentanchor%2Fcar-spec.svg)](https://www.npmjs.com/package/@agentanchor/car-spec)

**CAR** is an open specification for identifying, classifying, and certifying AI agents. It provides a standardized way to encode what an agent can do, how autonomous it is, and how thoroughly it has been verified.

---

## The Problem

As AI agents proliferate, organizations need answers to critical questions:

- **What can this agent do?** (Capabilities)
- **How much autonomy does it have?** (Level)
- **How thoroughly has it been verified?** (Trust)
- **Who certified it?** (Attestations)

Existing identity standards (OAuth, OpenID Connect, SPIFFE) answer "who is this?" but not "what can it safely do?"

---

## The Solution

CAR adds a **capability certification layer** on top of existing identity infrastructure:

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3: APPLICATION (Your agents, customer agents)    │
├─────────────────────────────────────────────────────────┤
│  Layer 2: CAPABILITY & CERTIFICATION  ← CAR             │
│  • What can this agent do? (CapabilityVector)           │
│  • How trusted is it? (Trust Tier)                      │
│  • Who certified it? (Attestation chain)                │
├─────────────────────────────────────────────────────────┤
│  Layer 1: IDENTITY & AUTH (OpenID, SPIFFE, DIDs)        │
│  • Who is this agent?                                   │
│  • Can it authenticate?                                 │
└─────────────────────────────────────────────────────────┘
```

---

## CAR Format

```
[Registry].[Org].[AgentClass]:[Domains]-L[Level]-T[Tier]@[Version]
```

### Example

```
a3i.vorion.banquet-advisor:FHC-L3-T2@1.2.0
```

This identifies an agent:
- **Registry:** `a3i` (AgentAnchor certification authority)
- **Organization:** `vorion`
- **Agent Class:** `banquet-advisor`
- **Domains:** Finance (F), Hospitality (H), Communications (C)
- **Level:** L3 (Can execute with approval)
- **Trust Tier:** T2 (Tested)
- **Version:** 1.2.0

---

## Quick Start

### Installation

```bash
npm install @agentanchor/car-spec
```

### Basic Usage

```typescript
import { parseCAR, validateCAR, satisfiesRequirements } from '@agentanchor/car-spec';

// Parse an CAR string
const parsed = parseCAR('a3i.vorion.banquet-advisor:FHC-L3-T2@1.2.0');
console.log(parsed);
// => { 
//      registry: 'a3i', 
//      organization: 'vorion', 
//      agentClass: 'banquet-advisor', 
//      domains: ['F', 'H', 'C'], 
//      level: 3, 
//      trustTier: 2, 
//      version: '1.2.0' 
//    }

// Validate an CAR string
const result = validateCAR('a3i.vorion.banquet-advisor:FHC-L3-T2@1.2.0');
if (!result.valid) {
  console.error('Validation errors:', result.errors);
}

// Check if agent meets requirements
const meetsReq = satisfiesRequirements(agent.capabilities, {
  domains: ['F', 'H'],
  minLevel: 3,
  minTrust: 2
});
```

---

## Capability Domains

| Code | Domain | Description |
|------|--------|-------------|
| F | Finance | Financial transactions, payments, accounting |
| H | Hospitality | Venue, catering, event management |
| C | Communications | Email, messaging, notifications |
| D | Data | Database, analytics, reporting |
| S | Security | Authentication, authorization, audit |
| G | Governance | Policy, compliance, oversight |
| E | External | Third-party integrations, APIs |
| I | Infrastructure | Compute, storage, networking |

---

## Capability Levels

| Level | Name | Description |
|-------|------|-------------|
| L0 | Observe | Read-only, monitoring |
| L1 | Advise | Can suggest, recommend |
| L2 | Draft | Can prepare, stage changes |
| L3 | Execute | Can act with human approval |
| L4 | Autonomous | Self-directed within bounds |
| L5 | Sovereign | Full autonomy (rare) |

---

## Trust Tiers

| Tier | Name | Description |
|------|------|-------------|
| T0 | Unverified | No certification |
| T1 | Registered | Identity verified only |
| T2 | Tested | Passed capability tests |
| T3 | Certified | Third-party audit passed |
| T4 | Verified | Continuous monitoring |
| T5 | Sovereign | Highest assurance level |

---

## Specifications

| Document | Description |
|----------|-------------|
| [CAR Core Spec](specs/aci-core.md) | Format, encoding, validation |
| [Security Hardening](specs/aci-security-hardening.md) | DPoP, TEE, pairwise DIDs |
| [Semantic Governance](specs/aci-semantic-governance.md) | Layer 5: Intent validation |
| [Extension Protocol](specs/aci-extensions.md) | Layer 4: Runtime extensions |
| [DID Method](specs/did-aci-method.md) | `did:aci:` method specification |
| [OpenID Claims](specs/openid-aci-claims.md) | JWT/OIDC integration |
| [Registry API](specs/registry-api.md) | Agent discovery and query |
| [OWASP Cheatsheet](docs/owasp-aci-cheatsheet.md) | Risk mitigation guidance |

---

## Architecture

### The 5-Layer Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│  LAYER 5: SEMANTIC GOVERNANCE                                           │
│  Intent validation • Instruction integrity • Output binding             │
│  Inference scope • Context authentication • Dual-channel auth           │
├─────────────────────────────────────────────────────────────────────────┤
│  LAYER 4: RUNTIME ASSURANCE (Optional Extensions)                       │
│  Governance • Monitoring • Drift detection • Revocation propagation     │
├─────────────────────────────────────────────────────────────────────────┤
│  LAYER 3: APPLICATION                                                   │
│  Your agents • Customer agents • Third-party agents                     │
├─────────────────────────────────────────────────────────────────────────┤
│  LAYER 2: CAPABILITY & CERTIFICATION (CAR Core)                         │
│  CAR strings • Trust tiers • Attestations • DPoP • TEE binding          │
├─────────────────────────────────────────────────────────────────────────┤
│  LAYER 1: IDENTITY & AUTH                                               │
│  DIDs (pairwise) • OIDC • SPIFFE • OAuth 2.0                            │
└─────────────────────────────────────────────────────────────────────────┘
```

**Why 5 Layers?**

- **Layers 1-2:** Answer "WHO is this agent?" and "WHAT can it do?"
- **Layer 3:** Your application integration
- **Layer 4:** Answer "IS it behaving correctly?" (runtime)
- **Layer 5:** Answer "WHAT is it being instructed to do?" (semantic)

> *"Securing the identity of the agent does not prevent the agent from being confused."*  
> — CAR addresses both identity AND intent.

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    CAPABILITY ROUTER (ACDR)                      │
│  Intent Analysis → Registry Query → Agent Selection → Invocation │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      AGENT REGISTRY (ANS)                        │
│  • Agent registration and discovery                              │
│  • Capability-based queries                                      │
│  • Attestation management                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CERTIFICATION AUTHORITY                       │
│                        (AgentAnchor/A3I)                         │
│  • Capability verification                                       │
│  • Trust tier certification                                      │
│  • Attestation issuance                                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Integration Points

### With DID (Decentralized Identifiers)

```
did:aci:a3i:vorion:banquet-advisor
```

CAR defines a DID method that resolves to a DID Document containing capability information.

### With OpenID Connect

CAR defines custom JWT claims (`aci_*`) for embedding capability information in tokens:

```json
{
  "sub": "agent-12345",
  "aci": "a3i.vorion.banquet-advisor:FHC-L3-T2@1.2.0",
  "aci_domains": 7,
  "aci_level": 3,
  "aci_trust": 2
}
```

### With OAuth 2.0

CAR capabilities can be used as OAuth scopes:

```
scope=aci:F:L3 aci:H:L3 aci:C:L2
```

---

## Repository Structure

```
car-spec/
├── README.md                    # This file
├── STRATEGY.md                  # Strategic positioning
├── package.json                 # npm package config
├── tsconfig.json                # TypeScript config
├── src/
│   ├── index.ts                 # Main exports
│   ├── types/
│   │   └── aci.ts               # Core type definitions
│   ├── validator.ts             # Validation utilities
│   └── security/                # ACDR security layer
├── specs/
│   ├── aci-core.md              # Core specification
│   ├── did-aci-method.md        # DID method spec
│   ├── openid-aci-claims.md     # OpenID claims extension
│   └── registry-api.md          # Registry API spec
├── docs/
│   └── owasp-aci-cheatsheet.md  # OWASP guidance
└── vocab/
    └── aci-vocab.jsonld         # JSON-LD vocabulary
```

---

## Governance

CAR is developed as an open specification by AgentAnchor (A3I). Roadmap:

1. ✅ Core specification complete
2. ✅ TypeScript reference implementation
3. ✅ Security hardening (ACDR layer)
4. 🔄 OpenID Foundation submission
5. 🔄 OWASP Cheat Sheet proposal
6. 📋 W3C CCG engagement
7. 📋 Regional registry federation

---

## License

Apache License 2.0

---

## Links

- **Specification:** https://aci.agentanchor.io
- **Registry:** https://registry.agentanchor.io
- **npm:** https://www.npmjs.com/package/@agentanchor/car-spec
- **GitHub:** https://github.com/voriongit/car-spec

---

**AgentAnchor (A3I)** — Building trust infrastructure for AI agents
