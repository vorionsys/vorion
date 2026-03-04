# ADR-018: CAR String Semantic Clarifications

**Status:** Accepted
**Date:** 2026-02-20
**Deciders:** Vorion Architecture Team

## Context

The CAR (Certified Agent Registration) string format (`{registry}.{organization}.{agentClass}:{domains}-L{level}@{version}[#extensions]`) had several implementation bugs and semantic ambiguities discovered during deep review:

1. **Regex bug**: The validation regex used `[0-5]` for the level field, but `CapabilityLevel` defines 8 levels (L0-L7). Levels L6 (Certified) and L7 (Sovereign) could not pass validation.
2. **Domain validation bug**: Zod schemas hardcoded only 10 of 26 domain codes (`A-I, S`), while `domains.ts` correctly defines all 26 codes (A-Z) with bitmask encoding.
3. **Version field ambiguity**: No documentation specified whether `@version` refers to the specification version, agent software version, or registration profile version.
4. **Level vs Tier confusion**: The relationship between the immutable CapabilityLevel in the CAR string and the dynamic CertificationTier/RuntimeTier was not clearly documented.

## Decision

### Fix 1: Regex Range — `[0-5]` → `[0-7]`

All CAR validation regex patterns updated to accept the full L0-L7 range across 7 files:
- `packages/contracts/src/car/car-string.ts` (CAR_REGEX, CAR_PARTIAL_REGEX, CAR_LEGACY_REGEX)
- `packages/platform-core/src/car-extensions/car-string-extensions.ts`
- `packages/security/src/car-extensions/car-string-extensions.ts`
- `packages/security/src/aci-extensions/aci-string-extensions.ts`

### Fix 2: Domain Schema — Hardcoded Enum → `domainCodeSchema`

Replaced `z.enum(['A','B','C','D','E','F','G','H','I','S'])` with the canonical `domainCodeSchema` from `domains.ts` that validates all 26 codes (A-Z). This affected two Zod schemas:
- `parsedCARSchema.domains`
- `generateCAROptionsSchema.domains`

### Clarification 1: Version Field Semantics

The `@version` field versions the **agent registration profile** — the combination of identity, domains, level, and extensions that define an agent's registered capabilities. Semver rules:
- **Major**: Level change or domain removal (capability profile breaking change)
- **Minor**: Domain addition, extension addition (additive capability change)
- **Patch**: Metadata updates, re-attestation with unchanged capabilities

### Clarification 2: Level as Declared Capability Class

The `L{n}` in the CAR string is the **Declared Capability Class** — the design-time architectural ceiling of what an agent was built and certified to do. It is:
- Immutable for a given CAR version
- An upper bound, not a runtime guarantee
- One of five factors in the effective permission calculation: `MIN(declared_level, certification_tier, runtime_tier, observability_ceiling, context_policy_ceiling)`

Level graduation (e.g., L3 → L4) requires re-attestation and produces a new major version of the CAR string.

### Future: Supervised Elevation (Wave 2)

A `SupervisionContext` mechanism will allow a higher-level agent to temporarily elevate a lower-level agent's effective permission by up to +2 levels, bounded by the supervisor's own effective level minus 1, with mandatory heartbeat monitoring and full audit trail. This is runtime-only — the CAR string itself never changes.

## Consequences

- Agents declared at L6 (Certified) and L7 (Sovereign) can now pass validation
- All 26 domain codes (A-Z) are accepted in Zod schema validation, matching the `DomainCode` type
- Version field has clear, documented semantics for registry operators
- Snapshot tests for `parsedCARSchema` and `generateCAROptionsSchema` will need updating due to schema shape change
