# SPEC-007: CAR (Categorical Agentic Registry) Naming Guide

**Version:** 1.0.0
**Status:** Active
**Authors:** Platform Architecture Team
**Date:** 2026-02-02
**Stakeholder:** RION

---

## Executive Summary

This document describes the **Categorical Agentic Registry (CAR)** naming convention, which replaces the previous **Categorical Agentic Registry (CAR)** terminology throughout the Vorion codebase.

**Key Point:** CAR is a **naming change only**. The specification, format, and behavior remain identical to the CAR specification defined in SPEC-003. This change provides market differentiation while maintaining full backwards compatibility.

---

## Terminology Mapping

| Old Term (CAR) | New Term (CAR) | Notes |
|----------------|----------------|-------|
| CAR | CAR | Agent identifier specification |
| Categorical Agentic Registry | Categorical Agentic Registry | Full name |
| ParsedCAR | ParsedCAR | Parsed identifier type |
| CARIdentity | CARIdentity | Identity string type |
| parseCAR() | parseCAR() | Parser function |
| getCARIdentity() | getCARIdentity() | Identity extraction |
| validateCAR() | validateCAR() | Validation function |
| CARTrustContext | CARTrustContext | Trust context type |
| applyCARFloor() | applyCARFloor() | Floor enforcement |
| enforceCARCeiling() | enforceCARCeiling() | Ceiling enforcement |
| calculateEffectiveFromCAR() | calculateEffectiveFromCAR() | Permission calculation |

---

## CAR Format Specification

The CAR format is identical to the CAR format:

```
{registry}.{organization}.{agentClass}:{domains}-L{level}@{version}[#extensions]
```

### Example

```
a3i.vorion.banquet-advisor:FHC-L3@1.2.0#gov,audit
```

| Component | Value | Description |
|-----------|-------|-------------|
| Registry | `a3i` | Certifying registry |
| Organization | `vorion` | Operating organization |
| Agent Class | `banquet-advisor` | Agent classification |
| Domains | `FHC` | Food, Hospitality, Communications |
| Level | `L3` | Capability level 3 |
| Version | `1.2.0` | SemVer version |
| Extensions | `gov,audit` | Governance, Audit extensions |

---

## Import Paths

### Primary Imports (New Code)

```typescript
// Types and parsers
import {
  ParsedCAR,
  CARIdentity,
  parseCAR,
  getCARIdentity,
  validateCAR,
} from '@vorion/contracts/car';

// Trust integration
import {
  CARTrustContext,
  applyCARFloor,
  enforceCARCeiling,
  calculateEffectiveFromCAR,
} from '@vorionsys/platform-core/trust-engine';

// CAR string extensions
import {
  parseExtensions,
  addExtension,
  buildCAR,
} from '@vorionsys/platform-core/car-extensions';
```

### Backwards-Compatible Imports (Existing Code)

All CAR types and functions are re-exported as deprecated aliases:

```typescript
// These still work but are deprecated
import {
  ParsedCAR,          // Alias for ParsedCAR
  CARIdentity,        // Alias for CARIdentity
  parseCAR,           // Alias for parseCAR
} from '@vorion/contracts/car';

// Also available from old path (re-exports from car)
import { ... } from '@vorion/contracts/aci';
```

---

## Migration Guide

### Step 1: Update Imports

Replace CAR imports with CAR imports:

```typescript
// Before
import { ParsedCAR, parseCAR } from '@vorion/contracts/aci';

// After
import { ParsedCAR, parseCAR } from '@vorion/contracts/car';
```

### Step 2: Update Type Annotations

```typescript
// Before
function processAgent(aci: ParsedCAR): void { ... }

// After
function processAgent(car: ParsedCAR): void { ... }
```

### Step 3: Update Function Calls

```typescript
// Before
const parsed = parseCAR(aciString);
const identity = getCARIdentity(parsed);

// After
const parsed = parseCAR(carString);
const identity = getCARIdentity(parsed);
```

### Step 4: Update Variable Names (Optional)

For consistency, consider renaming variables:

```typescript
// Before
const aci = 'a3i.vorion.agent:FHC-L3@1.0.0';

// After
const car = 'a3i.vorion.agent:FHC-L3@1.0.0';
```

---

## Backwards Compatibility

All CAR exports are preserved as deprecated aliases pointing to their CAR equivalents:

```typescript
// @vorion/contracts/car/index.ts

// CAR exports (primary)
export { ParsedCAR, parseCAR, ... };

// CAR exports (deprecated aliases)
/** @deprecated Use ParsedCAR instead */
export type ParsedCAR = ParsedCAR;

/** @deprecated Use parseCAR instead */
export const parseCAR = parseCAR;
```

---

## File Structure

```
packages/contracts/src/
├── car/                           # NEW: Primary CAR types
│   ├── index.ts                   # Barrel exports
│   ├── car-string.ts              # CAR parser
│   ├── identity.ts                # Identity types
│   ├── domains.ts                 # Domain codes
│   ├── levels.ts                  # Capability levels
│   ├── tiers.ts                   # Certification tiers
│   ├── attestation.ts             # Attestation types
│   ├── effective-permission.ts    # Permission calculation
│   ├── jwt-claims.ts              # JWT claim types
│   ├── mapping.ts                 # Tier/level mapping
│   └── skills.ts                  # Skill definitions
└── aci/                           # LEGACY: Re-exports from car/
    └── index.ts                   # Deprecated re-exports

packages/platform-core/src/
├── car-extensions/                # NEW: Primary CAR extensions
│   ├── index.ts                   # Barrel exports
│   └── car-string-extensions.ts   # String manipulation
├── aci-extensions/                # LEGACY: Re-exports from car-extensions/
│   └── aci-string-extensions.ts   # Deprecated re-exports
└── trust-engine/
    ├── car-integration.ts         # NEW: CAR trust integration
    └── aci-integration.ts         # LEGACY: Re-exports from car-integration
```

---

## Related Specifications

- **SPEC-003**: CAR-Vorion Unified Architecture (original specification, applies to CAR)
- **External CAR Spec v1.1.0**: Located at `docs/external/car-spec-v1.1.0/`

---

## Changelog

### 1.0.0 (2026-02-02)

- Initial CAR naming guide
- Documented CAR → CAR terminology mapping
- Migration guide for existing code
- Backwards compatibility strategy
