# Vorion Open Source

**A small early contribution toward trustworthy autonomous AI agents**

BASIS &middot; ATSF Trust Scoring &middot; CAR Registry &middot; Cognigate Runtime &middot; Kaizen Learning

[![CI](https://github.com/vorionsys/vorion/actions/workflows/ci.yml/badge.svg)](https://github.com/vorionsys/vorion/actions)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](https://github.com/vorionsys/vorion/blob/main/LICENSE)
[![npm](https://img.shields.io/badge/npm-%40vorionsys%2F*-orange.svg)](https://www.npmjs.com/search?q=%40vorionsys)
![Stars](https://img.shields.io/github/stars/vorionsys/vorion?style=social)

> **This is v0.1 — early, experimental, and explicitly not "the standard."**
> We are a tiny team experimenting with open governance primitives. We built this because we needed it ourselves and wanted to share it humbly with the community.

```bash
npm install @vorionsys/atsf-core @vorionsys/car-client
```

[Live Runtime](https://cognigate.dev) &middot; [Docs](https://learn.vorion.org) &middot; [BASIS Spec](docs/BASIS.md) &middot; [Roadmap](docs/ROADMAP.md)

---

## Why we built this (and why it might not be for you yet)

[LangChain](https://github.com/langchain-ai/langchain), [CrewAI](https://github.com/crewAIInc/crewAI), and [AutoGen](https://github.com/microsoft/autogen) are incredible at building agents. We kept running into the same wall: no shared, inspectable way to make those agents trustworthy at production scale.

So we started experimenting with a few primitives — intent normalization, tiered trust scoring, capability gating, and cryptographic audit trails. This is not production battle-tested. It has zero external users right now. We are sharing it early because we believe open collaboration is the only way to build the rock AI agents can safely stand on.

| Aspect | Popular Agent Frameworks | Vorion v0.1 (our experiment) | Our current limitation |
|--------|--------------------------|------------------------------|------------------------|
| Building / Orchestration | World-class | &mdash; | &mdash; |
| Governance Standard | None native | Early [BASIS](docs/BASIS.md) spec | No formal verification yet |
| Trust Scoring | None native | Simple ATSF T0&ndash;T7 (heuristic) | Arbitrary tiers, no public benchmarks |
| Agent Registry | None | CAR (experimental) | Centralized demo registry |
| Enforcement Runtime | DIY / paid suites | [Cognigate](https://cognigate.dev) (live, open) | No independent security audit |
| Audit Trails | Tracing tools | Basic SHA-256 proof chain | Not yet ZK or blockchain-anchored |
| License | MIT (core) | Full stack Apache 2.0 | &mdash; |

We are complementary and not trying to replace anything. Drop-in wrappers exist but are early-stage.

## We know the breakpoints

- Zero stars &mdash; we are brand new
- v0.1 everything &mdash; expect breaking changes
- Pre-reasoning claims &mdash; still relies on heuristics (jailbreakable)
- T0&ndash;T7 tiers &mdash; arbitrary until the community helps refine them
- Two maintainers, both self-taught

If any of these are deal-breakers, that's fair. We are here to learn and would genuinely love your honest feedback &mdash; even if it's "this won't work because&hellip;"

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

- [Governance Model](GOVERNANCE.md) — How decisions get made
- [Contributing](.github/CONTRIBUTING.md)
- [Security Policy](.github/SECURITY.md)
- [Code of Conduct](.github/CODE_OF_CONDUCT.md)
- [Pull Request Template](.github/pull_request_template.md)
- [Issue Templates](.github/ISSUE_TEMPLATE)

## The people behind Vorion

Created by **Alex Blanc** and **Ryan Cason (Bo Xandar Lee)** — two former banquet servers who taught themselves to code with AI and wanted to give something back to the community.

We believe AI is humanity's greatest asset in the making, but it won't happen by chance. It must be guided.

[Read our full story →](https://vorion.org/manifesto)

---

*Built with BASIS · [vorion.org](https://vorion.org) · Feedback welcome — even the brutal kind.*
