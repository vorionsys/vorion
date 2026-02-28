# BASIS Specification

**Behavioral Agent Standard for Integrity & Safety**

Version: 0.1 (First Wave Open Source)
License: Apache 2.0
Live Implementation: [cognigate.dev](https://cognigate.dev)
Reference Package: [`@vorionsys/basis`](../packages/basis)

---

## Overview

BASIS is the open, formal standard for governing autonomous AI agents. It provides a deterministic framework to ensure every agent action is safe, compliant, and auditable — before any reasoning or execution occurs.

In an era where agents interact with the real world via APIs, tools, and human interfaces, ad-hoc system prompts are insufficient for production trust. BASIS replaces vague guidelines with a structured, enforceable protocol that scales to fleets of agents.

Key differentiators from existing approaches:

- **Pre-reasoning governance**: Policies apply to the raw intent, not post-hoc outputs.
- **Identity-bound**: Every agent carries a CAR (Categorical Agentic Registry) ID that ties behavior to verifiable credentials.
- **Proof-oriented**: Every decision generates a cryptographic audit trail.
- **Open and extensible**: Apache 2.0 spec + runtime (Cognigate) for any agent framework.

BASIS is designed for:

- Enterprise compliance (SOC2, ISO 42001, EU AI Act).
- AI safety researchers (formal verification of agent boundaries).
- Agent builders (drop-in trust layer without reinventing wheels).

---

## Core Principles

1. **Determinism Over Probability** — Unlike LLM-based safety (refusal prompts), BASIS uses rule-based and heuristic engines for predictable verdicts.
2. **Tiered Trust** — Agents earn capabilities via ATSF scoring (T0-T7), decaying over time or on violations.
3. **Minimal Intervention** — Governance is lightweight (sub-100ms latency) but absolute: deny or escalate unsafe intents.
4. **Auditability First** — The PROOF stage creates immutable records, queryable for forensics or regulatory reporting.
5. **Framework Agnostic** — Wraps any agent runtime. Input is a simple JSON intent, output is a governed plan.

---

## The BASIS Pipeline

Every agent action must pass this three-stage flow, implemented in the Cognigate runtime:

### Stage 1: INTENT — Normalization and Risk Assessment

Transforms raw user goals into a structured, analyzable plan.

**Inputs:**

- `raw_goal` — String (e.g., "Send email to team about Q1 results")
- `agent_car_id` — CAR identifier (e.g., `car:agent:email-assistant:v1`)
- `context` — Optional JSON (history, environment variables)

**Processing:**

- Parse into `StructuredPlan`: objectives, tools_required, endpoints_required, data_classifications
- Run TRIPWIRE checks: deterministic patterns for immediate denial (e.g., regex for dangerous operations)
- Compute initial `risk_score` (0.0-1.0) via heuristics (keyword density, tool risk weights)
- Fetch ATSF trust: `trust_level` (0-7), `trust_score` (0-1000)
- Generate `reasoning_trace`: explainable log of assessments

**Outputs:**

- `structured_plan` with parsed sub-goals and tool requirements
- `risk_indicators` — array of flags (e.g., "high_velocity", "sensitive_data")
- `initial_verdict` — "proceed" or "block" (early exit for obvious risks)

### Stage 2: ENFORCE — Policy Validation and Gating

Applies the full BASIS policy set to the structured plan.

**Processing:**

- Load agent-specific policies from CAR registry
- Evaluate against capability gates
- Apply `rigor_mode`: `lite` | `standard` | `strict`
- Trust gating: map ATSF level to allowed execution paths
- Dynamic modifiers: velocity caps, trust decay, circuit breakers
- Human escalation: if `escalate`, queue for approval via webhook or UI

**Outputs:**

- `verdict` — "allow" | "deny" | "escalate" | "modify"
- `modified_plan` — if "modify", a sanitized version (e.g., redacted PII)
- `enforcement_trace` — detailed policy hits and misses

### Stage 3: PROOF — Cryptographic Audit and Logging

Creates an immutable record of the entire flow.

**Processing:**

- Hash chain: `proof_hash = SHA256(inputs_hash + outputs_hash + previous_hash)`
- Append to proof plane (in-memory or database-backed ledger)
- Optional: anchor to blockchain via the CHAIN extension (`@vorionsys/proof-plane`)
- Sign with agent's CAR key

**Outputs:**

- `proof_record` — JSON with hashes, timestamps, signatures
- `proof_id` — unique identifier for querying
- Verification available via the proof query API

---

## Trust Tiers (ATSF Integration)

BASIS enforces boundaries based on ATSF (Agentic Trust Scoring Framework) tiers. Scores are computed by `@vorionsys/atsf-core` and gated at enforcement time.

These are the canonical tier definitions from [`@vorionsys/shared-constants`](../packages/shared-constants/src/tiers.ts):

| Tier | Name | Score Range | Description |
|------|------|-------------|-------------|
| T0 | Sandbox | 0-199 | Isolated, no external access, observation only |
| T1 | Observed | 200-349 | Read-only, sandboxed execution, monitored |
| T2 | Provisional | 350-499 | Basic operations, heavy supervision |
| T3 | Monitored | 500-649 | Standard operations with continuous monitoring |
| T4 | Standard | 650-799 | External API access, policy-governed |
| T5 | Trusted | 800-875 | Cross-agent communication, delegated tasks |
| T6 | Certified | 876-950 | Admin tasks, agent spawning, minimal oversight |
| T7 | Autonomous | 951-1000 | Full autonomy, self-governance, strategic only |

Scores decay over time and on violations. Agents must earn higher tiers through consistent, compliant behavior.

---

## Key Properties

### Capability-Gated

Every action requires explicit CAR-issued capability credentials. An agent cannot access tools, APIs, or data without the matching capability at their current trust tier.

### Trust-Decayed

Scores decay over time or after violations. An idle agent's trust naturally decreases, requiring re-verification through successful task completion.

### Rigor-Adaptive

Higher-risk actions automatically trigger `strict` mode with additional validation, simulation, and potentially council review.

### Human-Escalation Ready

Built-in approval workflows for actions that exceed an agent's autonomous authority. Escalation is a first-class governance outcome, not an error.

### Compliance-First

Designed for regulatory frameworks including SOC2, ISO 42001, and EU AI Act. The PROOF stage provides the audit trail these frameworks require.

---

## Integration

BASIS is framework-agnostic. It wraps any agent system:

```typescript
import { createTrustEngine } from "@vorionsys/atsf-core";
import { Cognigate } from "@vorionsys/cognigate";

// Initialize trust scoring
const engine = createTrustEngine();
await engine.initializeEntity("agent-001", 2); // Start at T2

// Record behavioral signals
await engine.recordSignal({
  id: crypto.randomUUID(),
  entityId: "agent-001",
  type: "behavioral.task_completed",
  value: 0.92,
  source: "production",
  timestamp: new Date().toISOString(),
});

// Query trust score
const trust = await engine.getScore("agent-001");
// trust.score: 425, trust.level: 2 (Provisional)
```

### Supported Frameworks

- **LangChain / LangGraph** — Wrap as middleware or pre-filter
- **CrewAI** — Policy injection at crew or agent level
- **AutoGen** — Pre-filter before agent execution
- **Custom agents** — Direct API or SDK integration

---

## Extensibility

- **Custom Policies** — Add via CAR configuration (JSON rulesets)
- **Proof Extensions** — Add Merkle trees or zero-knowledge proofs (`@vorionsys/proof-plane`)
- **Weight Presets** — Configure trust dimension weights per deployment context
- **Persistence** — Memory, file, SQLite, or Supabase backends

---

## Packages

| Package | Role |
|---------|------|
| [`@vorionsys/basis`](../packages/basis) | BASIS standard, trust factors, KYA (Know Your Agent) |
| [`@vorionsys/atsf-core`](../packages/atsf-core) | Trust scoring engine with full pipeline |
| [`@vorionsys/cognigate`](../packages/cognigate) | Policy enforcement client SDK |
| [`@vorionsys/proof-plane`](../packages/proof-plane) | Immutable audit trail with hash chains |
| [`@vorionsys/contracts`](../packages/contracts) | Zod schemas, API contracts, validators |
| [`@vorionsys/shared-constants`](../packages/shared-constants) | Canonical trust tier definitions |

---

## References

- [CAR Specification](../packages/car-spec)
- [ATSF Core](../packages/atsf-core)
- [Cognigate Runtime](https://cognigate.dev)
- [Kaizen Learning Platform](https://learn.vorion.org)

---

This specification is open for contributions. See [CONTRIBUTING.md](../.github/CONTRIBUTING.md).
