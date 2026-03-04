
## [0.1.6](https://github.com/vorionsys/vorion/compare/v0.1.5...main) (2026-03-04)

**Package bumps:** `@vorion/a3i` 0.1.0 → 0.1.1 · `@vorionsys/basis` 1.0.4 → 1.0.5

### Features
- **a3i 0.1.1**: Wire `TrustSignalPipeline` into `PreActionGate` and `Orchestrator` — gate rejections emit `OP-ALIGN` negative signals; execution outcomes emit `CT-COMP` signals (success/failure with methodologyKey). `OrchestratorBuilder.withPipeline()` added. New E2E integration tests cover full lifecycle, circuit breaker trip, degraded state, methodology repeat-failure detection, and two-engine feedback loop. 17 new tests (3 gate + 3 orchestrator + 11 E2E), 74 total in affected files.
- **a3i 0.1.1 + basis 1.0.5**: Wire `KYA AccountabilityChain` to `TrustSignalPipeline` via injected `AccountabilitySignalCallback`; every accountability record now propagates a `CT-ACCT` trust signal through the fast+slow pipeline lanes without a basis→a3i upward dependency. New `createKYAWithPipeline()` factory in `packages/a3i/src/kya/`. 8 test cases (kya-pipeline.test.ts).
- **a3i 0.1.1**: `POST /api/v1/trust/signal` — new `processSignal` handler registered in A3I API routes.
- **a3i 0.1.1**: `TrustSignalPipeline`, `TrustDynamicsEngine`, extended canary probes.
- **tools**: `validate-oscal-ssp.py` — Python-based OSCAL structural validator for all 4 artifacts (SSP, component-definition, assessment-plan, POA&M), no Java/CLI required.

### Bug Fixes
- **tools**: `fill-registry-gap.py` fully idempotent — 4 bugs resolved (anchor truncation, variable-before-definition, early-exit when gap=0, `NoneType` in `get_reg_controls`).
- **tests**: Resolve 52 failing TypeScript tests across 5 test files.

### Compliance & Documentation
- **NIST CAISI RFI**: v2.2 finalized, ready for submission to regulations.gov Docket NIST-2025-0035 (deadline: March 9, 2026).
- **OSCAL SSP**: 370 implemented NIST SP 800-53 controls (prior: 131); all 4 artifacts pass structural validation.
- **NIST engagement**: Drafted 5 submissions — RFI, 3 CAISI listening session one-pagers (Finance/Healthcare/Education), NCCoE Agent Identity concept paper (April 2).
- **Test count**: `@vorion/a3i` 418+ · Total: 9,757 TS + 692 Python = 10,449

---

## [0.1.5](https://github.com/vorionsys/vorion) (2026-02-xx)

Wave 3 — Phase 6 tests (149), coverage floors, LangChain/CrewAI/AutoGen examples.

---

## [0.1.4](https://github.com/vorionsys/vorion) (2026-02-xx)

Interactive ATSF Trust Calculator at `/calculator`; canonical 8-tier trust model; explainScore; robustness hardening.

---

## [0.1.3](https://github.com/vorionsys/vorion) (2026-01-xx)

Degraded-mode metrics, vLLM sidecar, monitoring.

---

## [0.1.2](https://github.com/vorionsys/vorion) (2026-01-xx)

Move internal planning docs to private repo; launch hardening.

---

## [0.1.1](https://github.com/vorionsys/vorion) (2026-01-xx)

Humble README rewrite, BASIS spec v0.1, transparent roadmap.

---

## [0.1.0](https://github.com/vorion/vorion/compare/8462956a7b12c90c56820fb5fd5f110f19b37bc8...v0.1.0) (2026-01-12)

### Features

* add basis-core open standard to monorepo ([d2083d7](https://github.com/vorion/vorion/commit/d2083d7533015e99b8d9ff08536aa078f4021ceb))
* add BMAD config, architecture docs, and base tsconfig ([c722881](https://github.com/vorion/vorion/commit/c72288182153c9c08711269f22de40e2dba14b75))
* add cognigate-api to monorepo ([6a72264](https://github.com/vorion/vorion/commit/6a7226495bcaa0798b5fcc686c46f3cefc790847))
* add comprehensive CI/CD pipeline for monorepo ([d7f3cd3](https://github.com/vorion/vorion/commit/d7f3cd34671459961c968c779f676e7047c52a9a))
* add docs folder to monorepo ([f0a31fc](https://github.com/vorion/vorion/commit/f0a31fc53b9087bef52cfbdbad11435adbef0f88))
* add omniscience learning platform to monorepo ([14802ce](https://github.com/vorion/vorion/commit/14802ce25eceb07c88cba892fe35e9fda771b4dc))
* add omniscience-docs to monorepo ([b2ad722](https://github.com/vorion/vorion/commit/b2ad72225696d22ed34ba6d2e83ab1b1f8294cd6))
* add shared packages to monorepo ([68070ea](https://github.com/vorion/vorion/commit/68070eaf1e6185be512427143c28a67f64d38297))
* add vorion-www corporate website to monorepo ([789d69b](https://github.com/vorion/vorion/commit/789d69bf24604856df6140c36f043b7cd3dd55af))
* configure Turborepo build pipelines ([23b7f8b](https://github.com/vorion/vorion/commit/23b7f8b76e6f81afd365bfd10c24fab422ecd57e))
* consolidate AgentAnchor apps into Axiom monorepo with type fixes ([8462956](https://github.com/vorion/vorion/commit/8462956a7b12c90c56820fb5fd5f110f19b37bc8))

### Bug Fixes

* update @orion/contracts imports to @vorion/contracts ([3d7db7d](https://github.com/vorion/vorion/commit/3d7db7d04df84144f3c68b51fffcb639e3ad6452))
