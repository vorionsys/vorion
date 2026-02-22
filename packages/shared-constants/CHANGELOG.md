# Changelog

All notable changes to `@vorionsys/shared-constants` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-02-17

### Fixed
- Build command no longer includes test files in dist output (removed ~632 KB of vitest chunks from tarball)

## [1.0.1] - 2026-02-14

### Fixed
- Canonical trust tier alignment: T0=Sandbox, T1=Observed, T2 max=499, T3 min=500
- Broken link fixes in documentation references

### Changed
- Standardized package metadata and README for npm publish readiness
- Aligned license to Apache-2.0 across all packages

## [1.0.0] - 2026-02-04

### Added
- **Trust Tiers**: Complete 8-tier model (T0 Sandbox through T7 Autonomous) with score ranges, names, descriptions, colors, and helper functions (`scoreToTier`, `getTierName`, `getTierColor`, `meetsTierRequirement`, `parseTier`, etc.)
- **Domains**: All Vorion, Agent Anchor, and Cognigate domain constants, API endpoints (production/staging/sandbox), email addresses, GitHub URLs, npm package names, and domain aliases
- **Capabilities**: 20 tier-gated capability definitions across 7 categories (DATA_ACCESS, API_ACCESS, CODE_EXECUTION, AGENT_INTERACTION, RESOURCE_MANAGEMENT, GOVERNANCE, ADMIN) with helper functions for lookup, filtering, and availability checks
- **Products**: Full product catalog for Vorion (BASIS, CAR ID, ATSF, Kaizen, Proof Plane, Contracts) and Agent Anchor (Cognigate, Trust, Logic, Platform) with category, status, and version metadata
- **Rate Limits**: Per-tier rate-limit configurations (requests per second/minute/hour/day, burst limits, payload sizes, timeouts) and monthly quota definitions (API calls, compute units, storage, bandwidth, agents, webhooks, team members)
- **Error Codes**: Standardized error code system (E1xxx-E7xxx) spanning 7 categories (AUTH, VALIDATION, RATE_LIMIT, NOT_FOUND, TRUST, SERVER, EXTERNAL) with HTTP status codes, retry flags, documentation URLs, and message templating
- **API Versions**: Version management for Cognigate, Trust, Logic, BASIS, and CAR Spec APIs with lifecycle status tracking and version negotiation HTTP headers
- **Themes**: Unified theme system with 4 themes (Midnight Cyan, Indigo Authority, Obsidian Amber, Arctic Glass), full token definitions, and CSS custom-property generation
- Subpath imports for tree-shaking (`/tiers`, `/domains`, `/capabilities`, `/products`, `/rate-limits`, `/error-codes`, `/api-versions`, `/themes`)
- ESM and CJS dual-format builds via tsup
- Full TypeScript type exports

[1.0.1]: https://github.com/vorionsys/vorion/compare/shared-constants-v1.0.0...shared-constants-v1.0.1
[1.0.0]: https://github.com/vorionsys/vorion/releases/tag/shared-constants-v1.0.0
