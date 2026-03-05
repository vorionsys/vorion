## [0.1.0](https://github.com/vorion/vorion/compare/v0.1.7...v0.1.0) (2026-03-05)

### Bug Fixes

* **readme:** correct clone URL, import scope, support email ([a150dc1](https://github.com/vorion/vorion/commit/a150dc1418bfe5defd953f5361f0b3d4f413c719))

## [0.1.7](https://github.com/vorion/vorion/compare/v0.1.6...v0.1.7) (2026-03-05)

### Features

* **a3i:** NIST compliance test suite + trust pipeline hardening ([b690437](https://github.com/vorion/vorion/commit/b690437e07bf4708256b1cf72d89c5093b213f47))
* **basis:** AccountabilitySignalCallback + bump 1.0.4 -> 1.0.5 ([b86eec8](https://github.com/vorion/vorion/commit/b86eec8844b3e1e7ea1ff0dfeb2ccb1085c05fd2))

## [0.1.6](https://github.com/vorion/vorion/compare/v0.1.5...v0.1.6) (2026-03-04)

### Features

* **a3i+basis:** wire KYA accountability chain to TrustSignalPipeline ([f74c04e](https://github.com/vorion/vorion/commit/f74c04eade0135c03576eed5ea59a7a0ee4d5c3c))
* **a3i:** signal pipeline, trust dynamics, extended canary probes ([e438f9a](https://github.com/vorion/vorion/commit/e438f9a0014f3e4df5ef58e87196c43f482cfa6d))
* **a3i:** wire TrustSignalPipeline into Gate and Orchestrator ([ee35c1b](https://github.com/vorion/vorion/commit/ee35c1bae737263e5ca717b4fe47f5f6ecd36528))
* **tools:** add Python-based OSCAL structural validation script ([335a66d](https://github.com/vorion/vorion/commit/335a66dcfa60ba31a9a5089d30d77d714211fdda))

### Bug Fixes

* **examples:** crewai handleTaskError arg order + merge duplicate imports ([4c01640](https://github.com/vorion/vorion/commit/4c01640eb83c190157ead9b99f37c43990a96988))
* **tests:** resolve 52 failing TS tests across 5 test files ([3c513b9](https://github.com/vorion/vorion/commit/3c513b948532283449fb835cc76740053557a687))
* **tools:** make fill-registry-gap.py fully idempotent ([392bb4d](https://github.com/vorion/vorion/commit/392bb4db1960b21180dc122e392790883b158ed1))

## [0.1.5](https://github.com/vorion/vorion/compare/v0.1.2...v0.1.5) (2026-03-02)

### Features

* add failsafe fallbacks across gateway, cognigate, and firebase ([aeec67e](https://github.com/vorion/vorion/commit/aeec67eea9ea7ce54ba9b539d5733c4497c713ad))
* **atsf-core:** canonical 8-tier trust model + explainScore + robustness hardening ([d850fed](https://github.com/vorion/vorion/commit/d850fed5bd62bc59b06fb69acc0493b3b19963a6))
* degraded-mode metrics, vLLM sidecar, CHANGELOG v0.1.3 ([d573307](https://github.com/vorion/vorion/commit/d573307c63d0afd057befb165663168567dd73fb))
* resolve all P3 items — monitoring, benchmarks, tracing, load testing, automation ([de85abe](https://github.com/vorion/vorion/commit/de85abe07f38828b4d4ff34253e6e104734f405e))
* **www:** add interactive ATSF Trust Calculator at /calculator ([13bd2b9](https://github.com/vorion/vorion/commit/13bd2b9fea0c9ed544223db8c1ea10ac5e30d715))

### Bug Fixes

* **atsf-core:** provide test JWT secret for api-server tests ([bc2c69d](https://github.com/vorion/vorion/commit/bc2c69defe478c0d64f047fce5e24b0c08cd982a))
* remove private vorion-www files from public repo ([5c23b9f](https://github.com/vorion/vorion/commit/5c23b9f69fecd68fd1c996f718d44e26c8f5fbfc))
* resolve 5 P0 critical issues + un-skip Phase 6 tests + add dependabot ([ad0a140](https://github.com/vorion/vorion/commit/ad0a14003aa8baf2df10840956c2a4a8b625d8fd))
* resolve all P1 issues — tests, stubs, coverage thresholds, Ethereum anchor ([1106f73](https://github.com/vorion/vorion/commit/1106f73430062833fcbaa32a8bd81b1da4d7814a))

## [0.1.2](https://github.com/vorion/vorion/compare/v0.1.1...v0.1.2) (2026-02-28)

### Features

* **atsf-core:** A4/A5 — Wave 1 API docs, deprecation policy, integration smoke tests ([35a306f](https://github.com/vorion/vorion/commit/35a306f55d6c74bff441c752339ba3d3deb6f913))

## [0.1.1](https://github.com/vorion/vorion/compare/0b60624f1f1e9fc7ac9a037a04c3e41f6c912b17...v0.1.1) (2026-02-28)

### Features

* **atsf-core:** add intent-gateway for jurisdiction-aware governance ([3978b93](https://github.com/vorion/vorion/commit/3978b939aa801e6771a7881b6ddb890213ff45a9))
* initialize Vorion open-source monorepo ([0b60624](https://github.com/vorion/vorion/commit/0b60624f1f1e9fc7ac9a037a04c3e41f6c912b17))
* **platform-core:** add CIDR notation support to RBAC policy engine ([692a50f](https://github.com/vorion/vorion/commit/692a50ff3c0ecc42797778113665ae4beaa933f1))
* upgrade intent routes with canonical classification and wire PolicyEngine ([9c635c3](https://github.com/vorion/vorion/commit/9c635c32c849f9d1c2d60e541e0c927c3b526cad))

### Bug Fixes

* add missing .js extensions to ESM imports across all packages ([21f1791](https://github.com/vorion/vorion/commit/21f17917af0aa1fa34070f62bac9c68fd87d3fc7))
* **basis:** add .js extensions to ESM imports ([430695e](https://github.com/vorion/vorion/commit/430695ef7db57ab3185dfb5e45d822d34d70cf01))
* **basis:** complete ESM .js extension fix and bump to 1.0.3 ([a72cf5a](https://github.com/vorion/vorion/commit/a72cf5a9071de8b22fdd69ab742c9d7cca14088d))
* clean up redundant type union and stale section headers ([08c63cb](https://github.com/vorion/vorion/commit/08c63cb9e1c712bb271260cfb0d615f09d5061a0))
* rename stale @vorion/ references to @vorionsys/ across docs and metadata ([81d8b0f](https://github.com/vorion/vorion/commit/81d8b0f8f5cc2537d66840e4ccf9884a805b51d4))
* replace proprietary license with Apache-2.0 ([282002d](https://github.com/vorion/vorion/commit/282002d56002f557d76a983fa92cff547599973e))
