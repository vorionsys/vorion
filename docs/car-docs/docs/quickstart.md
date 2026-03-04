---
sidebar_position: 2
title: Quick Start
---

# Quick Start

Get your first agent mission-certified in 5 minutes using the TypeScript SDK.

## Install

```bash
npm install @vorion/car-client
```

## Parse a Mission Profile (CAR String)

```typescript
import { parseCAR } from '@vorion/car-client';

const car = parseCAR('a3i.vorion.banquet-advisor:FHC-L3@1.2.0');

console.log(car);
// {
//   registry: 'a3i',
//   organization: 'vorion',
//   agentClass: 'banquet-advisor',
//   domains: ['C', 'F', 'H'],
//   level: 3,
//   version: '1.2.0'
// }
```

## Build a Mission Profile

```typescript
import { buildCAR } from '@vorion/car-client';

const car = buildCAR({
  registry: 'a3i',
  organization: 'myorg',
  agentClass: 'data-processor',
  domains: ['D', 'E'],
  level: 2,
  version: '1.0.0',
});

console.log(car);
// "a3i.myorg.data-processor:DE-L2@1.0.0"
```

## Mission Authorization (Capability Gating)

```typescript
function processPayment(agent: ParsedCAR, payment: Payment) {
  // Must have Finance domain
  if (!agent.domains.includes('F')) {
    throw new Error('Agent not authorized for Finance domain');
  }

  // Must be L3+ (Execute with approval)
  if (agent.level < 3) {
    throw new Error('Agent needs L3+ for payment execution');
  }

  return executePayment(payment);
}
```

## Check Clearance Level

```typescript
import { CARClient } from '@vorion/car-client';

const client = new CARClient({
  endpoint: 'https://api.agentanchor.io',
  apiKey: process.env.CAR_API_KEY,
});

const trust = await client.getTrustScore('a3i.vorion.banquet-advisor:FHC-L3@1.2.0');
console.log(`Score: ${trust.score}, Tier: T${trust.tier}`);
// Score: 742, Tier: T4
```

## Using the CLI

```bash
# Install CLI
npm install -g @vorion/car-cli

# Look up agent stats
car stats a3i.vorion.banquet-advisor:FHC-L3@1.2.0

# Evaluate trust score
car evaluate a3i.vorion.banquet-advisor:FHC-L3@1.2.0

# Check ceiling enforcement
car ceiling a3i.vorion.banquet-advisor:FHC-L3@1.2.0

# Query agent provenance
car provenance a3i.vorion.banquet-advisor:FHC-L3@1.2.0
```

## Next Steps

- [CAR String Format](/specification/format) — Full format reference
- [Domains](/specification/domains) — All 10 capability domains
- [Levels](/specification/levels) — 8 capability levels explained
- [Tiers](/specification/tiers) — Clearance tiers & mission authority levels
- [TypeScript SDK](/sdks/typescript) — Full SDK reference
