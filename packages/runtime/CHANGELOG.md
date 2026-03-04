# Changelog

All notable changes to `@vorionsys/runtime` will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.2] - 2026-02-17

### Changed
- Standardized package metadata for npm publish

## [0.1.1] - 2025-02-11

### Changed

- TrustFacade trust tier names and score ranges now derived from `@vorionsys/shared-constants` (single source of truth for the 8-tier trust model).
- Improved trust-facade types to export `sharedScoreToTier` from shared-constants.

### Fixed

- Gate trust cache correctly handles admission expiration checks.

## [0.1.0] - 2025-01-31

### Added

- **TrustFacade** -- Unified trust interface combining Gate Trust (admission control) and Dynamic Trust (per-action authorization).
  - `admit()` -- one-time agent registration with observation-tier-based scoring.
  - `authorize()` -- per-action authorization with <50ms latency target.
  - `fullCheck()` -- combined admission + authorization in a single call.
  - `recordSignal()` -- asymmetric trust signal processing (10:1 loss-to-gain ratio).
  - `revoke()` -- immediate agent revocation with cache invalidation.
  - Observation tiers (BLACK_BOX / GRAY_BOX / WHITE_BOX) with trust score ceilings.
  - Decision tiers (GREEN / YELLOW / RED) with tier-appropriate constraints and refinements.
- **ProofCommitter** -- Zero-latency cryptographic proof system.
  - Synchronous SHA-256 hash commitment (<1ms hot path).
  - Async Merkle-tree batching with configurable buffer size and flush interval.
  - Optional Ed25519 signing for batch integrity.
  - `InMemoryProofStore` for testing and development.
- **IntentPipeline** -- End-to-end intent orchestration.
  - Full lifecycle: Intent -> Gate Check -> Authorization -> Execution -> Proof.
  - Pluggable execution handlers per action type.
  - Automatic trust signal recording on execution outcomes.
  - Quick `check()` for authorization-only queries.
  - Built-in metrics (totalIntents, allowRate, avgProcessingTimeMs).
- **SQLiteProofStore** -- Persistent proof storage with WAL mode and prepared statements.
- **SQLiteTrustStore** -- Persistent agent trust records and signal history with WAL mode.
- **Logger** -- pino-based logger with pretty-printing in development.
- Subpath exports for tree-shakeable imports (`/trust-facade`, `/proof-committer`, `/intent-pipeline`, `/stores`).

[0.1.1]: https://github.com/voriongit/vorion/compare/@vorionsys/runtime@0.1.0...@vorionsys/runtime@0.1.1
[0.1.0]: https://github.com/voriongit/vorion/releases/tag/@vorionsys/runtime@0.1.0
