# Vorion Platform Structure

> **AI Agent Reference**: This document defines canonical paths, import rules, and architecture for the Vorion AI Governance Platform.

---

## Overview

Vorion is an enterprise AI governance platform providing trust scoring, policy enforcement, and cryptographic audit trails for AI agent operations.

**Core Capabilities:**
- Trust Engine (8-tier T0-T7 scoring)
- Policy Enforcement (BASIS rule engine)
- Proof System (immutable audit trails)
- Agent Registry (CAR protocol)
- Cognigate (constrained execution)

---

## Quick Reference

| Need | Path |
|------|------|
| Add shared type | `packages/contracts/src/` |
| Add business logic | `packages/platform-core/src/` |
| Add feature flag | `packages/contracts/src/flags.ts` |
| Add DB schema | `packages/contracts/src/db/` |
| Add app feature | `apps/{app-name}/` |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    APPLICATIONS LAYER                        │
│  agentanchor (3000) │ aurais (3002) │ cognigate-api (3000)  │
└─────────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────────┐
│                       SDK LAYER                              │
│  @vorionsys/sdk │ @vorionsys/agentanchor-sdk │ @vorion/a3i  │
└─────────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────────┐
│                      CORE LAYER                              │
│              @vorionsys/platform-core                        │
│  trust-engine │ enforce │ proof │ intent │ governance       │
│  basis │ cognigate │ api │ a2a │ agent-registry │ audit     │
│  security │ common │ db │ observability │ persistence       │
└─────────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────────┐
│                   FOUNDATION LAYER                           │
│  @vorion/contracts (types, schemas) │ shared-constants      │
└─────────────────────────────────────────────────────────────┘
```

---

## Import Rules

```
packages/contracts  ←  packages/*  ←  apps/*
```

**CRITICAL:**
- ❌ NEVER: `packages/*` → `apps/*`
- ❌ NEVER: `packages/contracts` → `packages/*`
- ✅ ALWAYS: `apps/*` → `packages/*` → `packages/contracts`

---

## Platform-Core Modules (22+)

### Trust & Scoring
| Module | Description |
|--------|-------------|
| **trust-engine** | Core trust scoring, tier conversion |
| **agent-registry** | Agent registration, attestations |

### Governance & Policy
| Module | Description |
|--------|-------------|
| **enforce** | Policy enforcement engine |
| **governance** | Governance rules, workflows |
| **policy** | Policy definitions, versioning |
| **semantic-governance** | NLP-based governance |

### Evidence & Audit
| Module | Description |
|--------|-------------|
| **proof** | Cryptographic proof chains |
| **audit** | Audit logging, compliance |

### Execution & API
| Module | Description |
|--------|-------------|
| **cognigate** | Constrained execution gateway |
| **api** | Fastify API server |
| **a2a** | Agent-to-Agent protocol |
| **intent** | Intent processing |

### Infrastructure
| Module | Description |
|--------|-------------|
| **security** | Auth, authorization |
| **common** | Shared utilities |
| **db** | Database client |
| **observability** | Metrics, logging, tracing |

---

## Trust Model (T0-T7)

| Tier | Name | Score | Autonomy |
|------|------|-------|----------|
| T0 | Sandbox | 0-199 | None |
| T1 | Observed | 200-349 | Minimal |
| T2 | Provisional | 350-499 | Limited |
| T3 | Monitored | 500-649 | Expanding |
| T4 | Standard | 650-799 | Standard |
| T5 | Trusted | 800-875 | Expanded |
| T6 | Certified | 876-950 | Independent |
| T7 | Autonomous | 951-1000 | Full |

---

## Feature Flags

All flags in `packages/contracts/src/flags.ts`:

```typescript
import { FLAGS, isFeatureEnabled } from '@vorion/contracts';

// ✅ Correct
if (isFeatureEnabled(FLAGS.TRUST_EDGE_CACHE)) { ... }

// ❌ Wrong
if (isFeatureEnabled('trust_edge_cache')) { ... }
```

### Phase Roadmap
| Phase | Timeline | Flags |
|-------|----------|-------|
| 7 | Q1-Q2 2026 | `MERKLE_PROOFS`, `ZK_PROOFS` |
| 8 | Q3 2026 | `TEE_SUPPORT`, `HSM_INTEGRATION` |
| 9 | Q4 2026 | `MULTI_TENANT`, `ENTERPRISE_SSO` |

---

## Development Guidelines

### Adding Types
1. Create in `packages/contracts/src/`
2. Define Zod schemas
3. Export from `index.ts`

### Adding Logic
1. Create in `packages/platform-core/src/{module}/`
2. Import types from `@vorion/contracts`
3. Export from module's `index.ts`

### Common Mistakes

```typescript
// ❌ Wrong: Import from src
import { X } from '../../src/trust-engine';

// ✅ Correct: Import from package
import { X } from '@vorionsys/platform-core/trust-engine';

// ❌ Wrong: Inline flag string
if (isEnabled('dark_mode')) { ... }

// ✅ Correct: Use FLAGS
if (isEnabled(FLAGS.DARK_MODE)) { ... }
```

---

## CI/CD

### Required Checks
- Linting passes
- TypeScript compiles
- No circular deps (`npm run check:circular`)
- Tests pass
- No critical vulnerabilities

### Commands
```bash
npm run build           # Build all
npm run typecheck       # Type check
npm run check:circular  # Circular deps
npm run lint           # Lint
npm test               # Tests
```

---

*Last updated: 2026-02-05*
