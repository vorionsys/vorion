# Cognigate Data Flow Diagram

**Document:** Data Flow Diagram -- Request Lifecycle
**System:** Vorion Cognigate -- AI Agent Governance Runtime
**SSP Reference:** NIST SP 800-53 Rev 5 Moderate Baseline
**Last Updated:** 2026-02-20

## Description

This diagram traces the complete lifecycle of an AI agent governance request through Cognigate. It shows how an agent intent flows through the INTENT, ENFORCE, and PROOF layers, including conditional paths for the Critic AI evaluation, circuit breaker checks, and cryptographic proof generation.

## Diagram

```mermaid
sequenceDiagram
    autonumber

    participant Agent as AI Agent<br/>(External)
    participant Vercel as Vercel Edge<br/>(TLS 1.2+)
    participant Intent as INTENT Layer<br/>(/v1/intent)
    participant Tripwire as Tripwire Engine<br/>(Regex + Paranoia)
    participant Enforce as ENFORCE Layer<br/>(/v1/enforce)
    participant Policy as Policy Engine<br/>(BASIS Rules)
    participant Trust as Trust Engine<br/>(T0-T7)
    participant Critic as Critic AI<br/>(Optional)
    participant AIProvider as AI Provider API<br/>(OpenAI/Anthropic)
    participant CB as Circuit Breaker
    participant Proof as PROOF Layer<br/>(/v1/proof)
    participant DB as Neon PostgreSQL<br/>(NullPool)
    participant Evidence as Evidence Hook<br/>+ Evidence Mapper

    Note over Agent,Evidence: Phase 1: Intent Normalization

    Agent->>Vercel: HTTPS POST /v1/intent<br/>{goal, entity_id, context}
    Vercel->>Intent: Forward request<br/>(TLS terminated)

    Intent->>Intent: Schema validation<br/>(Pydantic models)
    Intent->>Intent: Intent normalization<br/>(goal -> structured plan)

    Intent->>Tripwire: Check tripwires
    Tripwire->>Tripwire: Regex pattern scan<br/>(destructive keywords)
    Tripwire->>Tripwire: Euphemism detection<br/>(Paranoia Mode)
    Tripwire->>Tripwire: System path analysis
    Tripwire-->>Intent: Tripwire result<br/>(clean / flagged / blocked)

    alt Tripwire BLOCKED
        Intent-->>Agent: 403 Blocked<br/>{reason, tripwire_id}
    end

    Intent->>Trust: Lookup trust score
    Trust-->>Intent: Trust tier (T0-T7)<br/>+ numeric score

    alt Critic threshold met
        Intent->>Critic: Adversarial evaluation
        Critic->>AIProvider: HTTPS POST<br/>(prompt for analysis)
        AIProvider-->>Critic: Critic assessment
        Critic-->>Intent: Critic verdict<br/>(safe / suspicious / dangerous)
    end

    Intent-->>Agent: IntentResponse<br/>{intent_id, structured_plan,<br/>risk_level, trust_tier}

    Note over Agent,Evidence: Phase 2: Policy Enforcement

    Agent->>Vercel: HTTPS POST /v1/enforce<br/>{intent_id, entity_id, action}
    Vercel->>Enforce: Forward request

    Enforce->>CB: Check circuit state
    alt Circuit OPEN
        CB-->>Agent: 503 Circuit Open<br/>{recovery_time, reason}
    end

    Enforce->>Trust: Determine rigor mode
    Trust-->>Enforce: Rigor mode<br/>(STRICT / STANDARD / LITE)

    Enforce->>Enforce: Check velocity caps<br/>(per-entity rate limits)

    Enforce->>Policy: Evaluate against<br/>BASIS constraints
    Policy->>Policy: Match rules<br/>to action + tier
    Policy-->>Enforce: Policy result<br/>{violations[], action}

    alt Violations found
        Enforce->>Enforce: Determine verdict<br/>(deny / escalate / modify)
    else Clean
        Enforce->>Enforce: Verdict: ALLOW
    end

    Enforce->>Enforce: Record action<br/>(velocity tracking)

    Enforce-->>Agent: EnforceResponse<br/>{verdict_id, decision,<br/>violations[], rigor_mode}

    Note over Agent,Evidence: Phase 3: Cryptographic Proof

    Agent->>Vercel: HTTPS POST /v1/proof<br/>{intent_id, verdict_id,<br/>entity_id, decision}
    Vercel->>Proof: Forward request

    Proof->>Proof: Serialize inputs + outputs<br/>(deterministic JSON)
    Proof->>Proof: Calculate SHA-256 hash<br/>(hash chain link)
    Proof->>Proof: Sign with Ed25519<br/>(64-byte signature)

    Proof->>DB: Persist proof record<br/>(async via asyncpg)
    DB-->>Proof: Record stored<br/>{proof_id, chain_position}

    Proof->>Evidence: on_proof_created()
    Evidence->>Evidence: EvidenceMapper:<br/>map proof event to<br/>compliance controls
    Evidence->>DB: Persist ControlEvidence<br/>(13 frameworks mapped)
    DB-->>Evidence: Evidence stored

    Proof-->>Agent: ProofRecord<br/>{proof_id, hash,<br/>signature, timestamp,<br/>chain_position}
```

## Flow Summary

### Phase 1: Intent Normalization (`/v1/intent`)
1. Agent submits a goal description via HTTPS
2. Vercel Edge terminates TLS and forwards to the FastAPI application
3. Pydantic schema validation ensures well-formed input
4. Intent is normalized into a structured plan with risk assessment
5. Tripwire engine scans for destructive patterns, euphemisms, and system paths
6. Trust engine provides the agent's current trust tier (T0-T7)
7. If the intent meets the Critic threshold (suspicious or high-risk), the Critic AI sends an adversarial evaluation prompt to an external AI provider
8. Response includes the intent_id, structured plan, risk level, and trust tier

### Phase 2: Policy Enforcement (`/v1/enforce`)
1. Agent submits the intent_id and proposed action
2. Circuit breaker is checked first -- if OPEN, request is immediately rejected (503)
3. Trust engine determines the rigor mode: STRICT (T0-T2), STANDARD (T3-T4), or LITE (T5-T7)
4. Velocity caps enforce per-entity rate limits
5. Policy engine evaluates the action against loaded BASIS constraints
6. Verdict is one of: ALLOW, DENY, ESCALATE, or MODIFY
7. Action is recorded for velocity tracking

### Phase 3: Cryptographic Proof (`/v1/proof`)
1. Agent submits the enforcement decision for proof generation
2. Inputs and outputs are serialized to deterministic JSON (sorted keys)
3. SHA-256 hash is calculated, linking to the previous record in the chain
4. Ed25519 signature is applied for tamper-evidence
5. Proof record is persisted to Neon PostgreSQL via asyncpg (NullPool)
6. Evidence Hook fires automatically, invoking the Evidence Mapper
7. Evidence Mapper determines which compliance controls the proof event satisfies (across 13 frameworks)
8. ControlEvidence records are persisted alongside the proof
9. Agent receives the proof_id, hash, signature, and chain position

## Data Classification

| Data Element | Classification | Protection |
|-------------|---------------|------------|
| Agent goals / intents | MODERATE | TLS in transit, access-controlled at rest |
| Trust scores | MODERATE | Computed at runtime, cached in-memory |
| Policy rules | LOW | Loaded from configuration, version-controlled |
| Proof records | HIGH (integrity) | SHA-256 hash chain + Ed25519 signatures |
| Evidence records | MODERATE | Database access controls, audit logged |
| API keys | HIGH (confidentiality) | 256-bit entropy, hashed storage |
| Critic AI prompts | MODERATE | HTTPS to provider, no PII transmitted |

## Rendering

Render this diagram with any Mermaid-compatible viewer (GitHub, VS Code Mermaid extension, mermaid.live, or similar).
