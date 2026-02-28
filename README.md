# Vorion Open Source

**A small early contribution toward trustworthy autonomous AI agents**

We are a tiny team experimenting with open governance primitives. This is v0.1 — rough, incomplete, and explicitly not "the standard." We built it because we needed it ourselves and wanted to share it humbly with the community.

BASIS · ATSF Trust Scoring · CAR Registry · Cognigate Runtime · Kaizen Learning

[![CI](https://github.com/vorionsys/vorion/actions/workflows/ci.yml/badge.svg)](https://github.com/vorionsys/vorion/actions)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/badge/npm-%40vorionsys-orange.svg)](https://www.npmjs.com/search?q=%40vorionsys)
![Stars](https://img.shields.io/github/stars/vorionsys/vorion?style=social)

```bash
npm install @vorionsys/atsf-core @vorionsys/car-client
```

[Live runtime →](https://cognigate.dev) · [Docs](docs/) · [BASIS spec](docs/BASIS.md) · [Roadmap](docs/ROADMAP.md)

## Why we built this (and why it might not be for you yet)

LangChain, CrewAI, AutoGen, and others are incredible at building agents.
We kept running into the same wall: **no shared, inspectable way to make those agents trustworthy** at production scale.

So we started experimenting with a few primitives:

- Pre-reasoning intent normalization
- Simple tiered trust scoring (T0–T7)
- Basic capability gating
- Cryptographic audit trails

**This is not production battle-tested.** It has zero external users right now. We are sharing it early because we believe open collaboration is the only way to build the rock AI agents can safely stand on.

We would love your honest feedback — even if it's "this won't work because…"

### Transparent comparison

| Aspect | Popular Agent Frameworks (LangChain etc.) | Vorion v0.1 (our experiment) | Our current limitation |
|--------|------------------------------------------|------------------------------|----------------------|
| Building agents | World-class | — | — |
| Governance & trust | DIY or commercial guardrails | Early open primitives | No formal verification yet |
| Trust scoring | None native | Simple ATSF T0–T7 (heuristic) | Arbitrary tiers, no public benchmarks |
| Agent identity/registry | None | CAR (experimental) | Centralized demo registry |
| Audit trails | Tracing tools | Basic SHA-256 proof chain | Not yet ZK or blockchain-anchored |
| License | MIT (core) | Full Apache 2.0 | — |

We are complementary and not trying to replace anything.

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

## The people behind Vorion

Vorion was created by **Alex Blanc** and **Ryan Cason (Bo Xandar Lee)** — two former banquet servers who taught themselves to code with AI and wanted to give something back to the community.

We believe AI is humanity's greatest asset in the making, but it won't happen by chance. It must be guided.

[Read our full story →](https://vorion.org/about)

---

*Assisted at every step by multiple LLMs — we believe in crediting the tools that helped us think.*
