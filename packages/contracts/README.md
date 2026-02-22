# @vorionsys/contracts

Shared schemas, types, and validators for the Vorion platform -- the single source of truth for trust profiles, intents, decisions, proof events, governance types, and feature flags used across all Vorion services.

## Installation

```bash
npm install @vorionsys/contracts
```

**Peer dependency:** TypeScript >= 5.0 (required for type inference).

## What This Package Provides

| Category | Description |
|---|---|
| **v2 Contract Types** | TypeScript interfaces for Intent, Decision, TrustProfile, ProofEvent, PolicyBundle, CanaryProbe, PreActionGate, Evidence, and Retention |
| **Enums & Constants** | `TrustBand`, `ObservationTier`, `DecisionTier`, `ActionType`, `DataSensitivity`, `ProofEventType`, `RiskLevel`, and more |
| **Canonical Agent Types** | Zod-validated schemas for agent lifecycle, runtime status, capabilities, permissions, tasks, configuration, and governance |
| **CAR (Categorical Agentic Registry)** | Agent identity, CAR string parsing/generation, capability levels (L0-L7), certification/runtime tiers (T0-T7), attestations, JWT claims, effective permissions, domain/skill bitmasks |
| **Validators** | Zod schemas for runtime validation of intents, decisions, trust profiles, and proof events |
| **Common Primitives** | UUID, SemVer, Timestamp, Hash, Actor, TrustBand, AutonomyLevel, Severity, and RiskLevel schemas |
| **Feature Flags** | Centralized `FLAGS` registry with metadata, categories, and utility functions |
| **Database Schemas** | Drizzle ORM table definitions for agents, tenants, attestations, proofs, and more |

## Quick Start

```typescript
import {
  // Enums
  ObservationTier,
  TrustBand,
  DecisionTier,
  ActionType,

  // Interfaces (v2 contracts)
  type Intent,
  type Decision,
  type TrustProfile,
  type ProofEvent,

  // Canonical agent schemas (Zod)
  agentConfigSchema,
  agentLifecycleStatusSchema,

  // Feature flags
  FLAGS,
  isFeatureEnabled,

  // Canonical namespace
  Canonical,
} from '@vorionsys/contracts';

// Use enums directly
const band = TrustBand.T4_STANDARD;
const tier = ObservationTier.GRAY_BOX;

// Validate agent config with Zod
const config = agentConfigSchema.parse({
  agentId: 'agent-001',
  userId: 'user-001',
  userRole: 'operator',
  status: 'active',
  trustScore: 750,
  name: 'Invoice Processor',
  capabilities: ['execute', 'external'],
});

// Check feature flags
if (isFeatureEnabled(FLAGS.TRUST_EDGE_CACHE)) {
  // edge caching is enabled
}
```

## Subpath Imports

The package exposes granular entry points so you only import what you need:

```typescript
// Root -- v2 types + canonical agent types + feature flags
import { TrustBand, ObservationTier, FLAGS } from '@vorionsys/contracts';

// Common shared primitives and legacy types
import { UUIDSchema, ActorSchema, TrustBandSchema } from '@vorionsys/contracts/common';

// v2 contract types
import type { Intent, Decision, TrustProfile } from '@vorionsys/contracts/v2';

// Zod validators for v2 types
import {
  intentSchema,
  decisionSchema,
  trustProfileSchema,
  validate,
  safeValidate,
} from '@vorionsys/contracts/validators';

// CAR (Categorical Agentic Registry) -- identity, capabilities, tiers
import {
  parseCAR,
  generateCAR,
  CapabilityLevel,
  CertificationTier,
  RuntimeTier,
  calculateEffectivePermission,
} from '@vorionsys/contracts/car';

// Canonical governance types
import {
  type TrustBandName,
  type TrustScoreRange,
  type RiskLevel,
} from '@vorionsys/contracts/canonical';

// Canonical governance (direct subpath)
import { ... } from '@vorionsys/contracts/canonical/governance';

// Database schemas (Drizzle ORM)
import { agents, tenants, type Agent } from '@vorionsys/contracts/db';
```

## Usage Examples

### Validating Data with Zod Schemas

```typescript
import {
  intentSchema,
  validate,
  safeValidate,
  formatValidationErrors,
} from '@vorionsys/contracts/validators';

// Throws ZodError on invalid data
const intent = validate(intentSchema, incomingData);

// Returns a result object instead of throwing
const result = safeValidate(intentSchema, incomingData);
if (result.success) {
  console.log('Valid intent:', result.data);
} else {
  console.error(formatValidationErrors(result.errors));
}
```

### Canonical Agent Configuration

```typescript
import {
  agentConfigSchema,
  agentCapabilitySchema,
  type AgentConfig,
  type AgentLifecycleStatus,
  canTransitionLifecycleStatus,
} from '@vorionsys/contracts';

// Validate and narrow types
const config: AgentConfig = agentConfigSchema.parse(rawData);

// Check lifecycle transitions
const canActivate = canTransitionLifecycleStatus('training', 'active'); // true
const canArchive = canTransitionLifecycleStatus('archived', 'active');  // false
```

### CAR String Parsing and Generation

```typescript
import {
  parseCAR,
  generateCAR,
  CapabilityLevel,
  calculateEffectivePermission,
  CertificationTier,
  RuntimeTier,
} from '@vorionsys/contracts/car';

// Parse a CAR string into its components
const parsed = parseCAR('a3i.acme-corp.invoice-bot:ABF-L3@1.0.0');
// => { registry: 'a3i', organization: 'acme-corp', agentClass: 'invoice-bot',
//      domains: ['A', 'B', 'F'], level: 3, version: '1.0.0' }

// Generate a CAR string
const car = generateCAR({
  registry: 'a3i',
  organization: 'acme-corp',
  agentClass: 'invoice-bot',
  domains: ['A', 'B', 'F'],
  level: CapabilityLevel.L3_EXECUTE,
  version: '1.0.0',
});
// => 'a3i.acme-corp.invoice-bot:ABF-L3@1.0.0'

// Calculate effective permission
const permission = calculateEffectivePermission({
  certificationTier: CertificationTier.T3_MONITORED,
  competenceLevel: CapabilityLevel.L4_STANDARD,
  runtimeTier: RuntimeTier.T3_MONITORED,
  observabilityCeiling: 4,
  contextPolicyCeiling: 3,
});
```

### Feature Flags

```typescript
import {
  FLAGS,
  isFeatureEnabled,
  getEnabledFeatures,
  getFlagsByCategory,
  getFlagMeta,
  type FeatureFlag,
} from '@vorionsys/contracts';

// Check a flag (uses defaultEnabled from metadata)
if (isFeatureEnabled(FLAGS.PROOF_STREAMING)) {
  // enable streaming proof pipeline
}

// Check with overrides (useful for testing)
const enabled = isFeatureEnabled(FLAGS.ZK_PROOFS, {
  [FLAGS.ZK_PROOFS]: true,
});

// Get all trust-related flags
const trustFlags = getFlagsByCategory('trust');

// Get metadata for a flag
const meta = getFlagMeta(FLAGS.MERKLE_PROOFS);
// => { flag: 'merkle_proofs', name: 'Merkle Proofs', category: 'crypto', phase: 7, ... }
```

### Common Primitives

```typescript
import {
  UUIDSchema,
  TimestampSchema,
  HashSchema,
  ActorSchema,
  TrustBandSchema,
  DecisionOutcomeSchema,
  type Actor,
  type UUID,
} from '@vorionsys/contracts/common';

// Validate a UUID
const id: UUID = UUIDSchema.parse('550e8400-e29b-41d4-a716-446655440000');

// Validate an actor
const actor: Actor = ActorSchema.parse({
  type: 'AGENT',
  id: 'agent-001',
  name: 'Invoice Bot',
});
```

## API Reference

### Root Exports (`@vorionsys/contracts`)

Re-exports everything from v2 contracts, canonical agent types, and feature flags.

#### Enums

| Export | Description |
|---|---|
| `TrustBand` | Trust bands T0 (Sandbox) through T7 (Autonomous) |
| `ObservationTier` | Observation tiers: BLACK_BOX, GRAY_BOX, WHITE_BOX, ATTESTED_BOX, VERIFIED_BOX |
| `DecisionTier` | Three-tier governance: GREEN, YELLOW, RED |
| `ActionType` | Action categories: read, write, delete, execute, communicate, transfer |
| `DataSensitivity` | Data classification: PUBLIC, INTERNAL, CONFIDENTIAL, RESTRICTED |
| `Reversibility` | Action reversibility: REVERSIBLE, PARTIALLY_REVERSIBLE, IRREVERSIBLE |
| `ProofEventType` | Proof event types: intent_received, decision_made, trust_delta, etc. |
| `ComponentType` | Component registry types: agent, service, adapter, policy_bundle |
| `ComponentStatus` | Lifecycle: active, deprecated, retired |
| `ApprovalType` | Approval types: none, human_review, automated_check, multi_party |
| `RefinementAction` | Refinement actions for YELLOW decisions |
| `WorkflowState` | Workflow lifecycle states |
| `DenialReason` | Structured denial reason codes |
| `RiskProfile` | Temporal risk profiles for outcome tracking |

#### Interfaces (v2 Contracts)

| Export | Description |
|---|---|
| `TrustProfile` | Complete agent trust state with dimensions, weights, and evidence |
| `TrustDimensions` | Five trust dimensions: CT, BT, GT, XT, AC |
| `Intent` | Agent action request with resource scope and context |
| `Decision` | Authorization result with constraints and reasoning |
| `FluidDecision` | Extended decision with GREEN/YELLOW/RED tiers and refinement |
| `ProofEvent` | Immutable hash-chained audit trail entry |
| `PolicyBundle` | Collection of governance policy rules |
| `CanaryProbe` | ATSF v2.0 continuous behavioral verification probe |
| `PreActionGateConfig` | Pre-action verification gate configuration |
| `WorkflowInstance` | Tracks intent lifecycle through governance |

#### Constants

| Export | Description |
|---|---|
| `OBSERVATION_CEILINGS` | Trust ceiling values per observation tier |
| `DEFAULT_TRUST_WEIGHTS` | Default weights for trust dimensions |
| `DEFAULT_BAND_THRESHOLDS` | Score thresholds for T0-T7 bands |
| `DEFAULT_TRUST_DYNAMICS` | Asymmetric trust gain/loss configuration |
| `DEFAULT_CANARY_CONFIG` | Canary probe injection defaults |
| `DEFAULT_GATE_CONFIG` | Pre-action gate defaults |
| `TRUST_THRESHOLDS` | Trust thresholds per risk level |
| `EVIDENCE_TYPE_MULTIPLIERS` | Weight multipliers per evidence type |
| `RISK_PROFILE_WINDOWS` | Outcome windows per risk profile |

#### Feature Flags

| Export | Description |
|---|---|
| `FLAGS` | Feature flag registry (const object) |
| `FLAG_METADATA` | Metadata for each flag (name, description, category, phase) |
| `FeatureFlag` | Type for flag string values |
| `FeatureFlagMeta` | Interface for flag metadata |
| `isFeatureEnabled(flag, overrides?)` | Check if a flag is enabled |
| `getEnabledFeatures(overrides?)` | Get all enabled flags |
| `getFlagsByCategory(category)` | Get flags by category |
| `getFlagsByPhase(phase)` | Get flags by implementation phase |
| `getFlagMeta(flag)` | Get metadata for a flag |

#### Canonical Agent Types

| Export | Description |
|---|---|
| `AgentLifecycleStatus` | draft, training, active, suspended, archived |
| `AgentRuntimeStatus` | IDLE, WORKING, PAUSED, ERROR, OFFLINE |
| `AgentPermission` | execute, external, delegate, spawn, admin |
| `AgentSpecialization` | core, security, development, operations, etc. |
| `AgentConfig` | Full agent configuration interface |
| `AgentTask` | Task assignment structure |
| `agentConfigSchema` | Zod schema for AgentConfig validation |
| `agentTaskSchema` | Zod schema for AgentTask validation |
| `agentCapabilitySchema` | Zod schema for AgentCapability validation |
| `canTransitionLifecycleStatus()` | Validates lifecycle state transitions |

### Validators (`@vorionsys/contracts/validators`)

| Export | Description |
|---|---|
| `intentSchema` | Zod schema for Intent validation |
| `decisionSchema` | Zod schema for Decision validation |
| `trustProfileSchema` | Zod schema for TrustProfile validation |
| `proofEventSchema` | Zod schema for ProofEvent validation |
| `trustDimensionsSchema` | Zod schema for TrustDimensions |
| `validate(schema, data)` | Validates and throws on failure |
| `safeValidate(schema, data)` | Validates and returns result object |
| `formatValidationErrors(errors)` | Formats ZodIssue[] for display |

### CAR Module (`@vorionsys/contracts/car`)

| Export | Description |
|---|---|
| `parseCAR(str)` / `tryParseCAR(str)` | Parse CAR strings into components |
| `generateCAR(options)` | Generate CAR string from components |
| `validateCAR(str)` / `isValidCAR(str)` | Validate CAR string format |
| `CapabilityLevel` | Enum: L0_NONE through L7_AUTONOMOUS |
| `CertificationTier` | Enum: T0_SANDBOX through T7_AUTONOMOUS |
| `RuntimeTier` | Enum: T0_SANDBOX through T7_AUTONOMOUS |
| `calculateEffectivePermission()` | Compute effective permission from context |
| `createAgentIdentity()` | Create a new AgentIdentity record |
| `generateJWTClaims()` | Generate OIDC JWT claims for an agent |
| `createAttestation()` / `verifyAttestation()` | Attestation management |
| `encodeDomains()` / `decodeDomains()` | Domain bitmask operations |
| `encodeSkills()` / `decodeSkills()` | Skill bitmask operations |

### Common Module (`@vorionsys/contracts/common`)

| Export | Description |
|---|---|
| `UUIDSchema` | Zod UUID validator |
| `SemVerSchema` | Zod SemVer string validator |
| `TimestampSchema` | Zod ISO datetime validator |
| `HashSchema` | Zod SHA-256 hex string validator |
| `ActorSchema` | Zod Actor object validator |
| `TrustBandSchema` | Zod TrustBand enum validator (T0-T7) |
| `AutonomyLevelSchema` | Zod AutonomyLevel enum validator |
| `DecisionOutcomeSchema` | Zod DecisionOutcome enum validator |
| `SeveritySchema` | Zod Severity level validator |
| `RiskLevelSchema` | Zod RiskLevel validator |
| `VorionError` | Base error class with code and details |
| `TrustInsufficientError` | Typed error for trust level failures |

### Canonical Module (`@vorionsys/contracts/canonical`)

Governance and agent classification schemas including trust bands, trust scores, risk levels, trust signals, governance rules, and middleware types with runtime Zod validation.

### Database Module (`@vorionsys/contracts/db`)

Drizzle ORM table definitions for the platform database: `agents`, `tenants`, `attestations`, `stateTransitions`, `approvalRequests`, `apiKeys`, `intents`, `operations`, `proofs`, `merkle`, `escalations`, `webhooks`, `policyVersions`, `rbac`, `trust`, and `serviceAccounts`.

## TypeScript

All interfaces are exported as TypeScript types. Zod schemas can be used for runtime validation and type inference:

```typescript
import type { z } from 'zod';
import { intentSchema } from '@vorionsys/contracts/validators';
import { agentConfigSchema } from '@vorionsys/contracts';

// Infer types from Zod schemas
type ValidatedIntent = z.infer<typeof intentSchema>;
type ValidatedAgentConfig = z.infer<typeof agentConfigSchema>;
```

For v2 contract interfaces (non-Zod), import types directly:

```typescript
import type {
  Intent,
  Decision,
  FluidDecision,
  TrustProfile,
  ProofEvent,
  PolicyBundle,
} from '@vorionsys/contracts';
```

## Requirements

- Node.js >= 18.0.0
- TypeScript >= 5.0.0 (peer dependency)
- Runtime dependency: `zod` >= 3.24

## License

Apache-2.0

## Repository

[https://github.com/vorionsys/vorion](https://github.com/vorionsys/vorion)
