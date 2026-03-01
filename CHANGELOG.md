# Changelog

All notable changes to the Vorion monorepo will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.1.4] — 2026-03-01

### Added
- **Monitoring**: Grafana dashboard (30 panels), Prometheus `/metrics` endpoint, provisioning config
- **Tracing**: Zero-dep OpenTelemetry abstraction (Noop/Console/InMemory tracers, W3C context propagation)
- **Benchmarks**: Vitest bench files for trust engine, security layers, merkle trees, intent pipeline
- **Load Testing**: k6 scripts (smoke, load, stress, spike) for all Cognigate API endpoints
- **Integration Test**: Full intent→proof pipeline lifecycle test (20 cases)
- **Rate-Limit Tests**: L5 rate limiter suite (55 test cases with fake timers)
- **Examples**: `examples/` directory with quickstart, trust-scoring, governance, CAR identity
- **OpenAPI Spec**: Full OpenAPI 3.0.3 for all 28 Cognigate REST endpoints
- **Migration Guide**: `docs/MIGRATION.md` covering ACI→CAR rename, deprecation timeline
- **Changelog Automation**: Commit-lint PR check, release-notes workflow, GitHub release.yml

### Fixed
- All 5 P0 critical issues: JWT empty fallback, CORS open in prod, `/ready` always true, `computeEfficiencyMetric` stub, phantom `platform-core` in publish
- QAAgent hardcoded score-8 replaced with 5-dimension heuristic review
- MetaOrchestratorAgent 3 TODO stubs implemented (health checks, route optimization, monitor)
- Ethereum anchor silent null return replaced with HMAC-based local simulation
- Docker health check pointing to wrong endpoint (`/health` → `/api/v1/health`)

### Changed
- Coverage thresholds raised to 60% on atsf-core, cognigate, runtime
- CONTRIBUTING.md expanded from stub to full contributor guide
- JSDoc added to SDK, Cognigate client/types public exports
- README updated with Quick Start code example and install snippet

### Tests Added
- ai-gateway: vitest.config.ts wired (146 existing tests now discoverable)
- car-cli: 113 unit tests (commands, config, edge cases, exports)
- car-python: pytest suite (types, utils, client, init — 6 files)
- Phase 6: all 6 quarantined tests un-skipped (26/26 pass)
- council: MetaOrchestratorAgent (28 tests), QAAgent (42+ tests)
- atsf-core: Ethereum anchor (7 tests), rate-limiter (55 tests)
- runtime: intent→proof integration (20 tests)

## [0.1.3] — 2026-03-01

### Added
- Failsafe fallback chains in LiteLLM config (`default_fallbacks`, `context_window_fallbacks`)
- Local deny-by-default enforcement in Cognigate SDK when API is unreachable
- `degraded` and `fallbackReason` fields on `GatewayResponse.metadata`
- Ollama fallback in AI Gateway `chat()` catch block for primary model failures

### Changed
- Firebase SDK functions (`getFirebaseApp`, `getFirebaseDb`, `getFirebaseAuth`) return `null` instead of throwing when unconfigured
- Studio page handles null Firebase gracefully with early-return guards

## [0.1.2] — 2026-02-28

### Fixed
- Removed hardcoded API key fallback (`sk-1234`) from ai-gateway
- Removed hardcoded JWT development secret from atsf-core config
- Resolved 5 circular dependency cycles in atsf-core via type extraction
- Fixed 5 ESLint exhaustive-deps warnings in Kaizen (useCallback wrapping)
- Quarantined 6 Phase 6 tests depending on unimplemented exports (`.skip`)

### Changed
- Prettier formatting applied across all 384 source files
- Cognigate test coverage boosted from 20% to 53% (proof-bridge, webhooks tests)
- Replaced all `voriongit` references with `vorionsys` in DEPENDABOT_TRIAGE.md

### Added
- RISK-REGISTER-V1.md documenting 7 active risks and 5 resolved items
- GitHub topics added to both repos for discoverability
- GitHub Discussions enabled on vorion repo
- Homepage URLs set (vorion.org, cognigate.dev)

## [0.1.1] — 2026-02-28

### Added
- First public open-source release under Apache 2.0
- 12 packages: atsf-core, basis, contracts, cognigate, car-cli, car-client, council, proof-plane, runtime, sdk, shared-constants, ai-gateway
- Kaizen learning app (Next.js)
- Cognigate API (Python/FastAPI) at cognigate.dev
- BASIS specification v0.1
- CI pipeline: build, typecheck, lint, test, coverage gates, secret scan
- OSS governance files: LICENSE, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT

[0.1.4]: https://github.com/vorionsys/vorion/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/vorionsys/vorion/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/vorionsys/vorion/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/vorionsys/vorion/releases/tag/v0.1.1
