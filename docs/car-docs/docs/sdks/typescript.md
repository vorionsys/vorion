---
sidebar_position: 1
title: TypeScript SDK
---

# TypeScript SDK

The `@vorion/car-client` package provides a full-featured TypeScript SDK for parsing, validating, and interacting with the CAR system.

## Installation

```bash
npm install @vorion/car-client
```

## Parsing

```typescript
import { parseCAR } from '@vorion/car-client';

const car = parseCAR('a3i.vorion.banquet-advisor:FHC-L3@1.2.0');

console.log(car.registry);      // 'a3i'
console.log(car.organization);  // 'vorion'
console.log(car.agentClass);    // 'banquet-advisor'
console.log(car.domains);       // ['C', 'F', 'H']
console.log(car.domainBitmask); // 0x0A4
console.log(car.level);         // 3
console.log(car.version);       // '1.2.0'
```

## Building

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
// "a3i.myorg.data-processor:DE-L2@1.0.0"
```

## Validation

```typescript
import { validateCAR } from '@vorion/car-client';

const result = validateCAR('a3i.vorion.banquet-advisor:FHC-L3@1.2.0');

if (result.valid) {
  console.log('Valid CAR:', result.car);
} else {
  console.error('Errors:', result.errors);
}
```

## Domain Operations

```typescript
import { encodeDomains, decodeDomains, hasDomain } from '@vorion/car-client';

// Encode domains to bitmask
const mask = encodeDomains(['A', 'B', 'F']); // 35

// Decode bitmask
const domains = decodeDomains(mask); // ['A', 'B', 'F']

// Check domain membership
const hasFinance = hasDomain(mask, 'F'); // true
```

## Client API

```typescript
import { CARClient } from '@vorion/car-client';

const client = new CARClient({
  endpoint: 'https://api.agentanchor.io',
  apiKey: process.env.CAR_API_KEY,
});

// Get agent info
const agent = await client.getAgent('a3i.vorion.banquet-advisor:FHC-L3@1.2.0');

// Get trust score
const trust = await client.getTrustScore(agent.did);

// Query agents by capability
const agents = await client.queryAgents({
  domains: ['F', 'H'],
  minLevel: 2,
  minTrust: 4,
});

// Check trust ceiling
const ceiling = await client.getCeiling(agent.did);
```

## Types

```typescript
type DomainCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'S';

enum CapabilityLevel {
  L0_OBSERVE = 0,
  L1_ADVISE = 1,
  L2_DRAFT = 2,
  L3_EXECUTE = 3,
  L4_AUTONOMOUS = 4,
  L5_TRUSTED = 5,
  L6_CERTIFIED = 6,
  L7_SOVEREIGN = 7,
}

interface ParsedCAR {
  car: string;
  registry: string;
  organization: string;
  agentClass: string;
  domains: DomainCode[];
  domainBitmask: number;
  level: CapabilityLevel;
  version: string;
  extensions?: string[];
}
```
