# Vorion Package Ecosystem

Single source of truth for how all packages relate — types, exports, dependencies, and integration rules.

## Dependency Graph

```
FOUNDATION (no internal deps)
├── @vorionsys/shared-constants   Trust tiers, domains, products, error codes
├── @vorionsys/basis              Open governance standard (trust factors, capabilities)
└── @vorionsys/contracts          Zod schemas, v2 contracts, feature flags

SERVICE LAYER (depends on foundation)
├── @vorionsys/cognigate          → shared-constants
├── @vorionsys/atsf-core          → contracts
├── @vorionsys/proof-plane        → contracts
├── @vorionsys/platform-core      → contracts
├── @vorionsys/runtime            → shared-constants  (peer: atsf-core, contracts)
├── @vorionsys/ai-gateway         → (peer: contracts)
├── @vorion/security              → contracts
└── @vorion/a3i                   → contracts

SDK LAYER (depends on service)
├── @vorionsys/sdk                → (peer: runtime)
├── @vorionsys/agent-sdk          → (standalone)
├── @vorionsys/agentanchor-sdk    → (standalone)
├── @vorionsys/council            → ai-gateway
├── @vorion/car-client            → (standalone)
└── @vorion/car-cli               → car-client
```

## Package Inventory

| Package | Version | Published | Category | Key Exports |
|---------|---------|-----------|----------|-------------|
| @vorionsys/shared-constants | 1.0.1 | npm | Foundation | TrustTier, TIER_THRESHOLDS, scoreToTier, domains, products, errorCodes, apiVersions |
| @vorionsys/basis | 1.0.1 | npm | Foundation | TrustFactors, TrustCapabilities, KYA |
| @vorionsys/contracts | 1.0.0 | npm | Foundation | v2 contracts (Zod), canonical validation, db schemas, feature flags |
| @vorionsys/cognigate | 1.0.1 | npm | Service | Cognigate client, TrustTier, GovernanceResult, WebhookRouter |
| @vorionsys/atsf-core | 1.0.0 | npm | Service | RuleEvaluator, IntentService, EnforcementService, TrustEngine, GovernanceEngine |
| @vorionsys/proof-plane | 1.0.0 | npm | Service | ProofPlane, ProofEventStore, HashChain, EventSignatures |
| @vorionsys/car-spec | 1.1.0 | npm | Standard | OpenAPI spec for CAR Trust Engine |
| @vorionsys/platform-core | 0.1.0 | internal | Service | intent, enforce, cognigate, proof, trust-engine, governance, security, a2a |
| @vorionsys/runtime | 0.1.1 | internal | Service | TrustFacade, ProofCommitter, IntentPipeline, SQLite stores |
| @vorionsys/ai-gateway | 0.1.0 | internal | Service | AIGateway, CircuitBreaker, RetryHandler, QuotaManager |
| @vorion/security | 1.0.0 | internal | Service | WebAuthn, MFA, SSO, SIEM, crypto, HSM, KMS, ZKP, DLP |
| @vorion/a3i | 0.1.0 | internal | Service | Trust banding, authorization, execution hooks, orchestrator |
| @vorionsys/sdk | 0.1.1 | internal | SDK | Vorion class, Agent class, createVorion |
| @vorionsys/agent-sdk | 0.1.0 | internal | SDK | AuraisAgent, WebSocket events |
| @vorionsys/agentanchor-sdk | 0.1.0 | internal | SDK | AgentAnchor client, CAR utils |
| @vorionsys/council | 0.1.0 | internal | SDK | CouncilOrchestrator, 16 governance agents |
| @vorion/car-client | 1.0.0 | internal | SDK | CARClient, Phase6Stats |
| @vorion/car-cli | 1.0.0 | internal | SDK | CLI wrapper for car-client |

## Type Authority Map

These rules prevent duplicate/conflicting type definitions across the ecosystem.

| Type / Constant | Source of Truth | Used By | Rule |
|----------------|-----------------|---------|------|
| **TrustTier** (T0–T7 enum) | `shared-constants` | cognigate, runtime, sdk, car-client | Always import from shared-constants. Never redefine. |
| **TIER_THRESHOLDS** | `shared-constants` | runtime, cognigate | Score ranges for each tier. Single definition. |
| **scoreToTier()** | `shared-constants` | runtime | Only trust score → tier. platform-core's riskScoreToTier is separate. |
| **TrustFactors** (12 dims) | `basis` | atsf-core, council | Dimension weights and definitions. |
| **TrustCapabilities** | `basis` | atsf-core, platform-core | What each tier can do. |
| **v2 API Contracts** (Zod) | `contracts` | atsf-core, platform-core, proof-plane, security | Request/response schemas. Never duplicate. |
| **ErrorCodes** | `shared-constants` | all packages | Canonical error code registry (E1xxx–E5xxx). |
| **Domains / URLs** | `shared-constants` | all apps/sites | Single registry. No hardcoded URLs in packages. |
| **Products** | `shared-constants` | ecosystem-status.ts, sites | Product metadata registry. |
| **API Versions** | `shared-constants` | car-client, cognigate | Version lifecycle tracking. |
| **CARClient** | `car-client` | car-cli | CAR API client. car-cli is a thin CLI wrapper. |
| **GovernanceResult** | `cognigate` | platform-core (as enforce.Decision) | Policy decision outcome. |
| **ProofPlane** | `proof-plane` | runtime, platform-core | Immutable audit trail interface. |
| **AIGateway** | `ai-gateway` | council | Multi-provider AI routing. |

## Conflict Resolution Rules

1. **TrustTier**: The canonical definition lives in `@vorionsys/shared-constants`. Packages that need TrustTier should import it, not define their own enum. If car-client or cognigate define a local `TrustTier`, it must be a re-export or alias of `shared-constants`.

2. **Zod Schemas**: All shared API schemas live in `@vorionsys/contracts`. No package should define its own version of a schema that already exists in contracts. Package-specific request/response types can extend contracts schemas.

3. **Score Functions**: `scoreToTier()` from `shared-constants` maps trust scores (0–1000) to tiers (T0–T7). The `riskScoreToTier()` in `platform-core` is a different function for risk assessment — not a duplicate.

4. **Domain URLs**: All domain URLs come from `shared-constants/domains.ts`. No package or app should hardcode `vorion.org`, `agentanchorai.com`, etc. Import from the constant.

5. **Namespace Conflicts**: `platform-core` uses module namespacing (`enforce.*`, `governance.*`, `a2a.*`) to avoid global name collisions. Other mega-packages should follow this pattern.

## External Dependency Alignment

Shared external dependencies should use consistent versions to prevent runtime conflicts.

| Dependency | Recommended | Notes |
|-----------|-------------|-------|
| zod | ^3.24.1 | Schema validation — used by 10 packages |
| typescript | ^5.7.3 | Compile target — all packages |
| pino | ^9.0.0 | Logging — standardize on v9 (some still on v8) |
| uuid | ^11.0.0 | ID generation — standardize on v11 (some still on v9) |
| fastify | ^5.0.0 | HTTP framework — already consistent |
| @types/node | ^22.10.5 | Node types — all packages |

## Integration Matrix

How the stack connects end-to-end:

```
User Request → AgentAnchor Platform (app.agentanchorai.com)
    │
    ├── agent-sdk / agentanchor-sdk ─── WebSocket ──→ Agent Runtime
    │
    ├── car-client ─── REST ──→ CAR Registry (carid.vorion.org)
    │       └── Resolves CAR ID → agent identity + trust tier
    │
    ├── cognigate ─── REST ──→ Cognigate API (cognigate.dev)
    │       ├── Evaluates policy rules (Logic Engine)
    │       ├── Returns ALLOW / DENY / ESCALATE
    │       └── Logs decision to proof-plane
    │
    ├── atsf-core ─── local ──→ Trust Engine
    │       ├── Calculates trust score from behavioral signals
    │       ├── Applies decay and recovery
    │       └── Reads tier thresholds from shared-constants
    │
    └── proof-plane ─── local ──→ Audit Trail
            ├── Immutable event log (hash chain)
            ├── Decision provenance
            └── Compliance export (EU AI Act, ISO 42001)
```

## Known Issues & Action Items

- [ ] `car-client` defines its own TrustTier — should re-export from shared-constants
- [ ] `cognigate` defines its own TrustTier — should re-export from shared-constants
- [ ] pino version — standardize on ^9.0.0 across atsf-core, runtime, sdk, platform-core
- [ ] uuid version — standardize on ^11.0.0 across a3i, proof-plane, security, platform-core
- [ ] `car-cli` is a thin wrapper — evaluate merging into car-client as a subcommand
- [ ] `platform-core` is a mega-package (15+ submodules) — consider splitting as it matures
- [ ] Some packages reference `@vorion/*` while others use `@vorionsys/*` — consolidate namespace

## Narrative: How the Stack Fits Together

> **BASIS** sets the rules. **CAR** identifies the agent. **Cognigate** enforces the decisions.
> **PROOF** keeps the receipts. **ATSF** calculates the trust. **Council** orchestrates the agents.

| Layer | Package | One-liner |
|-------|---------|-----------|
| Standard | basis | "What good AI governance looks like" |
| Identity | car-client, car-spec | "Who is this agent and what can it do" |
| Trust | shared-constants, atsf-core | "How much do we trust this agent right now" |
| Policy | cognigate | "Is this action allowed under current rules" |
| Audit | proof-plane | "Immutable record of every decision" |
| Orchestration | council | "Coordinate multiple agents with governance" |
| Platform | sdk, runtime | "Developer interface to the whole stack" |
| Security | security | "Enterprise auth, encryption, compliance" |
