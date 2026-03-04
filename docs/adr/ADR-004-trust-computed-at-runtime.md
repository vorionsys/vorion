# ADR-004: Trust Computed at Runtime (Not Embedded in CAR)

**Status:** Accepted
**Date:** 2026-01-31
**Deciders:** Vorion Architecture Team

## Context

The Categorical Agentic Registry (CAR) format includes capability domains and level:

```
a3i.vorion.my-agent:FHC-L3@1.0.0
```

Early designs considered embedding trust tier in the CAR string. This was reconsidered.

## Decision

Trust scores and tiers are **NOT** embedded in the CAR. They are computed at runtime from:

- Behavioral attestations
- Credential verification
- Temporal factors (age, consistency)
- Audit results
- Context (caller, operation, environment)

### CAR Contains (Immutable)

- Registry
- Organization
- Agent class
- Capability domains
- Capability level
- Version

### Trust Is (Dynamic)

- Computed per-request or cached with short TTL
- Derived from attestation history
- Context-sensitive (may vary by caller)

## Consequences

### Positive

- Trust reflects current agent behavior, not static claim
- No need to re-issue CAR when trust changes
- Enables context-aware trust (different trust for different operations)
- Prevents trust claim forgery

### Negative

- Every trust check requires computation or cache lookup
- Cannot determine trust from CAR string alone
- Adds latency to trust-gated operations

### Mitigations

- A3I caching layer (ADR-001) provides fast trust lookups
- Trust computed in < 50ms with caching
- Batch operations can pre-fetch trust for multiple agents

## Code Reference

```typescript
// From aci-string.ts
/**
 * CRITICAL DESIGN NOTE:
 * Trust is NOT encoded in the CAR - it is computed at RUNTIME
 * from attestations, behavioral signals, and context.
 */
```

## Alternatives Considered

1. **Embed trust tier in CAR** - Rejected; trust is dynamic, CAR is immutable
2. **Separate trust token** - Rejected; adds complexity without benefit
3. **Trust in JWT claims only** - Rejected; trust needs to be queryable independently

## References

- [aci-core.md](../../packages/contracts/src/aci/aci-string.ts)
- [PLATFORM-ARCHITECTURE.md](../PLATFORM-ARCHITECTURE.md)
