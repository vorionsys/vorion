# Changelog

All notable changes to `@vorionsys/contracts` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-02-17

### Changed
- Pinned internal workspace dependencies to real version ranges for npm publish

## [0.1.1] - 2026-02-16

### Added
- Comprehensive README with full API reference, usage examples, and subpath import documentation
- CHANGELOG.md for tracking version history
- Extended keywords in package.json for npm discoverability

### Changed
- Updated package.json `files` field to include README.md, CHANGELOG.md, and LICENSE instead of non-existent `schemas` directory
- Improved package.json description to mention Zod validators and TypeScript types

### Fixed
- README license section now correctly states Apache-2.0 (was incorrectly listed as MIT)

## [0.1.0] - 2026-01-15

### Added
- Initial release of `@vorionsys/contracts`
- v2 contract types: Intent, Decision, FluidDecision, TrustProfile, ProofEvent, PolicyBundle
- Trust system: TrustBand (T0-T7), ObservationTier, TrustDimensions, TrustWeights, TrustDynamics
- Decision system: DecisionTier (GREEN/YELLOW/RED), RefinementAction, WorkflowState, FluidDecision
- ATSF v2.0 types: CanaryProbe, CanaryCategory, PreActionGate, RiskLevel, GateVerification
- ERPL compliance types: Evidence and Retention contracts
- Canonical agent types with Zod schemas: AgentConfig, AgentTask, AgentLifecycleStatus, AgentRuntimeStatus, AgentPermission, AgentSpecialization, AgentCapability
- Canonical governance module: trust bands, trust scores, risk levels, trust signals, middleware types
- CAR (Categorical Agentic Registry): parseCAR/generateCAR, CapabilityLevel (L0-L7), CertificationTier, RuntimeTier, attestations, JWT claims, effective permissions, domain/skill bitmasks
- Validators module: Zod schemas for Intent, Decision, TrustProfile, ProofEvent with utility functions (validate, safeValidate, formatValidationErrors)
- Common primitives: UUIDSchema, SemVerSchema, TimestampSchema, HashSchema, ActorSchema, TrustBandSchema, AutonomyLevelSchema
- Feature flag registry: FLAGS constant, FLAG_METADATA, isFeatureEnabled, getEnabledFeatures, getFlagsByCategory, getFlagsByPhase
- Database schemas: Drizzle ORM table definitions for agents, tenants, attestations, proofs, and more
- ACI module (deprecated alias for CAR, backwards compatibility)
- Subpath exports for granular imports: /common, /v2, /validators, /car, /aci, /canonical, /db
