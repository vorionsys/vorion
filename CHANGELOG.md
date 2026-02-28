# Changelog

All notable changes to the Vorion monorepo will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

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

[0.1.2]: https://github.com/vorionsys/vorion/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/vorionsys/vorion/releases/tag/v0.1.1
