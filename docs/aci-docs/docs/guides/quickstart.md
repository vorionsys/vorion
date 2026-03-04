---
sidebar_position: 1
title: Quick Start
---

# Quick Start Guide

Get up and running with ACI in under 5 minutes.

## Installation

```bash
npm install @vorionsys/aci-spec
```

## Parse an ACI String

```typescript
import { parseACI } from '@vorionsys/aci-spec';

const parsed = parseACI('aci:agentanchor:vorion:classifier/FH/L3/T5/1.0.0');

console.log(parsed);
// {
//   scheme: 'aci',
//   registry: 'agentanchor',
//   organization: 'vorion',
//   agentClass: 'classifier',
//   domains: ['F', 'H'],
//   level: 3,
//   trust: 5,
//   version: '1.0.0'
// }
```

## Validate an ACI String

```typescript
import { validateACI } from '@vorionsys/aci-spec';

const result = validateACI('aci:agentanchor:vorion:classifier/FH/L3/T5/1.0.0');

if (result.valid) {
  console.log('Valid ACI:', result.aci);
} else {
  console.error('Validation errors:', result.errors);
}
```

## Check Requirements

```typescript
import { parseACI, satisfiesRequirements } from '@vorionsys/aci-spec';

const agent = parseACI('aci:agentanchor:vorion:classifier/FH/L3/T5/1.0.0');

// Does this agent meet our requirements?
const meets = satisfiesRequirements(agent, {
  requiredDomains: ['F'],      // Must have Financial domain
  minimumLevel: 'L2',          // At least Assist level
  minimumTrust: 'T4',          // At least Standard trust
});

console.log(meets); // true
```

## Construct an ACI String

```typescript
import { buildACI } from '@vorionsys/aci-spec';

const aci = buildACI({
  registry: 'agentanchor',
  organization: 'myorg',
  agentClass: 'data-processor',
  domains: ['D', 'R'],      // Data + Research
  level: 2,                 // Assist
  trust: 3,                 // Monitored
  version: '1.0.0',
});

console.log(aci);
// "aci:agentanchor:myorg:data-processor/DR/L2/T3/1.0.0"
```

## Capability Gating

Use ACI for runtime authorization:

```typescript
function processFinancialTransaction(agent: ParsedACI, transaction: Transaction) {
  // Check domain authorization
  if (!agent.domains.includes('F')) {
    throw new Error('Agent not authorized for Financial domain');
  }

  // Check capability level
  if (agent.level < 3) {
    throw new Error('Agent needs L3 (Supervised) or higher for autonomous transactions');
  }

  // Check trust tier
  if (agent.trust < 4) {
    throw new Error('Agent needs T4 (Standard) or higher trust for transactions');
  }

  // Proceed with transaction
  return executeTransaction(transaction);
}
```

## Next Steps

- **[Core Specification](/specs/core)** — Full format reference and ABNF grammar
- **[DID Method](/specs/did-method)** — Decentralized identity for agents
- **[OpenID Claims](/specs/openid-claims)** — Token-based capability authorization
- **[Security Hardening](/security/hardening)** — Production security controls
- **[Registry API](/specs/registry-api)** — Agent registration and discovery
