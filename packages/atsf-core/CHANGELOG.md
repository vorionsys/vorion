# Changelog

All notable changes to `@vorionsys/atsf-core` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-02-17

### Changed
- Pinned `@vorionsys/contracts` dependency to `^0.1.1` (was wildcard)
- Synced VERSION constant to 0.2.2

## [0.2.1] - 2026-02-16

### Changed
- Updated README.md with comprehensive documentation for npm publication
- Updated package.json with expanded keywords, `files` field, and `bugs` field for npm discoverability

### Fixed
- License reference in README corrected from MIT to Apache-2.0

## [0.2.0] - 2026-02-01

### Added
- **Phase 6 Trust Engine Hardening** (`createPhase6TrustEngine`) with advanced configuration
- **Sandbox Adversarial Training** boot camp module for testing agent resilience
- **Trust Recovery Mechanics** with accelerated recovery, consecutive success tracking, and recovery milestones
- **Event Subscription Limits** to prevent wildcard listener overhead on TrustEngine
- Recovery-related events: `trust:recovery_applied`, `trust:recovery_milestone`
- `getConsecutiveSuccessCount()`, `getPeakScore()`, `isAcceleratedRecoveryActive()` methods on TrustEngine
- `getListenerStats()` for monitoring event subscription usage
- Supabase persistence provider
- Decision Provenance (DPO) tracking module
- Multi-agent trust arbitration module
- Progressive containment protocols
- Output contracts (VorionResponse) module

### Changed
- Trust model upgraded from 6 tiers to **8 tiers (T0-T7)** per BASIS specification
- Trust thresholds updated: T5 Trusted (800-875), T6 Certified (876-950), T7 Autonomous (951-1000)
- TrustRecord now tracks `recentSuccesses`, `peakScore`, and `consecutiveSuccesses`
- Signal source and metadata fields made optional for backwards compatibility

## [0.1.0] - 2025-12-15

### Added
- **Trust Engine** with 0-1000 scoring, time-based decay, and accelerated decay on failure
- **BASIS Rule Engine** for constraint evaluation and governance policies
- **Intent Service** for submitting and tracking agent intents
- **Enforcement Service** as a policy decision point (allow/deny/escalate)
- **Proof Service** with immutable SHA-256 audit chain and Merkle proofs
- **Cognigate Runtime** for constrained execution with resource limits
- **Chain Module** for blockchain anchoring on Polygon networks
- **Governance Engine** with rule-based authority evaluation
- **Fluid Workflow Engine** for decision workflow orchestration
- **Security Pipeline** orchestrating L0-L46 typed security layers
- **Persistence Layer** with memory and file-based providers
- **LangChain Integration** with trust-aware executor, callback handler, and trust tools
- Trust event emission system with wildcard support
- Typed error classes: `VorionError`, `TrustInsufficientError`, `ConstraintViolationError`
- Fastify-based governance API server (`createServer`, `startServer`)
- Comprehensive test suite (401+ tests)

[0.2.1]: https://github.com/voriongit/vorion/compare/atsf-core-v0.2.0...atsf-core-v0.2.1
[0.2.0]: https://github.com/voriongit/vorion/compare/atsf-core-v0.1.0...atsf-core-v0.2.0
[0.1.0]: https://github.com/voriongit/vorion/releases/tag/atsf-core-v0.1.0
