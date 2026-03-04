---
sidebar_position: 1
title: Getting Started
description: Build your first BASIS-compliant agent
---

# Getting Started

## Overview

This guide walks you through implementing BASIS governance for your AI agent in under 10 minutes.

## Architecture Overview

```mermaid
flowchart TB
    subgraph Agent["Your AI Agent"]
        A[Agent Logic]
    end

    subgraph BASIS["BASIS Governance Stack"]
        I[INTENT Layer]
        E[ENFORCE Layer]
        P[PROOF Layer]
        C[CHAIN Layer]
    end

    subgraph Trust["Trust Engine"]
        T[Trust Score]
        S[Signals]
    end

    A -->|"1. Submit Intent"| I
    I -->|"2. Structured Plan"| E
    E -->|"3. Check Trust"| T
    T -->|"4. Decision"| E
    E -->|"5. Log Decision"| P
    P -->|"6. High-Risk"| C
    E -->|"7. ALLOW/DENY"| A
    A -->|"8. Behavioral Signal"| S
    S -->|"9. Update"| T

    style A fill:#e1f5fe
    style E fill:#c8e6c9
    style T fill:#fff3e0
    style C fill:#f3e5f5
```

## Quick Start (5 Minutes)

### Option 1: Use ATSF Core (TypeScript)

```bash
npm install @vorionsys/atsf-core
```

```typescript
import {
  createTrustEngine,
  createEnforcementService
} from '@vorionsys/atsf-core';

// 1. Initialize Trust Engine
const trustEngine = createTrustEngine({
  decayRate: 0.01,
  decayIntervalMs: 60000,
});

// 2. Register your agent
await trustEngine.initializeEntity('my-agent', 1); // Start at L1 (Provisional)

// 3. Create enforcement service
const enforce = createEnforcementService({ trustEngine });

// 4. Gate every action
const decision = await enforce.gate({
  agentId: 'my-agent',
  action: 'read_user_data',
  capabilities: ['data/read_user'],
  risk: 'limited',
});

if (decision.allowed) {
  // Proceed with action
  console.log('Action allowed');

  // Record success signal
  await trustEngine.recordSignal({
    id: crypto.randomUUID(),
    entityId: 'my-agent',
    type: 'behavioral.task_completed',
    value: 0.9,
    source: 'my-app',
    timestamp: new Date().toISOString(),
    metadata: { action: 'read_user_data' },
  });
} else {
  console.log('Action denied:', decision.reason);
}
```

### Option 2: Use Cognigate (Docker)

```bash
git clone https://github.com/voriongit/cognigate.git
cd cognigate
docker-compose up -d
```

```typescript
// Your agent calls Cognigate's API before any action
const gate = await fetch('http://localhost:8000/v1/enforce/gate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agentId: 'ag_your_agent',
    intentId: intent.id,
    requestedCapabilities: ['data/read_user']
  })
});

const decision = await gate.json();

if (decision.decision === 'ALLOW') {
  // Proceed with action
} else {
  // Handle denial
}
```

## Trust Flow Diagram

```mermaid
sequenceDiagram
    participant Agent
    participant Intent as INTENT Layer
    participant Enforce as ENFORCE Layer
    participant Trust as Trust Engine
    participant Proof as PROOF Layer
    participant Chain as CHAIN Layer

    Agent->>Intent: Submit goal
    Intent->>Intent: Parse & normalize
    Intent->>Enforce: Structured plan
    Enforce->>Trust: Check score
    Trust-->>Enforce: Score: 450 (L2)
    Enforce->>Enforce: Evaluate policies

    alt Trust Sufficient
        Enforce->>Proof: Log ALLOW
        Enforce-->>Agent: ALLOW
        Agent->>Trust: Success signal (+5)
    else Trust Insufficient
        Enforce->>Proof: Log DENY
        Proof->>Chain: Anchor (if HIGH risk)
        Enforce-->>Agent: DENY + reason
    end
```

## Build Your Own Implementation

### Layer Architecture

```mermaid
graph LR
    subgraph L1["Layer 1: INTENT"]
        I1[Parse Request]
        I2[Normalize Goals]
        I3[Extract Capabilities]
    end

    subgraph L2["Layer 2: ENFORCE"]
        E1[Policy Check]
        E2[Trust Gate]
        E3[Decision]
    end

    subgraph L3["Layer 3: PROOF"]
        P1[Hash Chain]
        P2[Signatures]
        P3[Receipts]
    end

    subgraph L4["Layer 4: CHAIN"]
        C1[Batch Proofs]
        C2[Merkle Tree]
        C3[Polygon Anchor]
    end

    I1 --> I2 --> I3 --> E1
    E1 --> E2 --> E3 --> P1
    P1 --> P2 --> P3 --> C1
    C1 --> C2 --> C3
```

### 1. INTENT Layer

Parse agent requests into structured intents:

```typescript
interface Intent {
  intentId: string;
  action: string;
  capabilities: string[];
  risk: 'MINIMAL' | 'LOW' | 'HIGH' | 'CRITICAL';
}

function parseIntent(request: string): Intent {
  // Use LLM or rule-based parsing
  return {
    intentId: crypto.randomUUID(),
    action: extractAction(request),
    capabilities: extractCapabilities(request),
    risk: classifyRisk(request),
  };
}
```

### 2. ENFORCE Layer

Check trust and policies:

```typescript
import { createTrustEngine, TRUST_THRESHOLDS } from '@vorionsys/atsf-core';

const CAPABILITY_THRESHOLDS: Record<string, number> = {
  'data/read_public': 1,    // L1: Provisional
  'data/read_user': 2,      // L2: Standard
  'data/write': 3,          // L3: Trusted
  'system/execute': 4,      // L4: Certified
  'system/admin': 5,        // L5: Autonomous
};

async function gate(intent: Intent): Promise<Decision> {
  const record = await trustEngine.getScore(intent.agentId);

  if (!record) {
    return { decision: 'DENY', reason: 'Unknown agent' };
  }

  for (const cap of intent.capabilities) {
    const requiredLevel = CAPABILITY_THRESHOLDS[cap] ?? 3;
    if (record.level < requiredLevel) {
      return {
        decision: 'DENY',
        reason: `Capability "${cap}" requires L${requiredLevel}, agent is L${record.level}`,
      };
    }
  }

  return { decision: 'ALLOW', trustLevel: record.level };
}
```

### 3. PROOF Layer

Log all decisions with cryptographic integrity:

```typescript
import { createHash, sign } from 'crypto';

interface ProofRecord {
  proofId: string;
  hash: string;
  previousHash: string;
  signature: string;
  data: Decision;
  timestamp: string;
}

let lastHash = '0'.repeat(64);

async function logProof(decision: Decision): Promise<ProofRecord> {
  const data = JSON.stringify(decision);
  const hash = createHash('sha256').update(data + lastHash).digest('hex');

  const record: ProofRecord = {
    proofId: `prf_${crypto.randomUUID()}`,
    hash,
    previousHash: lastHash,
    signature: sign('sha256', Buffer.from(hash), privateKey).toString('hex'),
    data: decision,
    timestamp: new Date().toISOString(),
  };

  lastHash = hash;
  await store(record);
  return record;
}
```

### 4. CHAIN Layer

Anchor high-risk decisions to Polygon:

```typescript
import { createChainAnchor } from './chain-anchor';

const chainAnchor = createChainAnchor({
  network: 'amoy', // Use 'mainnet' for production
  contractAddress: process.env.ANCHOR_CONTRACT!,
  privateKey: process.env.POLYGON_PRIVATE_KEY!,
});

async function anchor(proof: ProofRecord): Promise<void> {
  if (proof.data.risk === 'HIGH' || proof.data.risk === 'CRITICAL') {
    await chainAnchor.anchorBatch([{
      proofHash: `0x${proof.hash}`,
      agentId: proof.data.agentId,
    }]);
  }
}
```

## Trust Tier Reference

```mermaid
graph LR
    T0[T0: Sandbox<br/>0-199]
    T1[T1: Observed<br/>200-349]
    T2[T2: Provisional<br/>350-499]
    T3[T3: Monitored<br/>500-649]
    T4[T4: Standard<br/>650-799]
    T5[T5: Trusted<br/>800-875]
    T6[T6: Certified<br/>876-950]
    T7[T7: Autonomous<br/>951-1000]

    T0 --> T1 --> T2 --> T3 --> T4 --> T5 --> T6 --> T7

    style T0 fill:#ffcdd2
    style T1 fill:#ffab91
    style T2 fill:#ffe0b2
    style T3 fill:#fff9c4
    style T4 fill:#c8e6c9
    style T5 fill:#b3e5fc
    style T6 fill:#b39ddb
    style T7 fill:#e1bee7
```

| Tier | Name | Capabilities |
|------|------|--------------|
| T0 | Sandbox | Read-only, no external access |
| T1 | Observed | Limited operations, high oversight |
| T2 | Provisional | Basic operations, monitored |
| T3 | Monitored | Standard tools, logging required |
| T4 | Standard | Extended tools, reduced oversight |
| T5 | Trusted | Elevated operations, light oversight |
| T6 | Certified | Privileged operations |
| T7 | Autonomous | Full capabilities |

## Validate Compliance

Run the test suite:

```bash
npx @basis-protocol/compliance-tests --target http://localhost:8000
```

Expected output:
```
BASIS Compliance Test Suite v1.0

✓ INTENT: Request parsing
✓ INTENT: Capability extraction
✓ ENFORCE: Trust gate
✓ ENFORCE: Policy evaluation
✓ PROOF: Hash chain integrity
✓ PROOF: Signature verification
✓ CHAIN: Anchor verification (if configured)

7/7 tests passed
```

## Next Steps

- [Compliance Tests](/implement/compliance-tests) - Full test coverage
- [Get Certified](/implement/certification) - Official certification process
- [Trust Scoring](/spec/trust-scoring) - Deep dive into trust mechanics
- [Regulatory Compliance](/spec/regulatory-compliance) - EU AI Act & NIST alignment
