# Changelog

All notable changes to `@vorionsys/cognigate` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-02-17

### Changed
- Standardized package metadata for npm publish

## [1.0.1] - 2026-02-11

### Added

- Proof Bridge sub-export (`@vorionsys/cognigate/proof-bridge`) for forwarding governance decisions to the Vorion Proof Plane as `DECISION_MADE` audit records.
- `ProofPlaneEmitter` structural interface for decoupled Proof Plane integration.

### Fixed

- Zod schema coercion for `Date` fields now uses `z.coerce.date()` to correctly parse ISO-8601 strings from the API.

## [1.0.0] - 2026-02-08

### Added

- Initial release of the Cognigate TypeScript SDK.
- `Cognigate` client class with four sub-clients: `agents`, `trust`, `governance`, `proofs`.
- **Agents**: `list`, `get`, `create`, `update`, `delete`, `pause`, `resume`.
- **Trust**: `getStatus`, `getHistory`, `submitOutcome`.
- **Governance**: `parseIntent`, `enforce`, `evaluate` (combined parse+enforce), `canPerform`.
- **Proofs**: `get`, `list`, `getStats`, `verify` (hash-chain integrity verification).
- `CognigateError` class with `code`, `status`, and `details` properties.
- Automatic retry with exponential backoff for server errors (5xx).
- `WebhookRouter` with typed event handlers and Express middleware.
- `verifyWebhookSignature` and `parseWebhookPayload` utilities using HMAC-SHA256 with timing-safe comparison.
- `TrustTier` enum and `TIER_THRESHOLDS` constants implementing the BASIS (Baseline Authority for Safe & Interoperable Systems) trust-tier specification.
- Static helpers: `Cognigate.getTierFromScore()`, `Cognigate.getTierName()`, `Cognigate.getTierThresholds()`.
- Zod runtime validation schemas: `TrustStatusSchema`, `GovernanceResultSchema`, `ProofRecordSchema`, `AgentSchema`.
- Full TypeScript type exports for all API request/response shapes.
- Dual ESM/CJS output via tsup.

[1.0.1]: https://github.com/voriongit/vorion/compare/@vorionsys/cognigate@1.0.0...@vorionsys/cognigate@1.0.1
[1.0.0]: https://github.com/voriongit/vorion/releases/tag/@vorionsys/cognigate@1.0.0
