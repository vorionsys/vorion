# Changelog

All notable changes to `@vorionsys/car-client` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-16

### Added

- `CARClient` class with full Phase 6 Trust Engine API coverage
- `createCARClient()` and `createLocalCARClient()` factory functions
- **Q1 Ceiling Enforcement**: `checkCeiling()`, `getCeilingEvents()` -- dual-layer trust ceilings with regulatory compliance (EU AI Act, NIST AI RMF, ISO 42001)
- **Q2 Hierarchical Context**: `getContextHierarchy()`, `getDeployments()`, `getOrganizations()`, `getAgents()`, `getOperations()`, `createDeployment()` -- 4-tier immutable context management
- **Q3 Role Gates**: `evaluateRoleGate()`, `getRoleGateEvaluations()` -- 3-layer evaluation (Kernel, Policy, BASIS)
- **Q4 Federated Presets**: `getPresetHierarchy()`, `getCARPresets()`, `getVorionPresets()`, `getAxiomPresets()`, `verifyPresetLineage()` -- CAR > Vorion > Axiom derivation chains
- **Q5 Provenance**: `createProvenance()`, `getProvenance()` -- immutable agent origin tracking with trust score modifiers
- Gaming detection alerts: `getGamingAlerts()`, `createGamingAlert()`, `updateGamingAlertStatus()`
- `CARError` class with `isClientError()`, `isServerError()`, `isTimeout()`, `isStatus()` helpers
- Utility functions: `getTierFromScore()`, `isRoleAllowedForTier()`
- Exported constants: `TRUST_TIER_RANGES`, `TRUST_TIER_LABELS`, `AGENT_ROLE_LABELS`, `DEFAULT_PROVENANCE_MODIFIERS`, `REGULATORY_CEILINGS`
- Zod schemas for runtime validation of all request types
- Full TypeScript type exports for all API interfaces
- Backwards-compatible aliases (`ACIClient`, `ACIError`, `createACIClient`, `createLocalACIClient`)
