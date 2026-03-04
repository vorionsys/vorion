---
project_name: 'Vorion Platform'
user_name: 'Racas'
date: '2026-02-27'
sections_completed: ['overview', 'technology_stack', 'workspace_structure', 'naming_conventions', 'critical_rules', 'sprint_a', 'import_direction', 'feature_flags', 'migration_status', 'phase4_gate', 'npm_publishing', 'testing_maturity', 'ip_protections']
status: 'active'
rule_count: 58
optimized_for_llm: true
current_sprint: 'Pre-Launch — IP Lockdown + OSS Prep'
architecture_doc: '_bmad-output/planning-artifacts/architecture.md'
---

# Project Context for AI Agents

_Critical rules and patterns for working in the Vorion Platform monorepo. Focus on unobvious details that agents might miss._

> **SOURCE OF TRUTH:** The authoritative architecture is defined in `_bmad-output/planning-artifacts/architecture.md`. This file summarizes key points for quick reference.

---

## Project Overview

**Vorion** is an AI Governance Platform providing trust scoring, policy enforcement, and audit trails for AI agents. The monorepo contains:

- **BASIS** - Open governance standard (CC BY 4.0)
- **AgentAnchor** - B2B marketplace for governed AI agents
- **Cognigate** - Developer runtime for constrained AI execution
- **Kaizen** - Learning platform for AI governance
- **TrustBot/Aurais** - Governance demonstration platform

### Live Deployments

| Site | URL | Source |
|------|-----|--------|
| AgentAnchor App | app.agentanchorai.com | apps/agentanchor |
| AgentAnchor WWW | agentanchorai.com | apps/agentanchor-www |
| BASIS Docs | basis.vorion.org | docs/basis-docs |
| Vorion Corporate | vorion.org | vorion-www |
| Kaizen | learn.vorion.org | kaizen |
| Cognigate | cognigate.dev | cognigate-api (Python FastAPI) |
| Status | status.agentanchorai.com | monitoring |
| npm Org | npmjs.com/org/vorionsys | 11 packages published |
| GitHub Public | github.com/vorionsys | vorion + cognigate repos |

---

## Technology Stack & Versions

### Core Technologies

| Technology | Version | Notes |
|------------|---------|-------|
| TypeScript | ^5.x | Strict mode enabled across all packages |
| Node.js | 20+ | ES2022 target |
| React | 18-19 | Functional components only |
| Next.js | 14-16 | App Router preferred |
| Tailwind CSS | 3-4 | Utility-first styling |
| Turborepo | Latest | Monorepo orchestration |

### Backend Technologies

| Technology | Version | Notes |
|------------|---------|-------|
| Fastify | 4-5 | API framework (legacy in src/) |
| Hono | ^4.x | Lightweight HTTP (packages/) |
| Drizzle ORM | Latest | Type-safe database |
| Zod | Latest | Schema validation everywhere |

### Databases

| Service | Usage |
|---------|-------|
| Neon PostgreSQL | Primary database (serverless) |
| Supabase | Auth + Realtime + PostgREST |
| Redis (Upstash) | Caching + Rate limiting |

### AI Integration

| Provider | Usage |
|----------|-------|
| Anthropic Claude | Primary AI (agent building, governance) |
| OpenAI | Fallback + Whisper (voice) |

---

## Workspace Structure (Updated 2026-02-02)

> **MIGRATION IN PROGRESS:** `/src/` is being migrated to `packages/platform-core/`. See Migration Status section.

### Why This Structure

The monorepo uses a **dependency direction rule**: `contracts ← packages ← apps`

- **contracts** defines types (the "instruction manual")
- **platform-core** implements logic (the "brick set")
- **apps** consume packages (the "finished models")

This enables semantic versioning, making breaking changes visible to AI agents.

### Current Structure (Pre-Migration)

```
vorion/
├── apps/                    # Frontend applications
│   ├── agentanchor/         # B2B platform (Next.js 14)
│   └── agentanchor-www/     # Marketing site (Next.js 16)
│
├── packages/                # Shared libraries
│   ├── contracts/           # Shared schemas (@vorionsys/contracts)
│   ├── atsf-core/           # Trust scoring SDK (@vorionsys/atsf-core)
│   ├── a3i/                 # AI utilities + Trust Calculator (@vorionsys/a3i)
│   ├── proof-plane/         # Proof event system (@vorionsys/proof-plane)
│   └── orion/               # Legacy proof plane (@vorionsys/orion)
│
├── ~~src/~~                 # ❌ DEPRECATED - Being migrated to platform-core
│   ├── api/                 # Fastify API server
│   ├── basis/               # Rule engine
│   ├── enforce/             # Policy decisions
│   ├── intent/              # Intent parsing
│   ├── proof/               # Evidence chain
│   └── trust-engine/        # Trust scoring
│
├── _bmad/                   # BMAD methodology framework
├── _bmad-output/            # Generated planning artifacts
└── docs/                    # Documentation hub
```

### Target Structure (Post-Migration)

```
vorion/
├── apps/
│   ├── agentanchor/           # PRIMARY: B2B Portal
│   ├── bai-cc-dashboard/      # SATELLITE: Public Dashboard
│   └── ...
│
├── packages/
│   ├── contracts/             # FOUNDATION - Types & Schemas
│   │   └── src/
│   │       ├── db/            # DB schemas (from /src/db/schema/)
│   │       └── flags.ts       # Feature flags (centralized)
│   │
│   ├── platform-core/         # BUSINESS LOGIC (from /src/)
│   │   └── src/
│   │       ├── trust-engine/
│   │       ├── enforce/
│   │       ├── proof/
│   │       └── db/client.ts   # DB connection
│   │
│   ├── react/                 # Shared React hooks (@vorionsys/react)
│   └── sdks/                  # Client SDKs
│       ├── typescript/        # @vorionsys/sdk
│       ├── python/            # vorion-sdk (PyPI)
│       └── go/                # vorion-go
│
├── tests/integration/         # Cross-package tests
└── docs/
    ├── STRUCTURE.md           # AI Agent canonical paths
    └── QUICKSTART.md          # 5-minute onboarding
```

### Import Path Migration

| Old Import | New Import |
|------------|------------|
| `../../src/trust-engine/` | `@vorionsys/platform-core/trust-engine` |
| `../../src/db/schema/` | `@vorionsys/contracts/db` |
| `../../src/enforce/` | `@vorionsys/platform-core/enforce` |
| `../../src/proof/` | `@vorionsys/platform-core/proof` |

### Legacy Code Warning

**CRITICAL:** Existing code still uses `/src/` imports. When implementing new features:
1. **DO NOT copy** import patterns from existing files
2. **USE** `@vorionsys/platform-core` for all new code (after migration)
3. **CHECK** the architecture document for canonical paths
4. **AFTER migration:** Run `npm run build` to verify imports

---

## Import Direction Rules (CRITICAL)

> **ENFORCED BY CI:** These rules are checked by ESLint and will fail builds.

### Dependency Flow

```
packages/contracts  ←  packages/*  ←  apps/*
     ↑                     ↑              ↑
FOUNDATION           SHARED LOGIC    APPLICATIONS
```

### What This Means

| From | Can Import | Cannot Import |
|------|------------|---------------|
| `apps/*` | `@vorionsys/platform-core`, `@vorionsys/contracts`, `@vorionsys/react` | Other apps |
| `packages/platform-core` | `@vorionsys/contracts` only | Apps, other packages |
| `packages/react` | `@vorionsys/contracts`, `@vorionsys/platform-core` | Apps |
| `packages/contracts` | External deps only | Any @vorionsys/* package |

### Forbidden Patterns

```typescript
// ❌ NEVER: App importing from another app
import { something } from '../../../apps/other-app/';

// ❌ NEVER: Package importing from app
import { component } from '@/app/components/'; // in packages/

// ❌ NEVER: Contracts importing from packages
import { TrustEngine } from '@vorionsys/platform-core'; // in contracts/
```

### Correct Patterns

```typescript
// ✅ CORRECT: App imports from packages
import { TrustEngine } from '@vorionsys/platform-core';
import type { AgentId } from '@vorionsys/contracts';

// ✅ CORRECT: Package imports from contracts
import type { TrustScore } from '@vorionsys/contracts';

// ✅ CORRECT: Use type imports for types only
import type { PolicyDecision } from '@vorionsys/contracts';
```

### Special Case: db/client.ts

The database client (`packages/platform-core/src/db/client.ts`) may ONLY import:
- `@vorionsys/contracts` (for types)
- `drizzle-orm/*` (ORM)
- `@neondatabase/*` (database driver)

---

## Feature Flag Rules (NEW)

> **SINGLE LOCATION:** All feature flags MUST be defined in `packages/contracts/src/flags.ts`

### Feature Flag Registry

```typescript
// packages/contracts/src/flags.ts
export const FLAGS = {
  // Trust Engine
  TRUST_EDGE_CACHE: 'trust_edge_cache',
  TRUST_ASYNC_RECALC: 'trust_async_recalc',
  TRUST_VELOCITY_V2: 'trust_velocity_v2',

  // PROOF System
  PROOF_ASYNC_SIGNING: 'proof_async_signing',
  PROOF_MULTI_PARTY: 'proof_multi_party',

  // Governance
  POLICY_PLAYGROUND: 'policy_playground',
  ENFORCE_V2_RESPONSE: 'enforce_v2_response',

  // Platform
  DARK_MODE: 'dark_mode',
  NEW_ONBOARDING: 'new_onboarding',
} as const;

export type FeatureFlag = typeof FLAGS[keyof typeof FLAGS];
```

### Usage Rules

```typescript
// ✅ CORRECT: Import from contracts
import { FLAGS } from '@vorionsys/contracts';
if (isEnabled(FLAGS.TRUST_EDGE_CACHE)) { ... }

// ❌ WRONG: Hardcoded string
if (isEnabled('trust_edge_cache')) { ... }

// ❌ WRONG: Local flag definition
const MY_FLAG = 'my_feature'; // Put it in contracts/flags.ts!
```

---

## Critical Implementation Rules

### TypeScript Rules

**CRITICAL - These cause subtle bugs if ignored:**

- **ES Module imports require `.js` extension in packages:**
  ```typescript
  // WRONG
  import { TrustEngine } from './TrustEngine';

  // CORRECT
  import { TrustEngine } from './TrustEngine.js';
  ```

- **Use `import type` for type-only imports:**
  ```typescript
  import type { AgentId, TrustLevel } from '@vorionsys/contracts';
  ```

- **Zod validation for all external inputs** - Never trust API inputs
  ```typescript
  const schema = z.object({ agentId: z.string().uuid() });
  const validated = schema.parse(input);
  ```

### Barrel File Rules (NEW)

```
✅ ALLOWED - Boundary exports only:
   packages/contracts/src/index.ts
   packages/platform-core/src/index.ts

❌ FORBIDDEN - Deep internal barrels:
   packages/platform-core/src/trust-engine/utils/index.ts
```

### Trust Model (8-Tier System)

The platform uses an 8-tier trust system (0-1000 scale):

| Tier | Score Range | Name | Autonomy Level |
|------|-------------|------|----------------|
| T0 | 0-199 | **Sandbox** | Human approval required, shadow mode events |
| T1 | 200-349 | **Observed** | Constrained operations, enhanced monitoring |
| T2 | 350-499 | Provisional | Limited operations, some autonomy |
| T3 | 500-649 | Monitored | Standard operations with monitoring |
| T4 | 650-799 | Standard | Read public data, external communication |
| T5 | 800-875 | Trusted | Extended autonomy |
| T6 | 876-950 | Certified | High autonomy, self-attestation |
| T7 | 951-1000 | Autonomous | Maximum autonomy |

**Key Trust Concepts:**
- **Evidence Type Weighting** - HITL approvals worth 5x, audits 3x, sandbox tests 0.5x
- **Shadow Mode** - T0 agents emit events tagged 'shadow' that don't count until HITL verified
- **Graceful Degradation** - Agents can be throttled/restricted without full termination

### BASIS Four-Layer Architecture

All governance flows through:

1. **INTENT** - Parse and classify action requests
2. **ENFORCE** - Evaluate against trust scores and policies
3. **PROOF** - Log with cryptographic integrity
4. **CHAIN** - Optional blockchain anchoring

---

## Naming Conventions

### Files

| Type | Convention | Example |
|------|------------|---------|
| React Components | PascalCase.tsx | `TrustBadge.tsx` |
| Services | PascalCase.ts | `TrustEngine.ts` |
| Utilities | camelCase.ts | `hashChain.ts` |
| Tests | *.test.ts | `TrustEngine.test.ts` |
| Schemas | camelCase.ts | `agentSchema.ts` |

### Code

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `TrustScoreCalculator` |
| Functions | camelCase | `calculateTrustScore` |
| Constants | UPPER_SNAKE | `TRUST_DECAY_RATE` |
| Types/Interfaces | PascalCase | `TrustScore`, `AgentId` |
| Events | entity:action | `'trust:updated'` |

### Packages

| Convention | Example |
|------------|---------|
| npm scope | `@vorionsys/package-name` |
| Internal imports | `@vorionsys/contracts` |

---

## Testing Rules (Updated 2026-02-02)

### Test Structure

- **Test framework:** Vitest
- **Co-locate unit tests:** `feature.ts` → `feature.test.ts`
- **Integration tests:** `tests/integration/`

### Coverage Thresholds

| Metric | Sprint 1 | Sprint 2+ |
|--------|----------|-----------|
| Lines | 70% | 80% |
| Branches | 60% | 70% |

### Integration Test Setup

```typescript
// tests/integration/__config__/setup.ts
import { beforeEach, afterEach, afterAll } from 'vitest';
import { db } from '@vorionsys/platform-core/db/client';
import { sql } from 'drizzle-orm';

// Isolated test schema per test file
const testSchema = `test_${process.env.VITEST_POOL_ID || 'main'}`;

beforeEach(async () => {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(testSchema)}`);
  await db.execute(sql`SET search_path TO ${sql.identifier(testSchema)}`);
});

afterEach(async () => {
  await db.execute(sql`DROP SCHEMA ${sql.identifier(testSchema)} CASCADE`);
});
```

### Running Tests

```bash
# All tests
npm test

# Specific workspace
npm --workspace=packages/atsf-core test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

---

## Development Commands (Updated 2026-02-02)

### Day 1 Commands (New Developer Onboarding)

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.shared.example .env.shared
cp apps/agentanchor/.env.example apps/agentanchor/.env.local

# 3. Start database (requires Docker)
docker-compose up -d

# 4. Run migrations
npm run db:migrate

# 5. Start dev server
npm run dev

# Verify: Open http://localhost:3000
```

**Troubleshooting:**
| Issue | Solution |
|-------|----------|
| `ECONNREFUSED` on db:migrate | Wait for Docker container to be healthy |
| Missing env vars | Check `.env.shared.example` for required values |
| Port 3000 in use | `PORT=3001 npm run dev` |

### Phase 4 Gate Check

Before starting any implementation story, run:

```bash
./scripts/check-phase4-gate.sh
```

This verifies:
- G1: `/src/` directory eliminated
- G2: `packages/platform-core/` exists
- G3: `docs/STRUCTURE.md` created
- G4: `docs/QUICKSTART.md` created
- G5: CI passes all structure checks
- G6: Coverage thresholds configured

### Common Commands

```bash
# Development (all workspaces)
npm run dev

# Build all
npm run build

# Type check
npm run typecheck

# Lint
npm run lint

# Database
npm run db:migrate
npm run db:seed

# Check circular imports
npx madge --circular --extensions ts packages/
```

---

## Security Rules

**CRITICAL - Never compromise on these:**

- **Never expose internal IDs in URLs** - Use auth context for org_id
- **Always validate with Zod** before processing any external input
- **Hash chain verification** - Never skip on audit reads
- **Rate limiting** - All public APIs use @upstash/ratelimit
- **Secrets** - Never commit .env files; use Vercel/Supabase secrets

---

## Migration & Platform Status (Updated 2026-02-27)

### Migration Tasks

| # | Task | Status |
|---|------|--------|
| 1 | Create `packages/platform-core/` | ✅ Complete |
| 2 | Move `/src/*` to platform-core | 🟡 In Progress (145 files remain in /src/) |
| 3 | Delete `/src/` directory | 🔴 Blocked on #2 |
| 4 | Create `docs/STRUCTURE.md` | ✅ Complete |
| 5 | Create `packages/contracts/src/flags.ts` | ✅ Complete |
| 6 | Add madge circular import check | ✅ Complete |
| 7 | Add secrets scanner (detect-secrets + gitleaks) | ✅ Semgrep + gitleaks active |
| 8 | Move `/src/db/schema/` → `packages/contracts/src/db/` | ✅ Complete |
| 9 | Add `packages/platform-core/src/db/client.ts` | ✅ Complete |
| 10 | Add ESLint import direction rules | ✅ Complete |
| 11 | Create `docs/QUICKSTART.md` | ✅ Complete |

### Testing Maturity

| Metric | Value | Date |
|--------|-------|------|
| Test files | 439 | 2026-02-27 |
| Individual test cases (it/test) | 15,309 | 2026-02-27 |
| Test directories | packages (167), tests (137), archive (80), apps (50) |
| Mutation testing | Stryker v9.6.0 — security: ~70% covered, platform-core: ~53% |
| Integration tests | Multi-tenant isolation (95 tests), e2e directory present |

### Published npm Packages (11 on @vorionsys)

| Package | Version | Published |
|---------|---------|-----------|
| @vorionsys/basis | 1.0.4 | 2026-02-23 |
| @vorionsys/car-client | 1.0.0 | 2026-02-22 |
| @vorionsys/car-cli | 1.0.0 | 2026-02-22 |
| @vorionsys/atsf-core | 0.2.2 | 2026-02-16 |
| @vorionsys/cognigate | 1.0.1 | 2026-02-08 |
| @vorionsys/contracts | 0.1.2 | 2026-02-16 |
| @vorionsys/proof-plane | 0.1.1 | 2026-02-08 |
| @vorionsys/runtime | 0.1.1 | 2026-02-08 |
| @vorionsys/sdk | 0.1.1 | 2026-02-08 |
| @vorionsys/shared-constants | 1.0.2 | 2026-02-16 |
| @vorionsys/aci-spec | 1.1.0 | 2026-01-27 |

### Contributor Activity (since 2026-02-01)

| Contributor | Commits | Focus |
|-------------|---------|-------|
| chunkstar (Ryan) | 254 | Architecture, features, deployment, trust engine |
| brnxfinest (Alex) | 144 | Compliance (313-control SSP), security hardening, tests, CI |
| Vorion Platform | 117 | Automated platform operations |
| Vorion Dev | 114 | Development automation |
| Claude | 49 | AI-assisted development |
| dependabot | 16 | Dependency security patches |
| **Total** | **513** | |

### IP Protection Status (Wave 1 delay reason)

- Attorney engagement: Expected March 10, 2026
- Entity: **Vorion Risk, LLC** (footer on agentanchorai.com)
- IP Policy: 1,236-line document covering patents, trade secrets, copyrights, trademarks
- Patent portfolio: 5 filings (2 granted, 2 pending, 1 filed)
- Trademark targets: Vorion®, Cognigate™, PROOF™, BASIS™
- Entity formation roadmap: WY LLC, IP assignment, operating agreement
- Compliance: NIST 800-53 Moderate SSP (313 controls), OSCAL artifacts, ISO 42001 gap analysis

---

## AI Agent Quick Reference Card

**Before writing any code, check:**
1. **FR → Directory mapping** in architecture.md
2. **Import direction rules** (contracts ← packages ← apps)
3. **Feature flags** in `packages/contracts/src/flags.ts`
4. **15 critical patterns** from architecture Step 5

**Common mistakes to avoid:**
- Creating files outside the defined structure
- Importing `apps/*` from `packages/*`
- Adding feature flags as hardcoded strings
- Skipping Zod validation at API boundaries
- Creating barrel files in deep directories

**Quick lookups:**
- Trust Engine → `packages/platform-core/src/trust-engine/`
- Auth → `packages/platform-core/src/security/auth/`
- DB Schemas → `packages/contracts/src/db/`
- API Routes → `apps/agentanchor/app/api/`

---

## Documentation Locations

| Document Type | Location |
|---------------|----------|
| **Architecture (SOURCE OF TRUTH)** | _bmad-output/planning-artifacts/architecture.md |
| Master Index | docs/index.md |
| Project Inventory | docs/MASTER-PROJECT-INVENTORY.md |
| BASIS Specifications | basis-core/specs/ |
| TrustBot Architecture | trustbot/docs/ARCHITECTURE.md |
| BMAD Outputs | _bmad-output/planning-artifacts/ |

---

## Sprint A: Safety Foundation (Completed 2026-01-31)

### Implemented Features

| Feature | Location | Description |
|---------|----------|-------------|
| **Escalation Service** | apps/agentanchor/lib/escalations/ | Full CRUD for HITL escalations with Drizzle ORM |
| **Evidence Weighting** | packages/a3i/src/trust/trust-calculator.ts | HITL=5x, audit=3x, sandbox=0.5x multipliers |
| **Shadow Mode** | packages/proof-plane/src/ | Events tagged for HITL verification before counting |
| **Circuit Breaker** | apps/agentanchor/lib/circuit-breaker/ | Kill switch (partial→platform→critical→lockdown) |
| **Graceful Degradation** | packages/a3i/src/cognigate/ | WARN→THROTTLE→RESTRICT→SUSPEND levels |
| **Shadow Mode API** | apps/agentanchor/app/api/v1/shadow/ | REST endpoints for shadow events and graduation |

### Key Contracts (packages/contracts/src/v2/)

```typescript
// Evidence type weighting
type EvidenceType = 'automated' | 'hitl_approval' | 'hitl_rejection' |
                    'examination' | 'audit' | 'sandbox_test' | 'peer_review';

// Shadow mode status
type ShadowModeStatus = 'production' | 'shadow' | 'testnet' | 'verified' | 'rejected';

// Degradation levels
type DegradationLevel = 'NONE' | 'WARN' | 'THROTTLE' | 'RESTRICT' | 'SUSPEND';
```

---

## Known TODOs

**Critical implementations pending:**

| File | Issue |
|------|-------|
| packages/proof-plane/ | Event signatures not implemented (TODO) |
| packages/atsf-core/src/api/ | Real health checks needed |
| ~~src/basis/evaluator.ts:222~~ | Will be at platform-core after migration |

---

## Usage Guidelines

**For AI Agents:**
- Read this file before implementing any code
- **CHECK architecture.md** for authoritative decisions
- Check workspace-specific contexts (e.g., trustbot/_bmad-output/project-context.md)
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option

**For Humans:**
- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review monthly for outdated rules

---

_Generated by BMad Method_
_Last Updated: 2026-02-27_
_Current Sprint: Pre-Launch — IP Lockdown + OSS Prep_
_Architecture Workflow: Complete (138+ elicitation methods)_
