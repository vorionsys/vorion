# @vorionsys/platform-core

Core business logic for the Vorion AI Governance Platform -- trust engine, governance, enforcement, proof systems, and more.

## Installation

```bash
npm install @vorionsys/platform-core
```

## Modules

| Module            | Description                                      |
| ----------------- | ------------------------------------------------ |
| `trust-engine`    | Trust scoring, tier calculation, factor evaluation |
| `enforce`         | Policy enforcement decisions                     |
| `proof`           | Immutable evidence chain and audit logging        |
| `governance`      | Governance rules and policy workflows            |
| `basis`           | Declarative rule engine (BASIS expressions)      |
| `intent`          | Intent parsing, classification, risk assessment  |
| `cognigate`       | Constrained execution gateway, sandbox policies  |
| `security`        | Authentication and authorization                 |
| `a2a`             | Agent-to-Agent protocol                          |
| `agent-registry`  | Agent Anchor core (identity, attestation)        |
| `observability`   | Metrics, logging, tracing, health, alerts        |
| `persistence`     | Repository pattern for data access               |
| `versioning`      | SemVer utilities, deprecation, compatibility     |
| `audit`           | Audit logging and SIEM integration               |
| `friction`        | Friction feedback for denial explanations         |
| `common`          | Shared utilities (crypto, DB, Redis, telemetry)  |
| `api`             | Fastify API server                               |

## Usage

```typescript
import {
  createServer,
  createEnforcementService,
  createIntentClassifier,
} from '@vorionsys/platform-core';

// Start the Fastify API server
const server = await createServer();

// Or use individual modules
import { TrustEngine } from '@vorionsys/platform-core/trust-engine';
import { PolicyEnforcer } from '@vorionsys/platform-core/enforce';
```

## Subpath Exports

Each module is available as a subpath export:

```typescript
import { ... } from '@vorionsys/platform-core/trust-engine';
import { ... } from '@vorionsys/platform-core/enforce';
import { ... } from '@vorionsys/platform-core/proof';
import { ... } from '@vorionsys/platform-core/governance';
import { ... } from '@vorionsys/platform-core/basis';
import { ... } from '@vorionsys/platform-core/intent';
import { ... } from '@vorionsys/platform-core/cognigate';
import { ... } from '@vorionsys/platform-core/security';
import { ... } from '@vorionsys/platform-core/a2a';
import { ... } from '@vorionsys/platform-core/agent-registry';
import { ... } from '@vorionsys/platform-core/observability';
import { ... } from '@vorionsys/platform-core/persistence';
import { ... } from '@vorionsys/platform-core/versioning';
import { ... } from '@vorionsys/platform-core/audit';
import { ... } from '@vorionsys/platform-core/policy';
```

## Development

```bash
npm run build       # Build
npm run dev         # Watch mode
npm test            # Run tests
npm run typecheck   # Type check
```

## Requirements

- Node.js >= 18
- TypeScript >= 5.0

## License

Apache-2.0
