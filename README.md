# Vorion Open Source

**AI Governance Framework — Trust Scoring, Enforcement, and Agent Identity**

This monorepo contains the open-source packages powering the Vorion AI governance ecosystem.

## Packages

### Foundation

| Package | Description |
|---------|-------------|
| [`@vorionsys/shared-constants`](packages/shared-constants) | Trust tiers (T0-T7), domains, error codes |
| [`@vorionsys/basis`](packages/basis) | BASIS standard, trust factors, KYA |
| [`@vorionsys/contracts`](packages/contracts) | Zod schemas, API contracts, validators |

### Core Services

| Package | Description |
|---------|-------------|
| [`@vorionsys/atsf-core`](packages/atsf-core) | Agentic Trust Scoring Framework |
| [`@vorionsys/cognigate`](packages/cognigate) | Policy enforcement client |
| [`@vorionsys/platform-core`](packages/platform-core) | Core governance platform |
| [`@vorionsys/runtime`](packages/runtime) | Orchestration layer |
| [`@vorionsys/ai-gateway`](packages/ai-gateway) | Multi-provider AI routing |
| [`@vorionsys/proof-plane`](packages/proof-plane) | Immutable audit trail with hash chains |

### CAR (Categorical Agentic Registry)

| Package | Description |
|---------|-------------|
| [`@vorionsys/car-spec`](packages/car-spec) | CAR OpenAPI 3.1.0 specification |
| [`@vorionsys/car-client`](packages/car-client) | TypeScript client SDK |
| [`@vorionsys/car-cli`](packages/car-cli) | CLI tool |
| [`@vorionsys/car-python`](packages/car-python) | Python client SDK |

### SDKs

| Package | Description |
|---------|-------------|
| [`@vorionsys/sdk`](packages/sdk) | Simple governance interface |
| [`@vorionsys/council`](packages/council) | 16-agent governance orchestrator |

## Apps

| App | Description |
|-----|-------------|
| [`@vorionsys/kaizen`](apps/kaizen) | AI Learning Platform — [learn.vorion.org](https://learn.vorion.org) |
| [`cognigate-api`](apps/cognigate-api) | Cognigate governance API service |

## Getting Started

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm run test

# Type check
npm run typecheck
```

## Architecture

```
Foundation:    shared-constants → basis → contracts
                       ↓            ↓        ↓
Services:      atsf-core, cognigate, platform-core, runtime
                       ↓
SDKs:          sdk, council, car-client, car-cli
```

## License

Apache-2.0. See [LICENSE](LICENSE) for details.

## Links

- [vorion.org](https://vorion.org) — Main site
- [learn.vorion.org](https://learn.vorion.org) — Kaizen learning platform
- [cognigate.dev](https://cognigate.dev) — Governance runtime
