---
sidebar_position: 2
title: Capability Domains
---

# Capability Domains

CAR defines 10 capability domains, each represented by a single uppercase letter code with a unique bitmask value.

## Domain Table

| Code | Domain | Bitmask | Description |
|------|--------|---------|-------------|
| **A** | Administration | `0x001` | System administration, user management, configuration |
| **B** | Business | `0x002` | Business logic, workflows, approval chains |
| **C** | Communications | `0x004` | Email, messaging, notifications, channels |
| **D** | Data | `0x008` | Data processing, analytics, reporting, ETL |
| **E** | External | `0x010` | Third-party integrations, external APIs |
| **F** | Finance | `0x020` | Financial operations, payments, accounting, trading |
| **G** | Governance | `0x040` | Policy enforcement, compliance, oversight |
| **H** | Hospitality | `0x080` | Venue management, events, catering, scheduling |
| **I** | Infrastructure | `0x100` | Compute, storage, networking, deployment |
| **S** | Security | `0x200` | Authentication, authorization, audit, threat detection |

## Bitmask Encoding

Domains are encoded as a bitmask for efficient storage and comparison:

```typescript
import { encodeDomains, decodeDomains } from '@vorion/car-client';

// Encode domains to bitmask
const mask = encodeDomains(['A', 'B', 'F']); // 0x023 = 35

// Decode bitmask to domain codes
const domains = decodeDomains(0x023); // ['A', 'B', 'F']
```

### Bitmask Operations

```typescript
// Check if agent has a specific domain
function hasDomain(agentMask: number, domain: DomainCode): boolean {
  return (agentMask & DOMAIN_BITMASKS[domain]) !== 0;
}

// Check if agent has ALL required domains
function hasAllDomains(agentMask: number, required: DomainCode[]): boolean {
  const requiredMask = encodeDomains(required);
  return (agentMask & requiredMask) === requiredMask;
}

// Check if agent has ANY of the domains
function hasAnyDomain(agentMask: number, domains: DomainCode[]): boolean {
  const checkMask = encodeDomains(domains);
  return (agentMask & checkMask) !== 0;
}
```

## Domain String Formatting

In the CAR string, domain codes are sorted alphabetically:

```
BFA → ABF (Administration, Business, Finance)
HFC → CFH (Communications, Finance, Hospitality)
SDIG → DGIS (Data, Governance, Infrastructure, Security)
```

## Common Domain Combinations

| Use Case | Domains | CAR Fragment |
|----------|---------|-------------|
| Financial assistant | Business + Finance | `:BF-L3@` |
| Event planner | Communications + Finance + Hospitality | `:CFH-L3@` |
| DevOps bot | External + Infrastructure + Security | `:EIS-L4@` |
| Data analyst | Data + External | `:DE-L2@` |
| Compliance monitor | Data + Governance + Security | `:DGS-L1@` |
| Full-stack agent | All domains | `:ABCDEFGHIS-L5@` |

## Domain Restrictions

- An agent MUST have at least one domain
- Domain authorization is granted via attestation, not self-declared
- Removing a domain requires re-attestation
- Domain scope is enforced at runtime by the trust engine
