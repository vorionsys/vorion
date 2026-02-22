# @vorionsys/car-client

TypeScript client SDK for the **Categorical Agentic Registry (CAR)** -- the unique agent identity, registration, and provenance system within the Vorion platform.

## What is CAR?

The **Categorical Agentic Registry (CAR)** is Vorion's **identity layer** for AI agents. Every agent in the Vorion ecosystem receives a **CAR ID** -- a unique, cryptographically-anchored identity that tracks the agent's identity, provenance, capability declarations, and role permissions across its entire lifecycle. Trust scores are **not** part of the CAR identity; they are dynamic behavioral metrics computed at runtime by a separate trust engine (ATSF/Cognigate) that references agents by their CAR ID.

CAR is the **identity registry** that the **Phase 6 Trust Engine** (ATSF/Cognigate) relies on. The trust engine implements five architectural decisions (Q1-Q5) governing how agents earn trust, assume roles, inherit presets, and maintain auditable provenance -- all keyed to CAR IDs. The trust model is governed by **BASIS** (Baseline Authority for Safe & Interoperable Systems), an independent standards body that defines the canonical trust tiers, role matrices, and compliance ceilings. In short: **CAR answers "WHO is this agent?"** while **ATSF/Cognigate answers "HOW MUCH do we trust this agent?"**

This SDK (`@vorionsys/car-client`) provides a type-safe TypeScript client for programmatic access to the CAR identity APIs -- registering agents, tracking provenance, managing the full agent identity lifecycle, and evaluating role permissions. It also re-exports convenience wrappers for trust engine operations (ceiling checks, gaming alerts) that reference CAR-registered agents.

## Installation

```bash
npm install @vorionsys/car-client
```

## Quick Start

```typescript
import { createCARClient } from '@vorionsys/car-client'

// Create a client connected to the CAR API
const client = createCARClient({
  baseUrl: 'https://api.agentanchorai.com',
  apiKey: process.env.CAR_API_KEY,
})

// Get dashboard statistics
const { stats } = await client.getStats()
console.log(`${stats.contextStats.agents} agents registered`)

// Evaluate whether an agent can assume a role
const result = await client.evaluateRoleGate({
  agentId: 'agent-123',
  requestedRole: 'R_L3',
  currentTier: 'T3',
})

if (result.evaluation.finalDecision === 'ALLOW') {
  // Agent is authorized -- proceed with operation
}
```

## Features

### CAR Identity Features

| Feature | Description |
|---------|-------------|
| Hierarchical Context (Q2) | 4-tier immutable context (Deployment > Organization > Agent > Operation) |
| Role Gates (Q3) | 3-layer evaluation (Kernel matrix > Policy rules > BASIS override) |
| Federated Presets (Q4) | CAR > Vorion > Axiom derivation chains with lineage verification |
| Provenance (Q5) | Immutable origin tracking with creation type classification |

### Trust Engine Features (via ATSF/Cognigate, accessible through this SDK)

| Feature | Description |
|---------|-------------|
| Ceiling Enforcement (Q1) | Dual-layer trust ceilings with regulatory compliance (EU AI Act, NIST, ISO 42001) |
| Gaming Detection | Trust score manipulation detection and alerting |

> **Note:** The trust engine features above are provided by ATSF/Cognigate, not by CAR itself. This SDK exposes them as convenience wrappers since they operate on CAR-registered agents.

## Usage Examples

### Registering Agent Provenance (CAR ID)

Every agent in CAR has immutable provenance. Register a new agent identity or track derivation from existing agents:

```typescript
import { createCARClient } from '@vorionsys/car-client'

const client = createCARClient({
  baseUrl: 'https://api.agentanchorai.com',
  apiKey: process.env.CAR_API_KEY,
})

// Register a fresh agent -- no trust modifier applied
const fresh = await client.createProvenance({
  agentId: 'agent-alpha-001',
  creationType: 'FRESH',
  createdBy: 'system',
})

// Clone from an existing agent -- applies -50 trust modifier
const clone = await client.createProvenance({
  agentId: 'agent-alpha-002',
  creationType: 'CLONED',
  parentAgentId: 'agent-alpha-001',
  createdBy: 'admin@company.com',
})

// Evolve an agent -- applies +100 trust modifier
const evolved = await client.createProvenance({
  agentId: 'agent-beta-001',
  creationType: 'EVOLVED',
  parentAgentId: 'agent-alpha-001',
  createdBy: 'training-pipeline',
})
```

### Looking Up CAR IDs and Agent Identity

Query provenance records to look up any agent's identity, lineage, and creation history:

```typescript
// Get provenance for a specific agent
const { records, lineage } = await client.getProvenance('agent-alpha-001')
console.log(`Agent created via: ${records[0].creationType}`)
console.log(`Trust modifier: ${records[0].trustModifier}`)

// Lineage shows the full derivation chain
if (lineage) {
  lineage.forEach((ancestor) => {
    console.log(`${ancestor.agentId} (${ancestor.creationType})`)
  })
}
```

### Evaluating Role Gates (Q3)

The role gate system uses a 3-layer evaluation to decide whether an agent can assume a given role:

```typescript
const result = await client.evaluateRoleGate({
  agentId: 'agent-123',
  requestedRole: 'R_L3',      // Orchestrator
  currentTier: 'T3',          // Monitored
  currentScore: 550,
  attestations: ['security-audit'],
})

// Inspect each layer
console.log(result.layers.kernel.allowed)      // Kernel matrix lookup
console.log(result.layers.policy.result)       // Policy rule evaluation
console.log(result.layers.basis.overrideUsed)  // BASIS override applied?

if (result.evaluation.finalDecision === 'ALLOW') {
  console.log('Agent authorized for Orchestrator role')
} else if (result.evaluation.finalDecision === 'ESCALATE') {
  console.log('Requires manual approval')
} else {
  console.log('Denied:', result.evaluation.decisionReason)
}
```

### Checking Trust Ceilings (Q1) -- Trust Engine Feature

Trust ceilings are enforced by the trust engine (ATSF/Cognigate), not by CAR itself. This SDK provides convenience access to ceiling checks for CAR-registered agents. Trust scores are capped by regulatory and organizational ceilings:

```typescript
const ceiling = await client.checkCeiling({
  agentId: 'agent-123',
  proposedScore: 750,
  complianceFramework: 'EU_AI_ACT',  // Ceiling: 699
})

if (ceiling.result.ceilingApplied) {
  console.log(`Score capped from ${ceiling.result.proposedScore} to ${ceiling.result.finalScore}`)
  console.log(`Ceiling source: ${ceiling.result.ceilingSource}`)
  console.log(`Compliance: ${ceiling.result.complianceStatus}`)
}
```

### Managing the Context Hierarchy (Q2)

The 4-tier context hierarchy is immutable and tracks every deployment, organization, agent, and operation:

```typescript
// Get the full hierarchy
const hierarchy = await client.getContextHierarchy()
console.log(`${hierarchy.summary.agentCount} agents across ${hierarchy.summary.deploymentCount} deployments`)

// Navigate individual tiers
const deployments = await client.getDeployments()
const orgs = await client.getOrganizations(deployments[0].deploymentId)
const agents = await client.getAgents(deployments[0].deploymentId, orgs[0].orgId)
const operations = await client.getOperations(agents[0].agentId)

// Create a new deployment context
const deployment = await client.createDeployment({
  deploymentId: 'prod-us-east-1',
  name: 'Production US East',
  version: '2.1.0',
  environment: 'production',
  maxTrustCeiling: 900,
  contextHash: '...',
})
```

### Federated Presets (Q4)

Presets follow a derivation chain: CAR (canonical) > Vorion (reference) > Axiom (deployment):

```typescript
// Get the full preset hierarchy
const presets = await client.getPresetHierarchy()
console.log(`${presets.summary.aciCount} CAR canonical presets`)
console.log(`${presets.summary.verifiedLineages} verified lineages`)

// Access each tier of presets
const carPresets = await client.getCARPresets()
const vorionPresets = await client.getVorionPresets()
const axiomPresets = await client.getAxiomPresets('deployment-123')

// Verify that an Axiom preset traces back to a valid CAR canonical
const verification = await client.verifyPresetLineage('axiom-preset-123')
if (verification.verified) {
  console.log('Lineage verified: CAR > Vorion > Axiom')
}
```

### Gaming Detection Alerts -- Trust Engine Feature

Gaming detection is a trust engine (ATSF/Cognigate) feature that monitors trust score manipulation attempts for CAR-registered agents. This SDK provides convenience access:

```typescript
// Get active gaming alerts
const { alerts, summary } = await client.getGamingAlerts('ACTIVE')

alerts.forEach((alert) => {
  console.log(`[${alert.severity}] ${alert.alertType}: ${alert.details}`)
})

// Resolve a false positive
await client.updateGamingAlertStatus(
  alerts[0].id,
  'RESOLVED',
  'admin@company.com',
  'False positive -- batch processing caused rapid score changes'
)
```

### Local Development

```typescript
import { createLocalCARClient } from '@vorionsys/car-client'

// Connect to a local CAR API with debug logging enabled
const client = createLocalCARClient(3000)
const health = await client.healthCheck()
console.log(`CAR API v${health.version} -- ${health.status}`)
```

## API Reference

### Factory Functions

| Function | Description |
|----------|-------------|
| `createCARClient(config)` | Create a CAR client with full configuration |
| `createLocalCARClient(port?)` | Create a client for local development (debug mode enabled) |

### `CARClientConfig`

```typescript
interface CARClientConfig {
  baseUrl: string                      // CAR API base URL
  apiKey?: string                      // Bearer token for authentication
  timeout?: number                     // Request timeout in ms (default: 30000)
  headers?: Record<string, string>     // Custom HTTP headers
  debug?: boolean                      // Enable request/response logging
}
```

### Client Methods

#### Stats and Dashboard

| Method | Return Type | Description |
|--------|-------------|-------------|
| `getStats()` | `DashboardData` | Get Phase 6 dashboard statistics |
| `healthCheck()` | `{ status, version }` | API health check |

#### Context Hierarchy (Q2)

| Method | Return Type | Description |
|--------|-------------|-------------|
| `getContextHierarchy()` | `ContextHierarchy` | Get full 4-tier hierarchy |
| `getDeployments()` | `DeploymentContext[]` | List deployment contexts |
| `getOrganizations(deploymentId?)` | `OrgContext[]` | List organization contexts |
| `getAgents(deploymentId?, orgId?)` | `AgentContext[]` | List agent contexts |
| `getOperations(agentId?)` | `OperationContext[]` | List operation contexts |
| `createDeployment(data)` | `DeploymentContext` | Create a deployment context |

#### Role Gates (Q3)

| Method | Return Type | Description |
|--------|-------------|-------------|
| `evaluateRoleGate(request)` | `RoleGateResponse` | Evaluate 3-layer role gate |
| `getRoleGateEvaluations(agentId?, options?)` | `{ evaluations, summary }` | Get evaluation history |

#### Ceiling Enforcement (Q1) -- Trust Engine

| Method | Return Type | Description |
|--------|-------------|-------------|
| `checkCeiling(request)` | `CeilingCheckResponse` | Check score against trust engine ceilings |
| `getCeilingEvents(agentId?, options?)` | `{ events, summary }` | Get ceiling event history |

#### Gaming Alerts -- Trust Engine

| Method | Return Type | Description |
|--------|-------------|-------------|
| `getGamingAlerts(status?, limit?)` | `{ alerts, summary }` | Get trust engine gaming alerts |
| `createGamingAlert(request)` | `{ alert }` | Create a gaming alert |
| `updateGamingAlertStatus(alertId, status, resolvedBy?, notes?)` | `{ alert }` | Update alert status |

#### Federated Presets (Q4)

| Method | Return Type | Description |
|--------|-------------|-------------|
| `getPresetHierarchy()` | `PresetHierarchy` | Get full preset hierarchy |
| `getCARPresets()` | `CARPreset[]` | Get CAR canonical presets |
| `getVorionPresets()` | `VorionPreset[]` | Get Vorion reference presets |
| `getAxiomPresets(deploymentId?)` | `AxiomPreset[]` | Get Axiom deployment presets |
| `verifyPresetLineage(axiomPresetId)` | `{ verified, lineage?, reason? }` | Verify preset derivation chain |

#### Provenance (Q5)

| Method | Return Type | Description |
|--------|-------------|-------------|
| `getProvenance(agentId?)` | `{ records, summary, lineage? }` | Get provenance records |
| `createProvenance(request)` | `{ record }` | Register agent provenance |

### Utility Functions

> **Note:** These utilities are convenience re-exports. Trust tier computation is a trust engine (ATSF/Cognigate) concept; these helpers are included so consumers do not need a separate dependency for common lookups.

| Function | Description |
|----------|-------------|
| `getTierFromScore(score)` | Compute trust tier (T0-T7) from a numeric score (trust engine logic, re-exported for convenience) |
| `isRoleAllowedForTier(role, tier)` | Check if a role is permitted for a given tier (kernel layer) |

### Exported Constants

> **Note:** Trust-related constants (`TRUST_TIER_RANGES`, `TRUST_TIER_LABELS`, `DEFAULT_PROVENANCE_MODIFIERS`, `REGULATORY_CEILINGS`) are trust engine concepts re-exported by this SDK for developer convenience. They are defined by ATSF/Cognigate and BASIS, not by the CAR identity system.

| Constant | Description |
|----------|-------------|
| `TRUST_TIER_RANGES` | Score ranges for each trust tier (T0-T7) -- trust engine re-export |
| `TRUST_TIER_LABELS` | Human-readable labels for each tier -- trust engine re-export |
| `AGENT_ROLE_LABELS` | Human-readable labels for each role (R-L0 to R-L8) |
| `DEFAULT_PROVENANCE_MODIFIERS` | Default trust score modifiers by creation type -- trust engine re-export |
| `REGULATORY_CEILINGS` | Maximum trust score by compliance framework -- trust engine re-export |

### Zod Schemas (Runtime Validation)

All request types have companion Zod schemas for runtime validation:

| Schema | Validates |
|--------|-----------|
| `TrustTierSchema` | Trust tier codes (T0-T7) |
| `AgentRoleSchema` | Agent role codes (R_L0-R_L8) |
| `CreationTypeSchema` | Creation types (FRESH, CLONED, EVOLVED, PROMOTED, IMPORTED) |
| `RoleGateDecisionSchema` | Role gate decisions (ALLOW, DENY, ESCALATE) |
| `ComplianceStatusSchema` | Compliance statuses (COMPLIANT, WARNING, VIOLATION) |
| `GamingAlertTypeSchema` | Gaming alert types |
| `AlertSeveritySchema` | Alert severity levels |
| `AlertStatusSchema` | Alert status values |
| `RoleGateRequestSchema` | Full role gate request validation |
| `CeilingCheckRequestSchema` | Full ceiling check request validation |
| `ProvenanceCreateRequestSchema` | Full provenance creation request validation |

### Error Handling

```typescript
import { CARError } from '@vorionsys/car-client'

try {
  await client.evaluateRoleGate(request)
} catch (error) {
  if (error instanceof CARError) {
    console.log(error.statusCode)  // HTTP status code
    console.log(error.details)     // API error details

    error.isClientError()  // true for 4xx
    error.isServerError()  // true for 5xx
    error.isTimeout()      // true for 408
    error.isStatus(404)    // check specific status
  }
}
```

## Trust Tiers

> **Architectural note:** Trust tiers are computed by the trust engine (ATSF/Cognigate) at runtime, not stored in the CAR identity. CAR does not assign or track trust scores. This table is included as a developer reference because the `@vorionsys/car-client` SDK re-exports trust tier constants and utility functions (e.g., `getTierFromScore`) as a convenience for consumers who need both identity and trust data.

| Tier | Label | Score Range | Description |
|------|-------|-------------|-------------|
| T0 | Sandbox | 0-199 | Isolated testing, no external access |
| T1 | Observed | 200-349 | Read-only, fully monitored |
| T2 | Provisional | 350-499 | Basic operations with supervision |
| T3 | Monitored | 500-649 | Standard operations, anomaly detection |
| T4 | Standard | 650-799 | Extended operations, policy-governed |
| T5 | Trusted | 800-875 | Privileged operations, minimal oversight |
| T6 | Certified | 876-950 | High autonomy, council review for critical |
| T7 | Autonomous | 951-1000 | Full autonomy, self-governance |

## Agent Roles

| Role | Level | Min Tier | Description |
|------|-------|----------|-------------|
| R-L0 | Listener | T0 | Passive observation |
| R-L1 | Executor | T0 | Single task execution |
| R-L2 | Planner | T1 | Multi-step planning |
| R-L3 | Orchestrator | T2 | Multi-agent coordination |
| R-L4 | Architect | T3 | System design |
| R-L5 | Governor | T4 | Policy control |
| R-L6 | Sovereign | T5 | Full autonomy |
| R-L7 | Meta-Agent | T5 | Agent creation |
| R-L8 | Ecosystem | T5 | Ecosystem control |

## Compliance Frameworks

> **Architectural note:** Compliance ceiling enforcement is a trust engine concept. The trust engine (ATSF/Cognigate) caps trust scores based on regulatory frameworks for CAR-registered agents. These constants are re-exported by the `@vorionsys/car-client` SDK for developer convenience.

| Framework | Max Trust Score | Description |
|-----------|----------------|-------------|
| `EU_AI_ACT` | 699 | EU Artificial Intelligence Act |
| `NIST_AI_RMF` | 899 | NIST AI Risk Management Framework |
| `ISO_42001` | 799 | ISO/IEC 42001 AI Management System |
| `DEFAULT` | 1000 | No regulatory ceiling applied |

## Provenance Modifiers

> **Architectural note:** Provenance modifiers are trust engine inputs, not CAR identity fields. When CAR records an agent's creation type (FRESH, CLONED, etc.), the trust engine (ATSF/Cognigate) applies these modifiers to compute the agent's initial trust score. The modifiers are re-exported by the `@vorionsys/car-client` SDK for developer convenience.

| Creation Type | Trust Modifier | Description |
|---------------|---------------|-------------|
| `FRESH` | 0 | New agent, no modifier |
| `CLONED` | -50 | Copy of existing agent, penalty applied |
| `EVOLVED` | +100 | Agent upgraded through training |
| `PROMOTED` | +150 | Agent promoted through review |
| `IMPORTED` | -100 | External agent, significant penalty |

## License

Apache-2.0. See [LICENSE](./LICENSE) for details.

## Links

- [Repository](https://github.com/voriongit/vorion)
- [Package directory](https://github.com/voriongit/vorion/tree/main/packages/car-client)
- [Issue tracker](https://github.com/voriongit/vorion/issues)
