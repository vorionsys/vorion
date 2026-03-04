# @vorion/car-cli

Command-line tools for **CAR agent identity** and **governance operations** -- manage the Categorical Agentic Registry and interact with the trust engine from your terminal.

## Installation

```bash
# Global install
npm install -g @vorion/car-cli

# One-off usage
npx @vorion/car-cli <command>

# Within a monorepo / project
pnpm add @vorion/car-cli
```

## What It Provides

`@vorion/car-cli` exposes the `car` binary, a unified terminal interface to both the **CAR registry** (agent identity) and the **trust engine** (behavioral governance). These are architecturally separate systems (see [ADR-004](https://github.com/voriongit/vorion/tree/main/docs/adr)), combined in a single CLI for developer convenience.

**CAR Registry (Identity) operations:**

- View registry-wide statistics (agents, deployments, compliance)
- Inspect agent provenance and lineage chains
- Browse the federated weight-preset hierarchy (CAR / Vorion / Axiom)

**Trust Engine (Governance) operations:**

- Evaluate role gates through the 3-layer Kernel / Policy / BASIS pipeline
- Check trust-score ceilings against regulatory compliance frameworks
- List and triage gaming/anomaly alerts

All data is fetched from a running CAR API instance via `@vorion/car-client`.

## Quick Start

```bash
# Point at your CAR API (defaults to http://localhost:3000)
export CAR_API_URL=https://api.agentanchorai.com
export CAR_API_KEY=your-api-key

# Dashboard overview
car stats

# Check whether agent-123 can assume the Orchestrator role
car evaluate agent-123 R_L3

# Inspect provenance chain
car provenance agent-123
```

## Command Reference

### `car stats`

Display dashboard statistics spanning both the CAR registry and trust engine -- context counts, compliance breakdown, role-gate decisions, and trust-tier distribution.

```bash
car stats
```

**Output sections:**

| Section | Description |
|---------|-------------|
| Context | Deployments, organizations, agents, active operations |
| Compliance Status | Compliant / warning / violation counts |
| Role Gate Evaluations | ALLOW / DENY / ESCALATE totals |
| Trust Tier Distribution | Agent count per tier (T0 -- T7) |

---

### `car evaluate <agentId> <role>`

*Trust-engine operation.* Evaluate a role gate for a given agent (identified by CAR ID). Returns the 3-layer evaluation result (Kernel, Policy, BASIS).

```bash
# Defaults: tier T3, score 550
car evaluate agent-123 R_L3

# Override current tier and score
car evaluate agent-123 R_L5 --tier T4 --score 700
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `-t, --tier <tier>` | Current trust tier (T0 -- T7) | `T3` |
| `-s, --score <score>` | Current trust score (0 -- 1000) | `550` |

**Layer results explained:**

| Layer | Purpose |
|-------|---------|
| 1. Kernel | Matrix lookup -- hard allow/deny based on tier vs. role |
| 2. Policy | Policy-engine evaluation (deployment/org-level rules) |
| 3. BASIS | Override mechanism -- used for exceptional circumstances |

---

### `car ceiling <agentId> <score>`

*Trust-engine operation.* Check a proposed trust score against regulatory ceilings and compliance frameworks for an agent (identified by CAR ID).

```bash
# Default framework
car ceiling agent-123 750

# Specify framework and previous score
car ceiling agent-123 750 --framework EU_AI_ACT --previous 600
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `-f, --framework <framework>` | Compliance framework (e.g., `DEFAULT`, `EU_AI_ACT`) | `DEFAULT` |
| `-p, --previous <score>` | Previous trust score (for delta analysis) | _(none)_ |

**Output includes:**

- Final score (after ceiling enforcement)
- Effective ceiling value
- Whether the ceiling was applied
- Compliance status (COMPLIANT / WARNING / VIOLATION)
- Gaming indicators, if detected

---

### `car provenance <agentId>`

*Identity operation.* Show provenance records for an agent, including creation type, initial trust modifier, parent agent, and full lineage chain.

```bash
car provenance agent-123
```

**Provenance record fields:**

| Field | Description |
|-------|-------------|
| Agent | Agent identifier |
| Type | Creation type (FRESH, CLONED, FORKED, MERGED) |
| Modifier | Trust modifier applied at creation (e.g., -50 for clones) |
| Parent | Parent agent ID (if derived) |
| Created By | Identity that created the agent |

If a multi-step lineage exists, the full chain is displayed (e.g., `agent-root -> agent-v2 -> agent-v3`).

---

### `car alerts [status]`

*Trust-engine operation.* List gaming/anomaly alerts, optionally filtered by status.

```bash
# All alerts (default limit 20)
car alerts

# Only active alerts
car alerts ACTIVE

# Limit results
car alerts --limit 50
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `-l, --limit <limit>` | Maximum number of alerts to return | `20` |

**Status values:** `ACTIVE`, `INVESTIGATING`, `RESOLVED`, `FALSE_POSITIVE`

**Severity levels:** `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`

---

### `car presets`

*Identity operation.* Display the federated weight-preset hierarchy across all three derivation layers.

```bash
car presets
```

**Preset layers:**

| Layer | Description |
|-------|-------------|
| CAR Canonical | Root presets defined by the CAR standard |
| Vorion Reference | Vorion-level overrides derived from CAR presets |
| Axiom Deployment | Deployment-specific presets with lineage verification |

---

### `car --version`

Print the current CLI version.

```bash
car --version
```

### `car --help`

Show top-level help or per-command help.

```bash
car --help
car evaluate --help
```

## Configuration

The CLI connects to a CAR API instance. Configuration is done via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `CAR_API_URL` | Base URL of the CAR API server | `http://localhost:3000` |
| `CAR_API_KEY` | Bearer token for authenticated endpoints | _(none)_ |
| `VORION_BASE_URL` | Fallback for `CAR_API_URL` | _(none)_ |
| `VORION_API_KEY` | Fallback for `CAR_API_KEY` | _(none)_ |

The CLI checks `CAR_API_URL` first, then falls back to `VORION_BASE_URL`, and finally defaults to `http://localhost:3000`.

## Programmatic API

The package also re-exports the full `@vorion/car-client` SDK for programmatic use:

```typescript
import { createCARClient } from '@vorion/car-cli'

const client = createCARClient({
  baseUrl: 'https://api.agentanchorai.com',
  apiKey: process.env.CAR_API_KEY,
})

const { stats } = await client.getStats()
```

For full SDK documentation, see [`@vorion/car-client`](https://github.com/voriongit/vorion/tree/main/packages/car-client).

## Trust Tiers (Reference)

> **Note:** Trust tiers and scores are **not** part of the CAR identity. They are dynamic behavioral metrics computed at runtime by the **Adaptive Trust Scoring Framework (ATSF)**. The trust engine operates on agents identified by their static, immutable CAR ID. This table is provided here as a reference for the trust-engine commands exposed by this CLI.

| Tier | Label | Score Range |
|------|-------|-------------|
| T0 | Sandbox | 0 -- 199 |
| T1 | Observed | 200 -- 349 |
| T2 | Provisional | 350 -- 499 |
| T3 | Monitored | 500 -- 649 |
| T4 | Standard | 650 -- 799 |
| T5 | Trusted | 800 -- 875 |
| T6 | Certified | 876 -- 950 |
| T7 | Autonomous | 951 -- 1000 |

## Agent Roles (Reference)

> **Note:** Role-gate enforcement (minimum tier requirements) is performed by the trust engine at runtime via the Kernel layer. Roles are defined by the CAR specification, but the trust-tier gating is a governance decision, not an identity attribute.

| Role | Level | Min Tier |
|------|-------|----------|
| R-L0 | Listener | T0 |
| R-L1 | Executor | T0 |
| R-L2 | Planner | T1 |
| R-L3 | Orchestrator | T2 |
| R-L4 | Architect | T3 |
| R-L5 | Governor | T4 |
| R-L6 | Sovereign | T5 |
| R-L7 | Meta-Agent | T5 |
| R-L8 | Ecosystem | T5 |

## Requirements

- Node.js >= 18
- A running CAR API instance (local or remote)

## License

[Apache-2.0](./LICENSE)

## Links

- [Main repository](https://github.com/voriongit/vorion)
- [`@vorion/car-client` SDK](https://github.com/voriongit/vorion/tree/main/packages/car-client)
- [CAR Specification](https://github.com/voriongit/vorion/tree/main/packages/car-spec)
