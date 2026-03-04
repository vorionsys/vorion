# ADR-011: Versioning Strategy

## Status
**Accepted** - January 2025

## Context

The Vorion platform requires a comprehensive versioning strategy across multiple dimensions:

1. **API Versioning** - REST endpoints need backward compatibility
2. **CAR Versioning** - Agent identifiers include version components
3. **Schema Versioning** - Database schemas evolve over time
4. **Contract Versioning** - Trust profiles, governance rules, attestation formats
5. **SDK Versioning** - Client libraries across multiple languages
6. **Protocol Versioning** - A2A message formats

Challenges:
- Breaking changes must be signaled clearly
- Agents may run different versions simultaneously
- Trust attestations must remain valid across versions
- Multi-tenant deployments may have staggered upgrades

## Decision

We implement a **multi-layer versioning strategy** with clear compatibility guarantees:

### 1. Semantic Versioning (SemVer)

All versioned components follow SemVer 2.0.0:

```
MAJOR.MINOR.PATCH[-prerelease][+build]
```

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| Breaking API change | MAJOR | 1.0.0 → 2.0.0 |
| New feature (backward compatible) | MINOR | 1.0.0 → 1.1.0 |
| Bug fix | PATCH | 1.0.0 → 1.0.1 |
| Pre-release | Prerelease tag | 2.0.0-beta.1 |

### 2. API Versioning

REST APIs use URL path versioning:

```
/v1/agents/{aci}
/v1/a2a/invoke
/v2/agents/{aci}  (future)
```

**Versioning Rules:**

| Rule | Description |
|------|-------------|
| Path prefix | `/v{major}/` for all endpoints |
| Default version | Latest stable (currently v1) |
| Deprecation period | 12 months minimum |
| Header support | `X-API-Version` for override |

**Breaking vs Non-Breaking Changes:**

| Breaking (New Major) | Non-Breaking (Minor/Patch) |
|---------------------|---------------------------|
| Removing endpoint | Adding endpoint |
| Removing field | Adding optional field |
| Changing field type | Adding enum value |
| Changing error codes | Changing error messages |
| Changing auth flow | Adding auth method |

### 3. CAR Versioning

Categorical Agentic Registry identifiers include version:

```
{registry}.{org}.{agentClass}:{domains}-L{level}@{version}[#extensions]
```

Example: `a3i.acme.invoice-bot:AF-L3@1.2.0#billing`

**CAR Version Semantics:**

| Version Part | Meaning |
|--------------|---------|
| MAJOR | Incompatible capability changes |
| MINOR | New capabilities added |
| PATCH | Bug fixes, no capability change |

**Version Matching:**

```typescript
// Exact match
matchCAR('*@1.2.3', '...@1.2.3'); // true

// Minor-compatible
matchCAR('*@1.2.x', '...@1.2.5'); // true
matchCAR('*@1.x.x', '...@1.5.0'); // true

// Range
matchCAR('*@>=1.0.0 <2.0.0', '...@1.5.0'); // true
```

### 4. Schema Versioning

Database schemas use numbered migrations:

```
migrations/
├── 0001_initial_schema.sql
├── 0002_add_trust_history.sql
├── 0003_a2a_chains.sql
└── 0004_sandbox_metrics.sql
```

**Migration Rules:**

| Rule | Description |
|------|-------------|
| Forward-only | No down migrations in production |
| Backward-compatible | New columns nullable or with defaults |
| Deployed first | Schema changes before code changes |
| Transaction-wrapped | Each migration atomic |

**Schema Evolution Patterns:**

```sql
-- Adding column (safe)
ALTER TABLE agents ADD COLUMN metadata JSONB DEFAULT '{}';

-- Renaming column (requires transition)
-- Step 1: Add new column
ALTER TABLE agents ADD COLUMN agent_aci TEXT;
-- Step 2: Backfill
UPDATE agents SET agent_aci = aci;
-- Step 3: Code reads both, writes both
-- Step 4: Drop old column after transition
ALTER TABLE agents DROP COLUMN aci;
```

### 5. Contract Versioning

Trust profiles and governance contracts use directory-based versioning:

```
packages/contracts/src/
├── canonical/           # Stable, frozen contracts
│   ├── governance.ts
│   └── trust-score.ts
├── v2/                  # Evolved contracts
│   ├── evidence.ts
│   └── trust-profile.ts
└── experimental/        # Unstable, may change
    └── delegation.ts
```

**Contract Stability Levels:**

| Level | Stability | Breaking Changes |
|-------|-----------|------------------|
| `canonical` | Frozen | Never |
| `v{N}` | Stable | Deprecation path |
| `experimental` | Unstable | Any time |

### 6. Protocol Versioning

A2A messages include version:

```typescript
interface A2AMessage {
  version: '1.0';  // Protocol version
  type: 'invoke' | 'response' | 'stream';
  // ...
}
```

**Protocol Negotiation:**

```typescript
interface NegotiatePayload {
  type: 'negotiate';
  supportedVersions: string[];  // ['1.0', '1.1']
  preferredVersion: string;
}
```

### 7. SDK Versioning

Each SDK publishes version constants:

```typescript
// TypeScript
export const SDK_VERSION = '1.0.0';
export const MIN_API_VERSION = '1.0.0';
export const MAX_API_VERSION = '1.99.99';

// Python
SDK_VERSION = "1.0.0"
MIN_API_VERSION = "1.0.0"

// Go
const SDKVersion = "1.0.0"
```

**SDK Compatibility Matrix:**

| SDK Version | API v1 | API v2 |
|-------------|--------|--------|
| 1.x | ✓ | - |
| 2.x | ✓ | ✓ |
| 3.x | - | ✓ |

## Version Compatibility Utilities

### Version Comparison

```typescript
interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

function parseVersion(version: string): Version;
function compareVersions(a: Version, b: Version): -1 | 0 | 1;
function satisfies(version: Version, range: string): boolean;
function isCompatible(required: Version, actual: Version): boolean;
```

### Deprecation Tracking

```typescript
interface Deprecation {
  feature: string;
  deprecatedIn: string;   // Version deprecated
  removedIn?: string;     // Version removed
  replacement?: string;   // Alternative
  message: string;
}

function deprecationWarning(deprecation: Deprecation): void;
function isDeprecated(feature: string, version: string): boolean;
```

## Implementation

### Files Created

- `src/versioning/index.ts` - Module exports
- `src/versioning/semver.ts` - SemVer parsing and comparison
- `src/versioning/deprecation.ts` - Deprecation tracking
- `src/versioning/compatibility.ts` - Compatibility checking

### API Version Header

```typescript
fastify.addHook('onRequest', (request, reply, done) => {
  const version = request.headers['x-api-version'] || 'v1';
  request.apiVersion = version;
  done();
});
```

### Migration Runner

```typescript
interface MigrationRunner {
  pending(): Promise<string[]>;
  run(target?: string): Promise<void>;
  current(): Promise<string>;
  history(): Promise<Migration[]>;
}
```

## Consequences

### Positive
- **Clear compatibility** - SemVer signals breaking changes
- **Safe evolution** - Deprecation periods prevent surprises
- **Multi-version support** - Agents at different versions can interoperate
- **Audit trail** - Migration history tracks schema evolution

### Negative
- **Maintenance burden** - Supporting multiple versions increases complexity
- **Testing matrix** - Cross-version testing required
- **Documentation** - Each version needs documentation

### Mitigations
- Automated compatibility testing
- Version sunset automation
- Generated documentation per version

## Deprecation Policy

| Phase | Duration | Actions |
|-------|----------|---------|
| Announcement | Day 0 | Deprecation notice in changelog |
| Warning | 0-6 months | Deprecation warnings in logs |
| Sunset | 6-12 months | Feature disabled by default |
| Removal | 12+ months | Feature removed |

## Version Lifecycle

```
experimental → v1-beta → v1 → v1-deprecated → removed
                          ↓
                         v2-beta → v2
```

## References

- [Semantic Versioning 2.0.0](https://semver.org/)
- [ADR-008: A2A Communication Protocol](ADR-008-a2a-communication-protocol.md)
- [ADR-010: Persistence Strategy](ADR-010-persistence-strategy.md)
- [API Versioning Best Practices](https://www.postman.com/api-platform/api-versioning/)
