# Vorion Examples

Quickstart examples demonstrating the core Vorion framework APIs.

## Prerequisites

1. **Node.js 18+** with TypeScript support
2. Install Vorion packages:

```bash
npm install @vorionsys/sdk @vorionsys/cognigate @vorionsys/contracts
```

3. For remote mode, set the following environment variables:

```bash
export VORION_API_ENDPOINT="https://cognigate.dev"
export VORION_API_KEY="your-api-key"
```

Local mode (in-memory) requires no additional setup.

## Examples

| File | Description |
|------|-------------|
| [`quickstart.ts`](quickstart.ts) | Basic SDK usage: create a client, register an agent, submit an intent, check trust, view proof records |
| [`trust-scoring.ts`](trust-scoring.ts) | Trust score lifecycle: get status, submit outcomes, view history, understand tier transitions (T0-T7) |
| [`governance.ts`](governance.ts) | Governance enforcement: parse intents, enforce rules, check permissions, handle decisions |
| [`car-identity.ts`](car-identity.ts) | CAR (Contextual Authority Record): generate, parse, validate, and manipulate CAR identity strings |

## Running

These examples are illustrative TypeScript files. Run them with `tsx` or `ts-node`:

```bash
npx tsx examples/quickstart.ts
npx tsx examples/trust-scoring.ts
npx tsx examples/governance.ts
npx tsx examples/car-identity.ts
```

## Architecture Reference

```
Foundation:    shared-constants -> basis -> contracts
                       |            |        |
Services:      atsf-core, cognigate, runtime
                       |
SDKs:          sdk, council, car-client, car-cli
```

- **@vorionsys/sdk** -- Simple governance interface (Vorion class, Agent class)
- **@vorionsys/cognigate** -- Full Cognigate API client (agents, trust, governance, proofs)
- **@vorionsys/contracts** -- Type definitions, CAR string utilities, Zod schemas

## Trust Tier Reference (T0-T7)

| Tier | Name | Score Range | Description |
|------|------|-------------|-------------|
| T0 | Sandbox | 0-199 | No autonomy, fully sandboxed |
| T1 | Observed | 200-349 | Read-only observation |
| T2 | Provisional | 350-499 | Limited actions with approval |
| T3 | Monitored | 500-649 | Standard monitoring |
| T4 | Standard | 650-799 | Self-directed within bounds |
| T5 | Trusted | 800-875 | Expanded autonomy |
| T6 | Certified | 876-950 | Independent operation |
| T7 | Autonomous | 951-1000 | Full autonomy |

## Capability Levels (L0-L7)

| Level | Name | Description |
|-------|------|-------------|
| L0 | Observe | Read-only access |
| L1 | Advise | Suggest and recommend |
| L2 | Draft | Prepare changes for review |
| L3 | Execute | Execute with approval |
| L4 | Autonomous | Self-directed within bounds |
| L5 | Trusted | Expanded autonomy |
| L6 | Certified | Independent operation |
| L7 | Sovereign | Full autonomy |
