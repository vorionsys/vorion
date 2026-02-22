# @vorionsys/atsf-core

Agentic Trust Scoring Framework (ATSF) -- the core runtime for AI agent governance, trust scoring, and policy enforcement. Implements the complete 8-tier trust model (T0-T7) on a 0-1000 scale with behavioral signal processing, time-based decay, recovery mechanics, and immutable audit trails.

## Installation

```bash
npm install @vorionsys/atsf-core
```

**Requirements:** Node.js >= 18.0.0, TypeScript >= 5.0.0

## What is ATSF?

The **Agentic Trust Scoring Framework** is a runtime governance system for AI agents. It answers the question: _"How much should this agent be trusted to act autonomously?"_

ATSF continuously evaluates agent behavior across multiple dimensions and assigns a trust score (0-1000) that maps to one of eight trust tiers. Each tier defines what an agent is allowed to do -- from isolated sandbox testing to full autonomous operation.

Key principles:

- **Trust is earned, not granted.** Agents start at low trust and must demonstrate competence to advance.
- **Trust decays over time.** Idle agents lose trust; active, well-behaved agents maintain or gain it.
- **Trust loss is asymmetric.** Trust is hard to gain and easy to lose (10:1 ratio per ATSF v2.0).
- **Every decision is auditable.** An immutable proof chain records all governance decisions.

## The 8-Tier Trust Model (T0-T7)

ATSF uses an 8-tier model where score ranges narrow at higher tiers, reflecting the increasing difficulty of achieving greater autonomy.

| Tier | Name | Score Range | Description |
|------|------|-------------|-------------|
| T0 | Sandbox | 0 -- 199 | Isolated testing environment, no real operations |
| T1 | Observed | 200 -- 349 | Read-only access, under active supervision |
| T2 | Provisional | 350 -- 499 | Basic operations with heavy constraints |
| T3 | Monitored | 500 -- 649 | Standard operations, continuous monitoring |
| T4 | Standard | 650 -- 799 | External API access, policy-governed |
| T5 | Trusted | 800 -- 875 | Cross-agent communication, minimal oversight |
| T6 | Certified | 876 -- 950 | Admin-level tasks, audit trail required |
| T7 | Autonomous | 951 -- 1000 | Full autonomy, self-governance |

## Trust Dimensions

ATSF evaluates trust across five canonical dimensions (defined in `@vorionsys/contracts`):

| Dimension | Code | Description |
|-----------|------|-------------|
| **Capability Trust** | CT | Does the agent have the required skills and competencies? |
| **Behavioral Trust** | BT | Has the agent acted reliably and consistently? |
| **Governance Trust** | GT | Is the agent properly governed and policy-compliant? |
| **Contextual Trust** | XT | Is the current context appropriate for the agent's actions? |
| **Assurance Confidence** | AC | How confident are we in our assessment of this agent? |

Default weights: CT (0.25), BT (0.25), GT (0.20), XT (0.15), AC (0.15).

The runtime trust engine also tracks four signal component categories (`behavioral`, `compliance`, `identity`, `context`) that feed into the composite score calculation.

## Quick Start

```typescript
import { createTrustEngine } from '@vorionsys/atsf-core';

// Create a trust engine
const engine = createTrustEngine();

// Initialize an agent at T1 (Observed)
const agent = await engine.initializeEntity('agent-001', 1);
console.log(agent.score); // 200 (T1 minimum)
console.log(agent.level); // 1

// Record a behavioral signal
await engine.recordSignal({
  id: crypto.randomUUID(),
  entityId: 'agent-001',
  type: 'behavioral.task_completed',
  value: 0.9,
  source: 'system',
  timestamp: new Date().toISOString(),
  metadata: { task: 'data-analysis' },
});

// Get the updated score (includes automatic decay calculation)
const record = await engine.getScore('agent-001');
console.log(record?.score, record?.level);
```

## Usage Examples

### Computing Trust Scores

```typescript
import { createTrustEngine } from '@vorionsys/atsf-core';

const engine = createTrustEngine({
  decayRate: 0.01,                 // 1% decay per interval
  decayIntervalMs: 60000,         // 1-minute intervals
  failureThreshold: 0.3,          // Signals below 0.3 = failure
  acceleratedDecayMultiplier: 3.0, // 3x decay on repeated failures
  successThreshold: 0.7,          // Signals above 0.7 = success
  recoveryRate: 0.02,             // 2% recovery per success signal
});

// Initialize agent
await engine.initializeEntity('agent-alpha', 2); // Start at T2 Provisional

// Record multiple signals to build trust
for (const task of completedTasks) {
  await engine.recordSignal({
    id: crypto.randomUUID(),
    entityId: 'agent-alpha',
    type: 'behavioral.task_completed',
    value: task.successRate,
    timestamp: new Date().toISOString(),
  });
}

// Calculate trust
const calc = await engine.calculate('agent-alpha');
console.log(`Score: ${calc.score}, Tier: T${calc.level}`);
console.log('Components:', calc.components);
console.log('Factors:', calc.factors);
```

### Classifying Agents into Tiers

```typescript
import {
  createTrustEngine,
  TRUST_THRESHOLDS,
  TRUST_LEVEL_NAMES,
} from '@vorionsys/atsf-core';

const engine = createTrustEngine();

// Initialize agents at different tiers
await engine.initializeEntity('sandbox-bot', 0);    // T0 Sandbox
await engine.initializeEntity('new-agent', 1);       // T1 Observed
await engine.initializeEntity('proven-agent', 4);    // T4 Standard

// Get tier information
for (const id of engine.getEntityIds()) {
  const record = await engine.getScore(id);
  if (record) {
    const tierName = engine.getLevelName(record.level);
    const { min, max } = TRUST_THRESHOLDS[record.level];
    console.log(`${id}: T${record.level} ${tierName} (score ${record.score}, range ${min}-${max})`);
  }
}
```

### Listening to Trust Events

```typescript
import { createTrustEngine } from '@vorionsys/atsf-core';

const engine = createTrustEngine();

// Listen for tier promotions/demotions
engine.on('trust:tier_changed', (event) => {
  console.log(
    `${event.entityId} ${event.direction}: ` +
    `${event.previousLevelName} -> ${event.newLevelName}`
  );
});

// Listen for failures and accelerated decay
engine.on('trust:failure_detected', (event) => {
  console.log(`Failure #${event.failureCount} for ${event.entityId}`);
  if (event.acceleratedDecayActive) {
    console.log('Accelerated decay is now active (3x normal rate)');
  }
});

// Listen for recovery milestones
engine.on('trust:recovery_milestone', (event) => {
  console.log(`Recovery milestone for ${event.entityId}: ${event.details}`);
});

// Wildcard -- all trust events
engine.on('trust:*', (event) => {
  console.log(`[${event.type}] ${event.entityId}`);
});
```

### Intent Governance Pipeline

```typescript
import {
  createIntentService,
  createEnforcementService,
  createProofService,
} from '@vorionsys/atsf-core';

// Submit an agent intent for governance evaluation
const intentService = createIntentService();
const intent = await intentService.submit({
  entityId: 'agent-001',
  goal: 'Send email to user',
  context: { recipient: 'user@example.com' },
});

// Enforce governance policies
const enforcer = createEnforcementService({
  defaultAction: 'deny',
  requireMinTrustLevel: 2,
});
const decision = await enforcer.decide(context);

// Record an immutable proof of the decision
const proofService = createProofService();
const proof = await proofService.create({ intent, decision, inputs: {}, outputs: {} });
const verification = await proofService.verify(proof.id);
console.log('Verified:', verification.valid);
```

### BASIS Rule Engine

```typescript
import { createEvaluator, parseNamespace } from '@vorionsys/atsf-core';

const evaluator = createEvaluator();

// Register governance rules
evaluator.registerNamespace(parseNamespace({
  namespace: 'email.policy',
  version: '1.0.0',
  rules: [
    {
      name: 'require-trust-level',
      when: { conditions: { minTrustLevel: 3 } },
      evaluate: [{ condition: 'trustLevel >= 3', result: 'allow', reason: 'Sufficient trust' }],
    },
  ],
}));

const result = await evaluator.evaluate(context);
```

### Security Pipeline

```typescript
import {
  createSecurityPipeline,
  createLayerConfig,
  BaseSecurityLayer,
} from '@vorionsys/atsf-core';

const pipeline = createSecurityPipeline({
  maxTotalTimeMs: 5000,
  stopOnFirstFailure: false,
});

// Register security layers and execute
pipeline.registerLayer(mySecurityLayer);
const result = await pipeline.execute(input);
console.log(`Decision: ${result.decision}, Confidence: ${result.confidence}`);
```

### Persistence

```typescript
import {
  createTrustEngine,
  createFileProvider,
} from '@vorionsys/atsf-core';

// File-based persistence
const fileProvider = createFileProvider({
  path: './trust-records.json',
  autoSaveIntervalMs: 5000,
});
await fileProvider.initialize();

const engine = createTrustEngine({
  persistence: fileProvider,
  autoPersist: true,
});

// Load existing records
await engine.loadFromPersistence();

// Records auto-save on changes
await engine.initializeEntity('agent-001', 2);

// Manual save and cleanup
await engine.saveToPersistence();
await engine.close();
```

### LangChain Integration

```typescript
import {
  createTrustEngine,
  createTrustAwareExecutor,
  createTrustTools,
} from '@vorionsys/atsf-core';

const engine = createTrustEngine();
const executor = createTrustAwareExecutor(engine, {
  agentId: 'my-agent',
  initialTrustLevel: 2,
  minTrustLevel: 2,
  recordToolUsage: true,
  recordLlmCalls: true,
});
await executor.initialize();

// Execute with trust gating
const result = await executor.execute(async () => {
  return await agent.invoke({ input: 'Hello' }, { callbacks: [executor.callbackHandler] });
});

console.log(result.trustCheck.allowed); // true if trust level sufficient
console.log(result.finalScore);

// Trust-aware tools for agents
const trustTools = createTrustTools(engine, 'my-agent');
// Available tools: check_my_trust, check_trust_requirements,
//   get_trust_levels, report_task_success, report_task_failure
```

## API Reference

### Core Exports

| Export | Type | Description |
|--------|------|-------------|
| `TrustEngine` | Class | Main trust scoring engine with event emission |
| `createTrustEngine(config?)` | Function | Factory to create a TrustEngine instance |
| `TRUST_THRESHOLDS` | Constant | T0-T7 score range definitions |
| `TRUST_LEVEL_NAMES` | Constant | Human-readable tier names |
| `SIGNAL_WEIGHTS` | Constant | Signal component weights |

### Sub-module Exports

Import from the package root or via deep imports:

| Module Path | Key Exports | Description |
|-------------|-------------|-------------|
| `@vorionsys/atsf-core` | All below | Main entry point |
| `@vorionsys/atsf-core/trust-engine` | `TrustEngine`, `createTrustEngine` | Trust scoring engine |
| `@vorionsys/atsf-core/basis` | `createEvaluator`, `parseNamespace` | BASIS rule evaluation |
| `@vorionsys/atsf-core/intent` | `createIntentService`, `IntentService` | Intent submission and tracking |
| `@vorionsys/atsf-core/enforce` | `createEnforcementService`, `EnforcementService` | Policy decision enforcement |
| `@vorionsys/atsf-core/proof` | `createProofService`, `ProofService` | Immutable SHA-256 audit chain |
| `@vorionsys/atsf-core/chain` | `createChainAnchor`, `computeMerkleRoot` | Blockchain anchoring (Polygon) |
| `@vorionsys/atsf-core/cognigate` | `createGateway`, `CognigateGateway` | Constrained execution runtime |
| `@vorionsys/atsf-core/persistence` | `createFileProvider`, `createMemoryProvider` | Pluggable trust storage |
| `@vorionsys/atsf-core/langchain` | `createTrustAwareExecutor`, `createTrustTools` | LangChain integration |
| `@vorionsys/atsf-core/sandbox-training` | Sandbox training exports | Adversarial training boot camp |
| `@vorionsys/atsf-core/types` | `TrustLevel`, `TrustScore`, `Entity`, `Intent` | Core type definitions |

### Additional Exports

| Export | Description |
|--------|-------------|
| `GovernanceEngine`, `createGovernanceEngine` | Rule-based governance evaluation |
| `FluidWorkflowEngine`, `createFluidWorkflowEngine` | Fluid decision workflow orchestration |
| `SecurityPipeline`, `createSecurityPipeline` | L0-L46 typed security layer pipeline |
| `BaseSecurityLayer` | Abstract base class for security layers |
| `createPhase6TrustEngine` | Phase 6 hardened trust engine |
| `VorionError`, `TrustInsufficientError`, `ConstraintViolationError` | Typed error classes |
| `createServer`, `startServer` | Fastify-based governance API server |

### Trust Event Types

| Event | Emitted When |
|-------|-------------|
| `trust:initialized` | New entity registered |
| `trust:signal_recorded` | Behavioral signal recorded |
| `trust:score_changed` | Score changes by 5+ points |
| `trust:tier_changed` | Entity promoted or demoted |
| `trust:decay_applied` | Trust decayed (includes `accelerated` flag) |
| `trust:failure_detected` | Signal value below failure threshold |
| `trust:recovery_applied` | Recovery from successful signal |
| `trust:recovery_milestone` | Tier restored, full recovery, or accelerated recovery earned |
| `trust:*` | Wildcard -- all trust events |

## Architecture

```
@vorionsys/atsf-core
  |-- trust-engine/     Trust scoring with 8-tier model, decay, and recovery
  |-- basis/            BASIS rule evaluation engine
  |-- intent/           Intent submission and lifecycle tracking
  |-- enforce/          Policy decision point (allow/deny/escalate)
  |-- proof/            Immutable SHA-256 audit chain with Merkle proofs
  |-- chain/            Blockchain anchoring (Polygon networks)
  |-- cognigate/        Constrained execution with resource limits
  |-- governance/       Authority engine and fluid workflows
  |-- layers/           L0-L46 typed security layer pipeline
  |-- arbitration/      Multi-agent trust arbitration
  |-- containment/      Progressive containment protocols
  |-- contracts/        Output contracts (VorionResponse)
  |-- provenance/       Decision provenance (DPO) tracking
  |-- persistence/      Pluggable storage (memory, file, Supabase)
  |-- langchain/        LangChain callback handler and trust tools
  |-- sandbox-training/ Adversarial training boot camp
  |-- phase6/           Trust engine hardening (advanced)
```

## Peer Dependencies

| Package | Required | Purpose |
|---------|----------|---------|
| `typescript` | >= 5.0.0 | Required for type definitions |
| `@langchain/core` | >= 0.2.0 | Optional -- LangChain integration |
| `better-sqlite3` | >= 9.0.0 | Optional -- SQLite persistence |

## Testing

The package has comprehensive test coverage with **401+ tests** covering trust scoring, decay mechanics, recovery paths, governance pipelines, security layers, and edge cases.

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

## License

[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)

Copyright 2024-2026 Vorion

## Links

- **Repository:** [github.com/vorionsys/vorion](https://github.com/vorionsys/vorion/tree/main/packages/atsf-core)
- **Homepage:** [vorion.org](https://vorion.org)
- **Issues:** [github.com/vorionsys/vorion/issues](https://github.com/vorionsys/vorion/issues)
