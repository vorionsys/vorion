# @vorionsys/platform-core

Core business logic for the Vorion AI Governance Platform.

## Overview

This package contains the core implementation of Vorion's governance systems:

- **trust-engine/** - Trust scoring and calculation
- **enforce/** - Policy enforcement decisions
- **proof/** - Evidence chain and audit logging
- **governance/** - Governance rules and workflows
- **basis/** - Rule engine implementation
- **intent/** - Intent parsing and classification
- **cognigate/** - Constrained execution gateway
- **security/** - Authentication and authorization
- **common/** - Shared utilities (retry, circuit-breaker, idempotency)
- **api/** - API server implementation
- **db/** - Database client and connections

## Installation

```bash
npm install @vorionsys/platform-core
```

## Usage

```typescript
import { TrustEngine } from '@vorionsys/platform-core/trust-engine';
import { PolicyEnforcer } from '@vorionsys/platform-core/enforce';
import type { AgentId } from '@vorionsys/contracts';
```

## Import Rules

This package follows strict import direction rules:

- **CAN import from:** `@vorionsys/contracts`, external dependencies
- **CANNOT import from:** `apps/*`, other `@vorionsys/*` packages

The `db/client.ts` file has additional restrictions - see architecture documentation.

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Run tests
npm test

# Type check
npm run typecheck
```

## Architecture

See `_bmad-output/planning-artifacts/architecture.md` for complete architectural documentation.
