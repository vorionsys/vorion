# @vorionsys/basis

**Baseline Authority for Safe & Interoperable Systems (BASIS)** -- Open standard for AI agent governance with an 8-tier trust framework, 23 trust factors, a validation gate, and a KYA (Know Your Agent) verification SDK.

> Part of the [Vorion](https://vorion.org) platform for autonomous AI agent infrastructure.

## Installation

```bash
npm install @vorionsys/basis
```

## What is BASIS?

BASIS (Baseline Authority for Safe & Interoperable Systems) defines how autonomous AI agents earn, maintain, and lose trust. It is the governance layer for any system that deploys, orchestrates, or monitors AI agents.

BASIS provides:

- **8 Trust Tiers (T0-T7)** -- Progressive autonomy levels from Sandbox to Autonomous
- **23 Trust Factors** -- 15 core + 8 life-critical evaluation criteria with weighted scoring
- **Tier-Gated Capabilities** -- What agents can do at each trust level (35 capabilities across 8 categories)
- **Validation Gate** -- Central PASS / REJECT / ESCALATE decisions for agent manifests
- **KYA (Know Your Agent) Framework** -- Identity verification, authorization, accountability chains, and behavior monitoring

## Quick Start

### Evaluate an Agent's Trust Score

```typescript
import {
  TrustTier,
  CORE_FACTORS,
  calculateTrustScore,
  getRequiredFactors,
  getTrustTierFromScore,
  type FactorScore,
} from '@vorionsys/basis';

// Which factors are required for T4 Standard?
const required = getRequiredFactors(TrustTier.T4_STANDARD);
console.log(`T4 requires ${required.length} factors`);

// Build factor scores for an agent
const factorScores: FactorScore[] = [
  { code: 'CT_COMP', score: 0.85, timestamp: new Date(), source: 'measured', confidence: 0.9 },
  { code: 'CT_REL',  score: 0.80, timestamp: new Date(), source: 'measured', confidence: 0.9 },
  { code: 'CT_OBS',  score: 0.78, timestamp: new Date(), source: 'measured', confidence: 0.85 },
  // ... additional factor scores
];

// Calculate trust score against a target tier
const evaluation = calculateTrustScore(factorScores, TrustTier.T4_STANDARD);
console.log(`Score: ${evaluation.totalScore}/1000`);
console.log(`Compliant: ${evaluation.compliant}`);
console.log(`Missing factors: ${evaluation.missingFactors}`);
console.log(`Below threshold: ${evaluation.belowThreshold}`);

// Determine tier from a raw score
const tier = getTrustTierFromScore(720);
// => TrustTier.T4_STANDARD
```

### Validate an Agent Manifest

```typescript
import {
  validateAgent,
  GateDecision,
  ValidationSeverity,
  type AgentManifest,
} from '@vorionsys/basis';

const manifest: AgentManifest = {
  agentId: 'a3i.acme-corp.invoice-bot:ABF-L3@1.0.0',
  organization: 'acme-corp',
  agentClass: 'invoice-bot',
  trustScore: 520,
  requestedCapabilities: ['CAP-DB-READ', 'CAP-WRITE-APPROVED'],
};

const result = validateAgent(manifest);

switch (result.decision) {
  case GateDecision.PASS:
    console.log('Agent validated -- proceed');
    console.log('Allowed capabilities:', result.allowedCapabilities);
    break;
  case GateDecision.REJECT:
    console.log('Agent rejected:', result.errors);
    break;
  case GateDecision.ESCALATE:
    console.log('Human review required:', result.warnings);
    break;
}
```

### Check Tier-Gated Capabilities

```typescript
import {
  TrustTier,
  getCapabilitiesForTier,
  getNewCapabilitiesAtTier,
  hasCapability,
  getToolsForTier,
} from '@vorionsys/basis';

// Get all capabilities available at T4
const caps = getCapabilitiesForTier(TrustTier.T4_STANDARD);
console.log(`T4 agents have ${caps.length} capabilities`);

// Get only the capabilities that unlock at T4
const newCaps = getNewCapabilitiesAtTier(TrustTier.T4_STANDARD);
console.log('New at T4:', newCaps.map(c => c.name));

// Check if a specific tier has a capability
const canWrite = hasCapability(TrustTier.T2_PROVISIONAL, 'CAP-WRITE-APPROVED');
console.log(`T2 can write to approved locations: ${canWrite}`);

// Get all tools available at a tier
const tools = getToolsForTier(TrustTier.T3_MONITORED);
console.log('T3 tools:', tools);
```

### KYA (Know Your Agent) Verification

```typescript
import { KYA } from '@vorionsys/basis';

const kya = new KYA({
  didResolver: {
    networks: ['vorion', 'ethereum'],
    cacheEnabled: true,
  },
  policyEngine: {
    policyBundlesPath: './policies',
    defaultJurisdiction: 'Global',
  },
  database: {
    type: 'postgres',
    connectionString: process.env.DATABASE_URL!,
  },
});

// Complete 4-step verification flow:
// 1. Identity   -- DID resolution + Ed25519 signature verification
// 2. Authorization -- Capability token + policy constraint check
// 3. Accountability -- Hash-linked audit chain logging
// 4. Behavior   -- Anomaly detection (rate spikes, suspicious access)
const result = await kya.verifyAgent({
  agentDID: 'did:vorion:ed25519:5Z8K3q2YvU8pVzNxF9sT7bQw6JhR1Xm',
  action: 'file.read',
  resource: 'documents/report.pdf',
  proof: {
    challenge: 'abc123...',
    signature: 'deadbeef...',
    timestamp: Date.now(),
  },
});

if (result.allowed) {
  console.log(`Trust score: ${result.trustScore}`);
  console.log(`Anomalies detected: ${result.anomalies}`);
} else {
  console.log(`Denied: ${result.reason}`);
}
```

### Use Pre-Built Validation Gates

```typescript
import {
  createValidationGate,
  strictValidationGate,
  productionValidationGate,
} from '@vorionsys/basis';

// Strict mode -- treats warnings as errors
const result1 = strictValidationGate.validate(manifest);

// Production mode -- requires registered profile, minimum T2 tier
const result2 = productionValidationGate.validate(manifest, registeredProfile);

// Custom gate with your own defaults
const myGate = createValidationGate({
  strict: false,
  requireRegisteredProfile: true,
  minimumTrustTier: TrustTier.T3_MONITORED,
  allowCapabilityEscalation: true,
});
const result3 = myGate.validate(manifest);
```

## Trust Tiers

| Tier | Score | Name | Factors Required | Description |
|------|-------|------|-----------------|-------------|
| T0 | 0-199 | Sandbox | 0 | Observation only, no external access |
| T1 | 200-349 | Observed | 3 | Basic competence demonstrated |
| T2 | 350-499 | Provisional | 6 | Accountability + safety emerging |
| T3 | 500-649 | Monitored | 9 | Security + identity confirmed |
| T4 | 650-799 | Standard | 13 | Human oversight + alignment |
| T5 | 800-875 | Trusted | 16 | Stewardship + humility |
| T6 | 876-950 | Certified | 20 | Adaptability + causal reasoning |
| T7 | 951-1000 | Autonomous | 23 | Full autonomy -- all factors |

## Trust Factors

### Core Factors (15)

| Code | Name | Required From | Factor Tier |
|------|------|--------------|------|
| CT-COMP | Competence | T1 | Foundational |
| CT-REL | Reliability | T1 | Foundational |
| CT-OBS | Observability | T1 | Foundational |
| CT-TRANS | Transparency | T2 | Foundational |
| CT-ACCT | Accountability | T2 | Foundational |
| CT-SAFE | Safety | T2 | Foundational |
| CT-SEC | Security | T3 | Foundational |
| CT-PRIV | Privacy | T3 | Foundational |
| CT-ID | Identity | T3 | Foundational |
| OP-HUMAN | Human Oversight | T4 | Operational |
| OP-ALIGN | Alignment | T4 | Operational |
| OP-STEW | Stewardship | T5 | Operational |
| SF-HUM | Humility | T5 | Sophisticated |
| SF-ADAPT | Adaptability | T6 | Sophisticated |
| SF-LEARN | Continuous Learning | T6 | Sophisticated |

### Life-Critical Factors (8)

For healthcare, safety, and life-saving AI applications:

| Code | Name | Required From |
|------|------|--------------|
| LC-UNCERT | Uncertainty Quantification | T4 |
| LC-HANDOFF | Graceful Degradation & Handoff | T4 |
| LC-EMPHUM | Empirical Humility | T5 |
| LC-CAUSAL | Clinical Causal Understanding | T6 |
| LC-PATIENT | Patient-Centered Autonomy | T6 |
| LC-EMP | Empathy & Emotional Intelligence | T7 |
| LC-MORAL | Nuanced Moral Reasoning | T7 |
| LC-TRACK | Proven Efficacy Track Record | T7 |

## Capability Categories

Capabilities are gated by trust tier. As agents earn higher trust, they unlock more capabilities across 8 categories:

| Category | Examples | First Available |
|----------|----------|----------------|
| Data Access | Read public/internal data, database read/write, secrets | T0 |
| File Operations | Write to approved directories | T2 |
| API Access | Internal API read, external GET, full REST | T1 |
| Code Execution | Generate responses, data transforms, sandboxed code | T0 |
| Agent Interaction | Agent communication, delegation, spawning | T4 |
| Resource Management | Resource provisioning, budget management | T4 |
| System Administration | Limited admin, infrastructure management, full admin | T5 |
| Governance | Human escalation, policy modification, strategic decisions | T4 |

## API Reference

### Enums

```typescript
// Trust tier levels (T0-T7)
enum TrustTier {
  T0_SANDBOX, T1_OBSERVED, T2_PROVISIONAL, T3_MONITORED,
  T4_STANDARD, T5_TRUSTED, T6_CERTIFIED, T7_AUTONOMOUS
}

// Factor classification tiers
enum FactorTier {
  FOUNDATIONAL, OPERATIONAL, SOPHISTICATED, LIFE_CRITICAL
}

// Capability categories
enum CapabilityCategory {
  DATA_ACCESS, FILE_OPERATIONS, API_ACCESS, CODE_EXECUTION,
  AGENT_INTERACTION, RESOURCE_MANAGEMENT, SYSTEM_ADMINISTRATION, GOVERNANCE
}

// Validation gate decisions
enum GateDecision { PASS, REJECT, ESCALATE }

// Validation issue severity
enum ValidationSeverity { INFO, WARNING, ERROR, CRITICAL }
```

### Trust Score Functions

```typescript
calculateTrustScore(scores: FactorScore[], tier: TrustTier): TrustEvaluation
getRequiredFactors(tier: TrustTier): FactorCode[]
getCriticalFactorsForTier(tier: TrustTier): string[]
getFactorThresholdsForTier(tier: TrustTier): Record<string, FactorThreshold>
getTrustTierFromScore(score: number): TrustTier
getTierName(tier: TrustTier): string
getTierColor(tier: TrustTier): string
```

### Capability Functions

```typescript
getCapabilitiesForTier(tier: TrustTier): Capability[]
getNewCapabilitiesAtTier(tier: TrustTier): Capability[]
hasCapability(agentTier: TrustTier, capabilityCode: string): boolean
getToolsForTier(tier: TrustTier): string[]
```

### Validation Gate Functions

```typescript
validateAgent(manifest: AgentManifest, profile?: RegisteredProfile, options?: ValidationGateOptions): ValidationGateResult
isValidAgent(manifest: AgentManifest, profile?: RegisteredProfile, options?: ValidationGateOptions): boolean
createValidationGate(defaultOptions: ValidationGateOptions): { validate, isValid }
scoreToTier(score: number): TrustTier

// Pre-built gates
strictValidationGate       // Treats warnings as errors
productionValidationGate   // Requires registered profile, minimum T2
```

### KYA Classes

```typescript
class KYA {
  identity: IdentityVerifier;
  authorization: AuthorizationManager;
  accountability: AccountabilityChain;
  behavior: BehaviorMonitor;

  verifyAgent(params): Promise<{ allowed, reason, trustScore, anomalies }>
}

class IdentityVerifier {
  verify(proof: IdentityProof): Promise<boolean>
  resolveDID(did: string): Promise<DIDDocument>
  generateChallenge(): string
  signChallenge(challenge: string, privateKey: Uint8Array): Promise<string>
}

class AuthorizationManager {
  authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>
  grantCapability(agentDID: string, token: CapabilityToken): Promise<void>
  revokeCapability(agentDID: string, capabilityId: string): Promise<void>
}

class AccountabilityChain {
  append(record: AccountabilityRecord): Promise<void>
  verify(agentDID: string): Promise<{ valid, totalRecords, brokenLinks }>
  query(agentDID: string, options?): Promise<AccountabilityRecord[]>
}

class BehaviorMonitor {
  detectAnomalies(agentDID: string): Promise<AnomalyAlert[]>
  getBehaviorProfile(agentDID: string): Promise<BehaviorProfile>
  updateTrustScoreFromBehavior(agentDID: string, anomalies: AnomalyAlert[]): Promise<number>
  getTrustScore(agentDID: string): Promise<number>
}
```

### Constants

```typescript
CORE_FACTORS              // 15 core trust factors with metadata
LIFE_CRITICAL_FACTORS     // 8 life-critical factors with metadata
ALL_FACTORS               // All 23 factors combined
TIER_THRESHOLDS           // Score ranges per tier ({ min, max })
FACTOR_THRESHOLDS_BY_TIER // Per-factor thresholds at each tier (minimum, weight, critical)
FACTOR_MINIMUM_SCORE      // Global minimum factor score (0.5)
TRUST_TIER_DISPLAY        // Display config per tier (name, color, textColor)
CAPABILITIES_BY_TIER      // Capability arrays indexed by TrustTier
TIER_CAPABILITY_SUMMARY   // Human-readable capability summaries per tier

// Capability arrays per tier
T0_CAPABILITIES through T7_CAPABILITIES
```

### Zod Schemas

```typescript
agentManifestSchema        // Validates AgentManifest shape
registeredProfileSchema    // Validates RegisteredProfile shape
validationIssueSchema      // Validates ValidationIssue shape
validationGateResultSchema // Validates ValidationGateResult shape
```

### Key Interfaces

```typescript
import type {
  // Trust scoring
  FactorScore,
  TrustEvaluation,
  FactorThreshold,

  // Capabilities
  Capability,

  // Validation gate
  AgentManifest,
  RegisteredProfile,
  ValidationGateResult,
  ValidationGateOptions,
  ValidationIssue,
  CustomValidator,

  // KYA types
  KYAConfig,
  DIDDocument,
  DIDResolverConfig,
  PolicyEngineConfig,
  DatabaseConfig,
  IdentityProof,
  VerificationMethod,
  AuthorizationRequest,
  AuthorizationDecision,
  CapabilityToken,
  KYACapability,
  PolicyBundle,
  Constraint,
  Obligation,
  Permission,
  AccountabilityRecord,
  AccountabilityVerification,
  BehaviorProfile,
  AnomalyAlert,
  TrustScoreComponents,
  TrustScoreUpdate,
  KYAMetadata,
  ServiceEndpoint,
} from '@vorionsys/basis';
```

## Sub-path Imports

The KYA module can also be imported directly:

```typescript
import { KYA, IdentityVerifier } from '@vorionsys/basis/kya';
```

## Requirements

- Node.js >= 18.0.0
- TypeScript >= 5.3 (recommended)

## Repository

This package is part of the [Vorion monorepo](https://github.com/voriongit/vorion) at `packages/basis`.

## License

[Apache-2.0](./LICENSE)
