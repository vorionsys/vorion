# Vorion Open Source

**The open foundation for trustworthy autonomous AI agents**

BASIS &middot; ATSF Trust Scoring &middot; CAR Registry &middot; Cognigate Runtime &middot; Kaizen Learning

[![CI](https://github.com/vorionsys/vorion/actions/workflows/ci.yml/badge.svg)](https://github.com/vorionsys/vorion/actions)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](https://github.com/vorionsys/vorion/blob/main/LICENSE)
[![npm](https://img.shields.io/badge/npm-%40vorionsys%2F*-orange.svg)](https://www.npmjs.com/search?q=%40vorionsys)

```bash
npm install @vorionsys/atsf-core @vorionsys/car-client
```

[Live Runtime](https://cognigate.dev) &middot; [Docs](https://learn.vorion.org) &middot; [BASIS Spec](docs/BASIS.md)

---

## Why Vorion?

[LangChain](https://github.com/langchain-ai/langchain), [CrewAI](https://github.com/crewAIInc/crewAI), and [AutoGen](https://github.com/microsoft/autogen) are excellent at **building and orchestrating** agents. Vorion is the open governance layer that makes any of them **production-ready and regulator-friendly**.

| Aspect | LangChain / CrewAI / AutoGen | Vorion (Apache 2.0) |
|--------|------------------------------|---------------------|
| Building / Orchestration | Excellent | &mdash; |
| Governance Standard | None | [BASIS](docs/BASIS.md) (formal spec) |
| Real-time Trust Scoring | None | ATSF T0&ndash;T7 + cryptographic proofs |
| Agent Registry | None | CAR + SDK + CLI |
| Enforcement Runtime | DIY / paid suites | [Cognigate](https://cognigate.dev) (live, open) |
| License | MIT (core) | Full stack Apache 2.0 |

Drop-in compatible &mdash; wrap any LangGraph, CrewAI crew, or AutoGen workflow.

---

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
Services:      atsf-core, cognigate, runtime
                       ↓
SDKs:          sdk, council, car-client, car-cli
```

## License

Apache-2.0. See [LICENSE](LICENSE) for details.

## Links

- [vorion.org](https://vorion.org) — Main site
- [learn.vorion.org](https://learn.vorion.org) — Kaizen learning platform
- [cognigate.dev](https://cognigate.dev) — Governance runtime

## Governance

- [Contributing](.github/CONTRIBUTING.md)
- [Security Policy](.github/SECURITY.md)
- [Code of Conduct](.github/CODE_OF_CONDUCT.md)
- [Pull Request Template](.github/pull_request_template.md)
- [Issue Templates](.github/ISSUE_TEMPLATE)
