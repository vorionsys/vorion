# Vorion Platform Migration Guide

This guide documents breaking changes, deprecations, and upgrade paths across the
Vorion monorepo packages. Follow the sections relevant to the version you are
upgrading from.

---

## Table of Contents

- [Current Package Versions](#current-package-versions)
- [Migrating to v0.1.x (ACI to CAR Rename)](#migrating-to-v01x-aci-to-car-rename)
  - [ACI to CAR Rename Overview](#aci-to-car-rename-overview)
  - [Client SDK Migration](#client-sdk-migration)
  - [Contracts Package Migration](#contracts-package-migration)
  - [CLI Migration](#cli-migration)
  - [Database and Route Changes](#database-and-route-changes)
  - [DID Format Change](#did-format-change)
  - [Environment Variable Changes](#environment-variable-changes)
- [Type Deprecations in @vorionsys/contracts](#type-deprecations-in-vorionsyscontracts)
  - [Legacy Common Types](#legacy-common-types)
  - [TrustBand Enum Deprecation](#trustband-enum-deprecation)
  - [FeatureFlags Alias](#featureflags-alias)
- [Type Deprecations in @vorionsys/council](#type-deprecations-in-vorionsyscouncil)
- [Type Deprecations in @vorionsys/basis](#type-deprecations-in-vorionsysbasis)
- [Deprecation Timeline](#deprecation-timeline)
- [Upgrading from Alpha (pre-0.1.0)](#upgrading-from-alpha-pre-010)

---

## Current Package Versions

| Package                       | Version | Status  |
| ----------------------------- | ------- | ------- |
| `@vorionsys/platform` (root)  | 0.1.0   | Stable  |
| `@vorionsys/sdk`              | 0.1.2   | Stable  |
| `@vorionsys/contracts`        | 0.1.2   | Stable  |
| `@vorionsys/cognigate`        | 1.0.2   | Stable  |
| `@vorionsys/car-client`       | 1.0.0   | Stable  |
| `@vorionsys/car-cli`          | 1.0.0   | Stable  |
| `@vorionsys/runtime`          | 0.1.2   | Stable  |
| `@vorionsys/proof-plane`      | 0.1.2   | Stable  |
| `@vorionsys/atsf-core`        | 0.2.2   | Stable  |
| `@vorionsys/basis`            | 1.0.4   | Stable  |
| `@vorionsys/shared-constants` | 1.0.2   | Stable  |
| `@vorionsys/ai-gateway`       | 0.1.0   | Stable  |
| `@vorionsys/council`          | 0.1.0   | Stable  |

All packages require Node.js >= 18.0.0 and TypeScript >= 5.0.0.

---

## Migrating to v0.1.x (ACI to CAR Rename)

The Agent Communication Interface (ACI) concept was absorbed into the Categorical
Agentic Registry (CAR). The identifier string formerly called "ACI" is now "CAR ID".
This eliminates naming confusion where two terms referred to the same artifact.

### ACI to CAR Rename Overview

The rename touched 96 files with ~1,198 individual changes. The following table
summarizes what changed:

| What                | Old                       | New                        |
| ------------------- | ------------------------- | -------------------------- |
| Variable / param    | `aci`                     | `carId`                    |
| Object property     | `.aci`                    | `.carId`                   |
| DB column reference | `agents.aci`              | `agents.carId`             |
| Extension IDs       | `aci-ext-*`               | `car-ext-*`                |
| DID format          | `did:aci:`                | `did:car:`                 |
| Route params        | `{aci}`                   | `{carId}`                  |
| Method names        | `getAgentByAci`           | `getAgentByCarId`          |
| Import path         | `@vorionsys/contracts/aci`| `@vorionsys/contracts/car` |

**Backward-compatible aliases are provided for all public-facing symbols.**
These aliases will be removed in v0.2.0. Migrate your code now.

### Client SDK Migration

`@vorionsys/car-client` (v1.0.0) exports backward-compatible aliases for the
former ACI names:

```typescript
// BEFORE (deprecated -- works today, removed in v0.2.0)
import { ACIClient, ACIError, createACIClient, createLocalACIClient } from '@vorionsys/car-client'

const client = createACIClient({
  baseUrl: 'https://api.agentanchorai.com',
  apiKey: process.env.CAR_API_KEY,
})

// AFTER (recommended)
import { CARClient, CARError, createCARClient, createLocalCARClient } from '@vorionsys/car-client'

const client = createCARClient({
  baseUrl: 'https://api.agentanchorai.com',
  apiKey: process.env.CAR_API_KEY,
})
```

Full alias mapping in `@vorionsys/car-client`:

| Deprecated (ACI)        | Replacement (CAR)        |
| ----------------------- | ------------------------ |
| `ACIClient`             | `CARClient`              |
| `ACIError`              | `CARError`               |
| `createACIClient`       | `createCARClient`        |
| `createLocalACIClient`  | `createLocalCARClient`   |

### Contracts Package Migration

The `@vorionsys/contracts/aci` sub-path export is deprecated and re-exports
everything from `@vorionsys/contracts/car`. Update your import paths:

```typescript
// BEFORE (deprecated)
import { parseACI, generateACI, isValidACI } from '@vorionsys/contracts/aci'

// AFTER (recommended)
import { parseCAR, generateCAR, isValidCAR } from '@vorionsys/contracts/car'
```

The following type and function aliases exist in `@vorionsys/contracts/car` for
backward compatibility:

**Types:**

| Deprecated                | Replacement               |
| ------------------------- | ------------------------- |
| `ParsedACI`              | `ParsedCAR`              |
| `ACIIdentity`            | `CARIdentity`            |
| `ACIParseErrorCode`      | `CARParseErrorCode`      |
| `GenerateACIOptions`     | `GenerateCAROptions`     |
| `ACIValidationError`     | `CARValidationError`     |
| `ACIValidationWarning`   | `CARValidationWarning`   |
| `ACIValidationResult`    | `CARValidationResult`    |
| `ACIJWTClaims`           | `CARJWTClaims`           |
| `ACIAttestationClaim`    | `CARAttestationClaim`    |
| `ACIConstraintsClaim`    | `CARConstraintsClaim`    |

**Constants / Regex:**

| Deprecated                | Replacement               |
| ------------------------- | ------------------------- |
| `ACI_REGEX`              | `CAR_REGEX`              |
| `ACI_PARTIAL_REGEX`      | `CAR_PARTIAL_REGEX`      |
| `ACI_LEGACY_REGEX`       | `CAR_LEGACY_REGEX`       |

**Classes:**

| Deprecated                | Replacement               |
| ------------------------- | ------------------------- |
| `ACIParseError`          | `CARParseError`          |

**Functions:**

| Deprecated                | Replacement               |
| ------------------------- | ------------------------- |
| `parseACI`               | `parseCAR`               |
| `parseLegacyACI`         | `parseLegacyCAR`         |
| `tryParseACI`            | `tryParseCAR`            |
| `safeParseACI`           | `safeParseCAR`           |
| `generateACI`            | `generateCAR`            |
| `generateACIString`      | `generateCARString`      |
| `validateACI`            | `validateCAR`            |
| `isValidACI`             | `isValidCAR`             |
| `isACIString`            | `isCARString`            |
| `updateACI`              | `updateCAR`              |
| `addACIExtensions`       | `addCARExtensions`       |
| `removeACIExtensions`    | `removeCARExtensions`    |
| `incrementACIVersion`    | `incrementCARVersion`    |
| `getACIIdentity`         | `getCARIdentity`         |

**Zod Schemas:**

| Deprecated                   | Replacement                  |
| ---------------------------- | ---------------------------- |
| `parsedACISchema`            | `parsedCARSchema`            |
| `aciStringSchema`            | `carStringSchema`            |
| `aciSchema`                  | `carSchema`                  |
| `generateACIOptionsSchema`   | `generateCAROptionsSchema`   |
| `aciValidationErrorSchema`   | `carValidationErrorSchema`   |
| `aciValidationWarningSchema` | `carValidationWarningSchema` |
| `aciValidationResultSchema`  | `carValidationResultSchema`  |
| `aciAttestationClaimSchema`  | `carAttestationClaimSchema`  |
| `aciConstraintsClaimSchema`  | `carConstraintsClaimSchema`  |
| `aciJWTClaimsSchema`         | `carJWTClaimsSchema`         |

### CLI Migration

`@vorionsys/car-cli` (v1.0.0) also re-exports the backward-compatible ACI
aliases from `@vorionsys/car-client`. The CLI binary itself is `car`:

```bash
# CLI commands (no change -- the binary has always been `car`)
car stats
car evaluate <agentId> <role>
car ceiling <agentId> <score>
car provenance <agentId>
car alerts [status]
car presets
```

If you are importing `@vorionsys/car-cli` programmatically:

```typescript
// BEFORE (deprecated)
import { createACIClient, ACIClient } from '@vorionsys/car-cli'

// AFTER (recommended)
import { createCARClient, CARClient } from '@vorionsys/car-cli'
```

### Database and Route Changes

If you maintain a Vorion-compatible API server or database schema, the following
identifiers changed:

```
DB column:   agents.aci     -> agents.carId
Route param: /agents/:aci   -> /agents/:carId
Method:      getAgentByAci  -> getAgentByCarId
```

**Note:** The HKDF crypto string `aci-pairwise-did-v1` was intentionally
preserved to avoid a cryptographic breaking change. If you derive pairwise
DIDs, no action is needed for that specific constant.

### DID Format Change

```
BEFORE:  did:aci:a3i.acme-corp.invoice-bot:ABF-L3@1.0.0
AFTER:   did:car:a3i.acme-corp.invoice-bot:ABF-L3@1.0.0
```

Existing `did:aci:` identifiers stored in databases or on-chain should continue
to resolve. When minting new identifiers, use the `did:car:` prefix.

### Environment Variable Changes

The CAR CLI accepts both old and new environment variable names. The CAR-prefixed
variables take precedence:

| Old (still works)    | New (preferred)   | Description          |
| -------------------- | ----------------- | -------------------- |
| `VORION_BASE_URL`    | `CAR_API_URL`     | API server base URL  |
| `VORION_API_KEY`     | `CAR_API_KEY`     | API authentication   |

```bash
# BEFORE
export VORION_BASE_URL=https://api.agentanchorai.com
export VORION_API_KEY=your-key

# AFTER (recommended)
export CAR_API_URL=https://api.agentanchorai.com
export CAR_API_KEY=your-key
```

Other Vorion ecosystem environment variables (`VORION_API_PORT`, `VORION_API_HOST`,
`VORION_API_BASE_PATH`, `VORION_API_TIMEOUT`, `VORION_API_RATE_LIMIT`,
`VORION_API_KEY`) used by `@vorionsys/atsf-core` are unchanged.

---

## Type Deprecations in @vorionsys/contracts

### Legacy Common Types

Several types in `@vorionsys/contracts/common` are deprecated in favor of their
canonical v2 equivalents. The deprecated types still work but will be removed
in contracts v1.0:

```typescript
// BEFORE (deprecated)
import type { TrustLevel, Entity, Intent, Decision, TrustSignal, ControlAction } from '@vorionsys/contracts/common'

// AFTER (recommended v2 equivalents)
import { TrustBand, type Intent, type Decision } from '@vorionsys/contracts'
import { RuntimeTier } from '@vorionsys/contracts/car'
import type { TrustEvidence } from '@vorionsys/contracts'
import type { Component } from '@vorionsys/contracts'
```

Specific migration notes:

| Deprecated Type    | Replacement                                        | Notes                                              |
| ------------------ | -------------------------------------------------- | -------------------------------------------------- |
| `TrustLevel`       | `RuntimeTier` from `@vorionsys/contracts/car`      | Numeric 0-7 replaced by named enum                 |
| `Entity`           | `Component` from `@vorionsys/contracts`            | Agent registry type                                |
| `Intent` (common)  | `Intent` from `@vorionsys/contracts` (v2)          | `id` -> `intentId`, `entityId` -> `agentId`, `goal` -> `action` |
| `Decision` (common)| `Decision` from `@vorionsys/contracts` (v2)        | Adds `permitted: boolean`, `trustBand`, `correlationId` |
| `ControlAction` (common) | `ControlAction` from `@vorionsys/contracts/canonical/governance` | Different values: adds `clarify`, `log`, `audit`; removes `limit`, `monitor`, `terminate` |
| `TrustSignal`      | `TrustEvidence` from `@vorionsys/contracts` (v2)   | Different structure                                |

### TrustBand Enum Deprecation

The `TrustBand` enum in `@vorionsys/contracts/v2/enums.ts` is deprecated in
favor of `TrustTier` from `@vorionsys/basis`:

```typescript
// BEFORE (deprecated -- will be removed in contracts v1.0)
import { TrustBand } from '@vorionsys/contracts'

if (agent.trustBand === TrustBand.T4_STANDARD) { /* ... */ }

// AFTER (recommended)
import { TrustTier } from '@vorionsys/basis'
```

### FeatureFlags Alias

```typescript
// BEFORE (deprecated)
import { FeatureFlags } from '@vorionsys/contracts'

// AFTER
import { FLAGS } from '@vorionsys/contracts'
```

---

## Type Deprecations in @vorionsys/council

The council trust subsystem renamed "Dimensions" to "Factors" to align with
the 16-factor trust model. Deprecated aliases are provided:

```typescript
// BEFORE (deprecated)
import {
  DIMENSIONS,
  DIMENSION_WEIGHTS,
  type Dimension,
  type DimensionState,
  type WeightConfig,
} from '@vorionsys/council'

// AFTER (recommended)
import {
  FACTORS,
  FACTOR_WEIGHTS,
  type TrustFactor,
  type FactorState,
  type FactorWeightConfig,
} from '@vorionsys/council'
```

Full alias mapping:

| Deprecated          | Replacement         |
| ------------------- | ------------------- |
| `DIMENSIONS`        | `FACTORS`           |
| `DIMENSION_WEIGHTS` | `FACTOR_WEIGHTS`    |
| `Dimension` (type)  | `TrustFactor`       |
| `DimensionState`    | `FactorState`       |
| `WeightConfig`      | `FactorWeightConfig`|

---

## Type Deprecations in @vorionsys/basis

In `@vorionsys/basis`, the life-critical trust factors are being moved to a
separate healthcare expansion pack:

```typescript
// BEFORE (deprecated)
import { LIFE_CRITICAL_FACTORS, COMBINED_FACTORS } from '@vorionsys/basis'

// AFTER (recommended)
import { CORE_FACTORS } from '@vorionsys/basis'
// Life-critical factors will be available from @vorionsys/basis-healthcare (future)
```

---

## CAR String Format Change: Trust Tier Removed

An important structural change to the CAR string format: trust tier is no
longer embedded in the identifier. Trust is computed at runtime from
attestations, behavioral signals, and deployment context.

```
BEFORE (legacy format with trust tier):
  a3i.acme-corp.invoice-bot:ABF-L3-T4@1.0.0
                                  ^^^
                                  trust tier embedded

AFTER (current format):
  a3i.acme-corp.invoice-bot:ABF-L3@1.0.0
```

If you have stored legacy CAR strings with embedded trust tiers, use
`parseLegacyCAR()` to read them. The `CAR_LEGACY_REGEX` pattern is
available for detection:

```typescript
import { parseLegacyCAR, parseCAR, CAR_LEGACY_REGEX } from '@vorionsys/contracts/car'

const raw = 'a3i.acme-corp.invoice-bot:ABF-L3-T4@1.0.0'

if (CAR_LEGACY_REGEX.test(raw)) {
  // Handles old format with embedded trust tier
  const parsed = parseLegacyCAR(raw)
} else {
  // Current format
  const parsed = parseCAR(raw)
}
```

---

## Deprecation Timeline

| Deprecated Symbol / Feature          | Replacement                         | Introduced | Removal Target |
| ------------------------------------ | ----------------------------------- | ---------- | -------------- |
| All `ACI*` aliases (client, CLI, contracts) | `CAR*` equivalents           | v0.1.0     | v0.2.0         |
| `@vorionsys/contracts/aci` sub-path  | `@vorionsys/contracts/car`          | v0.1.0     | v0.2.0         |
| `did:aci:` DID prefix                | `did:car:`                          | v0.1.0     | v0.2.0         |
| `TrustBand` enum (contracts)         | `TrustTier` from `@vorionsys/basis` | v0.1.0     | contracts v1.0 |
| `FeatureFlags` alias                 | `FLAGS`                             | v0.1.0     | contracts v1.0 |
| `DIMENSIONS` / `Dimension` (council) | `FACTORS` / `TrustFactor`          | v0.1.0     | council v0.2.0 |
| Legacy common types (`Entity`, `Intent`, `Decision`, `TrustSignal`) | v2 canonical types | v0.1.0 | contracts v1.0 |
| `LIFE_CRITICAL_FACTORS` (basis)      | Healthcare expansion pack           | v1.0.0     | basis v2.0.0   |
| `COMBINED_FACTORS` (basis)           | `CORE_FACTORS`                      | v1.0.0     | basis v2.0.0   |
| `VORION_BASE_URL` env var (CAR CLI)  | `CAR_API_URL`                       | v1.0.0     | car-cli v2.0.0 |
| `VORION_API_KEY` env var (CAR CLI)   | `CAR_API_KEY`                       | v1.0.0     | car-cli v2.0.0 |
| `CAR_LEGACY_REGEX` / trust-in-CAR    | `CAR_REGEX` (trust-free format)     | v0.1.0     | contracts v1.0 |

---

## Upgrading from Alpha (pre-0.1.0)

There is no migration path from internal alpha builds (pre-0.1.0). The
alpha packages used different module names (`@vorion/` scope), incompatible
type structures, and a 5-tier trust model (T0-T4) that has since been
replaced by the 8-tier model (T0-T7).

**Recommended action:** Perform a fresh install of all `@vorionsys/` packages.

```bash
# Remove old alpha packages
npm uninstall @vorion/sdk @vorion/contracts @vorion/runtime

# Install current packages
npm install @vorionsys/sdk @vorionsys/contracts @vorionsys/runtime
```

Key differences from alpha:

| Alpha (pre-0.1.0)              | Current (v0.1.x+)                         |
| ------------------------------- | ----------------------------------------- |
| `@vorion/*` npm scope           | `@vorionsys/*` npm scope                  |
| 5-tier trust model (T0-T4)      | 8-tier trust model (T0-T7)                |
| Trust score 0-100               | Trust score 0-1000                        |
| 3 observation tiers              | 5 observation tiers (+ ATTESTED, VERIFIED)|
| No proof plane                   | SHA-256 + SHA3-256 dual-hash audit trail  |
| MIT license                      | Apache-2.0 license                        |
| ACI identifiers only             | CAR identifiers with backward-compat      |
| CommonJS only                    | ESM-first (dual ESM/CJS for Cognigate)    |

---

## Need Help?

- File an issue: https://github.com/vorionsys/vorion/issues
- Documentation: https://vorion.org
- Cognigate API docs: https://cognigate.dev
- CAR spec: https://carid.vorion.org
