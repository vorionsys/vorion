# Changelog

All notable changes to `@vorionsys/basis` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.4] - 2026-02-25

### Changed
- Standardized LICENSE copyright to Vorion Systems
- Added documentation link to README
- Polished README for npm publish readiness

## [1.0.3] - 2026-02-20

### Changed
- Migrated all references from vorionsys to vorionsys scope

## [1.0.2] - 2026-02-17

### Changed
- Standardized package metadata for npm publish readiness

## [1.0.1] - 2026-02-11

### Fixed
- Export validation gate module (`GateDecision`, `ValidationSeverity`, `validateAgent`, etc.) from main entry point
- Corrected `hasCapability` function signature to `(agentTier, capabilityCode)`

### Added
- Pre-built validation gates: `strictValidationGate` and `productionValidationGate`
- `createValidationGate` factory for custom gate configurations
- `isValidAgent` quick-check helper function
- Zod schemas for runtime validation of manifests and gate results

## [1.0.0] - 2026-02-08

### Added
- **Trust Factors v2.0**: 23-factor evaluation framework (15 core + 8 life-critical)
- **Trust Tiers (T0-T7)**: 8-tier progressive autonomy system with score thresholds
- **Trust Score Calculation**: Weighted scoring engine with per-tier factor thresholds and critical factor enforcement
- **Tier-Gated Capabilities**: 35 capabilities across 8 categories (Data Access, File Operations, API Access, Code Execution, Agent Interaction, Resource Management, System Administration, Governance)
- **Validation Gate**: Agent manifest validation with PASS/REJECT/ESCALATE decisions, CAR string format validation, and profile matching
- **KYA (Know Your Agent) Framework**:
  - `IdentityVerifier` -- W3C DID resolution + Ed25519 signature verification
  - `AuthorizationManager` -- Capability-based access control + policy constraint enforcement
  - `AccountabilityChain` -- Immutable hash-linked audit trail
  - `BehaviorMonitor` -- Real-time anomaly detection (rate spikes, success rate drops, suspicious resource access)
  - `KYA` orchestrator class for complete 4-step verification flow
- Full TypeScript type definitions for all interfaces and enums
- Sub-path export `@vorionsys/basis/kya` for direct KYA module access

[1.0.4]: https://github.com/vorionsys/vorion/compare/basis-v1.0.3...basis-v1.0.4
[1.0.3]: https://github.com/vorionsys/vorion/compare/basis-v1.0.2...basis-v1.0.3
[1.0.2]: https://github.com/vorionsys/vorion/compare/basis-v1.0.1...basis-v1.0.2
[1.0.1]: https://github.com/vorionsys/vorion/compare/basis-v1.0.0...basis-v1.0.1
[1.0.0]: https://github.com/vorionsys/vorion/releases/tag/basis-v1.0.0
