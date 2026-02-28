# BASIS Specification

**Behavioral Agent Standard for Integrity & Safety**

Version: 0.1 (First Wave Open Source — Feb 2026)
License: Apache 2.0
Live Implementation: [cognigate.dev](https://cognigate.dev)
Reference Package: [`@vorionsys/basis`](https://npmjs.com/package/@vorionsys/basis)

> **This is v0.1 — an early experiment, not a formal standard.**
> We are sharing it for community feedback. Help us refine it.

## Overview

BASIS is an open, experimental specification for governing autonomous AI agents. It provides a structured framework to ensure every agent action is assessed, gated, and auditable — before any reasoning or execution occurs.

In an era where agents interact with the real world via APIs, tools, and human interfaces, ad-hoc system prompts are insufficient for production trust. BASIS replaces vague guidelines with a structured, enforceable protocol.

**Key characteristics (and honest limitations):**

- **Pre-reasoning governance**: Policies apply to the raw intent, not post-hoc outputs. *Limitation: still relies on heuristics — jailbreakable by adversaries.*
- **Identity-bound**: Every agent carries a CAR (Categorical Agentic Registry) ID that ties behavior to verifiable credentials. *Limitation: centralized demo registry, not yet decentralized.*
- **Proof-oriented**: Every decision generates a cryptographic audit trail. *Limitation: SHA-256 chain only, no ZK or public ledger yet.*
- **Open & extensible**: Apache 2.0 spec + runtime for any agent framework.

## Core Principles

1. **Determinism Over Probability**: Unlike LLM-based safety (refusal prompts), BASIS uses rule-based + heuristic engines for predictable verdicts. Not perfect — but inspectable.
2. **Tiered Trust**: Agents earn capabilities via ATSF scoring (T0–T7), decaying over time or upon violations. *Tier boundaries are arbitrary starting points — we need community help to refine them.*
3. **Minimal Intervention**: Governance is lightweight (sub-100ms target latency) but absolute — deny/escalate unsafe intents.
4. **Auditability First**: PROOF stage creates immutable records, queryable for forensics or regulatory reporting.
5. **Framework Agnostic**: Wraps any agent runtime; input is simple JSON, output is a governed plan.

## The BASIS Pipeline

Every agent action flows through this three-stage engine (implemented in [Cognigate](https://cognigate.dev)):

### Stage 1: INTENT — Normalization & Risk Assessment

Transforms raw user goals into a structured, analyzable plan.

**Inputs:**
- `raw_goal`: String (e.g., "Send email to team about Q1 results")
- `agent_car_id`: CAR identifier (e.g., `car:agent:email-assistant:v1`)
- `context`: Optional JSON (history, env vars)

**Processing:**
- Parse into `StructuredPlan` with `objectives`, `tools_required`, `endpoints_required`, `data_classifications`
- Run TRIPWIRE checks: deterministic patterns for immediate denial
- Compute `risk_score` (0.0–1.0) via heuristics
- Fetch ATSF trust: `trust_level` (0–7), `trust_score` (0–1000)
- Generate `reasoning_trace`: explainable log of assessments

**Outputs:** `structured_plan`, `risk_indicators`, `initial_verdict`

Live endpoint: `POST /v1/intent`

### Stage 2: ENFORCE — Policy Validation & Gating

Applies the full BASIS policy set to the structured plan.

**Processing:**
- Load agent-specific policies from CAR registry
- Evaluate against 24+ capability gates
- Apply `rigor_mode`: `lite` | `standard` | `strict`
- Trust gating: map ATSF level to allowed paths
- Dynamic modifiers: velocity caps, decay, circuit breakers
- Human escalation: queue for approval if verdict is `escalate`

**Returns:** `verdict` (`allow` | `deny` | `escalate` | `modify`), `modified_plan`, `enforcement_trace`

Live endpoint: `POST /v1/enforce`

### Stage 3: PROOF — Cryptographic Audit & Logging

Creates an immutable record of the entire flow.

**Processing:**
- Hash chain: `proof_hash = SHA256(inputs_hash + outputs_hash + previous_hash)`
- Append to proof plane (in-memory or DB-backed ledger)
- Optional: anchor to blockchain (via CHAIN extension)
- Sign with agent's CAR key

**Returns:** `proof_record`, `proof_id`, `verification_endpoint`

Live endpoint: `POST /v1/proof`
Query: `GET /v1/proof/{id}`

## Trust Tiers (T0–T7)

BASIS enforces boundaries based on ATSF (Agent Trust Scoring Framework) tiers. Scores are computed by `@vorionsys/atsf-core` and gated by Cognigate.

| Tier | Name | Score | Path | Capabilities | Restrictions |
|------|------|-------|------|-------------|-------------|
| T0 | Untrusted | 0–199 | Full sandbox | Read-only internals | All external blocked |
| T1 | Provisional | 200–399 | Restricted | Basic compute | No PII, no writes |
| T2 | Trusted | 400–599 | Standard | Rate-limited externals | Audit every action |
| T3 | Verified | 600–799 | Elevated | PII read, limited writes | Human approval for highs |
| T4 | Privileged | 800–899 | High-trust | Full tools, multi-step | Decay after 1h idle |
| T5 | Autonomous | 900–949 | Express | Near-full with auto-escalate | Velocity caps |
| T6 | Council | 950–989 | Oversight | Requires peer review | For critical infra |
| T7 | Sovereign | 990–1000 | Minimal | Full autonomy | Regulatory reporting mandatory |

*These boundaries are our arbitrary starting point. They need real benchmarks and community validation.*

Reference: `GET /v1/reference/tiers`

## Capabilities Catalog

BASIS defines 24 core capabilities, each with risk weights and trust prerequisites. Examples:

- `api_call`: Weight 0.4, Min T2
- `file_write`: Weight 0.7, Min T4 + approval
- `human_interact`: Weight 0.9, Min T5 + strict mode
- `self_modify`: Weight 1.0, Min T7 + council

Full list: `GET /v1/reference/capabilities`

## Example Flow

```python
import httpx

async with httpx.AsyncClient() as client:
    # INTENT: normalize the goal
    intent = await client.post("https://cognigate.dev/v1/intent", json={
        "entity_id": "car:agent:email-assistant:v1",
        "goal": "Send Q1 results to team"
    })

    # ENFORCE: validate against policies
    verdict = await client.post("https://cognigate.dev/v1/enforce", json={
        "plan": intent.json()["plan"],
        "entity_id": "car:agent:email-assistant:v1",
        "trust_level": intent.json()["trust_level"],
        "trust_score": intent.json()["trust_score"]
    })

    # PROOF: record the decision
    proof = await client.post("https://cognigate.dev/v1/proof", json=verdict.json())
```

## What this does NOT do (yet)

- **Formal verification** — we use heuristics, not mathematical proofs
- **Decentralized identity** — CAR is currently centralized
- **ZK-proofs** — proof chain is SHA-256 only
- **Production-scale benchmarks** — no published load tests yet
- **Integration plugins** — wrapper examples are toy-level

These are future goals, not promises. See [ROADMAP.md](ROADMAP.md).

## Compliance Mapping (aspirational)

- **EU AI Act**: High-risk agents map to T3–T5 with strict + proofs
- **ISO 42001**: Audit trails via PROOF
- **SOC2**: Capability gating + decay for access controls
- **NIST AI RMF**: Submitted as community input (Feb 2026)

*We have not been audited or certified. These are intended design goals.*

## References

- [Cognigate runtime](https://cognigate.dev) — live implementation
- [ROADMAP.md](ROADMAP.md) — what we plan to work on next
- [Contributing](../.github/CONTRIBUTING.md) — how to help

---

*This spec is open for contributions — especially critiques. Tell us what's wrong with it.*
