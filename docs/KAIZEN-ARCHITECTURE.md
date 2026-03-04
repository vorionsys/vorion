# Kaizen Architecture

**Execution Integrity Framework (BASIS as Layer 1)**

**Version:** 1.0.0
**Date:** January 29, 2026
**Status:** Canonical
**Replaces:** AURYN (strategic intelligence core)

---

## Overview

Kaizen is the execution integrity framework for Vorion. It provides a 4-layer governance stack that ensures every agent action is validated, declared, enforced, and proven.

**Key Change:** Kaizen replaces AURYN as the core execution layer. CHAIN (blockchain anchoring) is now an optional add-on for users who require external verification.

---

## The 4-Layer Stack

```
┌──────────────────────────────────────────────────────────────────────┐
│                              KAIZEN                                   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  LAYER 1: BASIS VALIDATION                                           │
│  ─────────────────────────                                           │
│  • Parse agent manifest                                              │
│  • Validate against BASIS schema                                     │
│  • Check capability claims match registered profile                  │
│  • Reject malformed or non-compliant agents                         │
│                         │                                            │
│                         ▼ PASS                                       │
│                                                                       │
│  LAYER 2: INTENT                                                     │
│  ───────────────                                                     │
│  • Declare action BEFORE execution                                   │
│  • Log immutably: "Agent X will perform Y on resource Z"            │
│  • Timestamp + hash                                                  │
│                         │                                            │
│                         ▼                                            │
│                                                                       │
│  LAYER 3: ENFORCE                                                    │
│  ────────────────                                                    │
│  • Runtime boundary checks                                           │
│  • Policy gates (scope, resources, time limits)                     │
│  • Interrupt on violation                                           │
│                         │                                            │
│                         ▼                                            │
│                                                                       │
│  LAYER 4: PROOF                                                      │
│  ─────────────                                                       │
│  • Generate execution receipt                                        │
│  • Merkle root of event sequence                                    │
│  • Cryptographic attestation: "This happened"                       │
│  • Submit to AgentAnchor (batched, async)                           │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Layer Details

### Layer 1: BASIS Validation

**Purpose:** Ensure only compliant agents can execute

| Function | Description |
|----------|-------------|
| Parse manifest | Read agent's CAR manifest |
| Schema validation | Verify against BASIS JSON schemas |
| Capability check | Confirm claimed capabilities match registered profile |
| Reject non-compliant | Block agents that fail validation |

**Output:** PASS (proceed to Layer 2) or REJECT (block execution)

---

### Layer 2: INTENT

**Purpose:** Declare what will happen before it happens

| Function | Description |
|----------|-------------|
| Declare action | "Agent X will perform Y on resource Z" |
| Immutable log | Write to append-only audit trail |
| Timestamp | ISO 8601 with timezone |
| Hash | SHA-256 of intent payload |

**Output:** IntentRecord with unique ID

---

### Layer 3: ENFORCE

**Purpose:** Gate execution based on trust and policy

| Function | Description |
|----------|-------------|
| Boundary checks | Verify agent stays within authorized scope |
| Policy gates | Apply rules for scope, resources, time limits |
| Trust verification | Check agent's trust tier permits this action |
| Interrupt | Halt execution immediately on violation |

**Decisions:**
- ALLOW → Proceed to execution
- DENY → Block with reason
- ESCALATE → Require human approval
- DEGRADE → Proceed with reduced scope

---

### Layer 4: PROOF

**Purpose:** Create cryptographic evidence of execution

| Function | Description |
|----------|-------------|
| Execution receipt | Record of what actually happened |
| Merkle root | Hash tree of event sequence |
| Attestation | Cryptographic proof: "This happened" |
| Submit | Batch send to AgentAnchor (async) |

**Output:** ProofRecord with chain linkage

---

## Optional: CHAIN Layer (Add-On)

For users requiring external verification (regulatory, enterprise compliance):

| Function | Description |
|----------|-------------|
| Blockchain anchor | Write proof hash to Polygon/Ethereum |
| Timestamp authority | RFC 3161 trusted timestamps |
| External verification | Third-party audit capability |

**Note:** CHAIN is NOT required for Kaizen compliance. It's an optional add-on.

---

## Trust Score Policy

### Visibility

| Who | Can See Score? |
|-----|----------------|
| Users | ✅ YES - Full visibility |
| Agents | ⚠️ Should NOT track/obsess over score |
| System | ✅ YES - For enforcement decisions |

### Anti-Gaming Rules

1. **Agents should focus on doing good work, not gaming score**
2. **If an agent is detected gaming score → automatic penalty**
3. **Score manipulation attempts are logged and flagged**

### Starting Tier

| Tier | Purpose |
|------|---------|
| **T0 Sandbox (0-199)** | All new agents start here |
| | Safe environment for proving competence |
| | Complete tasks successfully → score increases |
| | Demonstrate reliability → advance to T1 |

---

## Comparison: AURYN vs Kaizen

| Aspect | AURYN (Old) | Kaizen (New) |
|--------|-------------|--------------|
| Role | Strategic intelligence | Execution integrity |
| Complexity | High (multi-component) | Simpler (4 layers) |
| Blockchain | Required (CHAIN layer) | Optional add-on |
| Focus | Planning + reasoning | Validation + enforcement |
| Owner | Alex (joint) | Ryan (sole) |

**Why the change:** Simpler architecture, clearer responsibilities, optional blockchain reduces complexity for users who don't need it.

---

## Integration Points

### With AgentAnchor
- PROOF layer submits execution receipts
- AgentAnchor aggregates trust data
- Certification based on Kaizen compliance

### With Cognigate
- Kaizen IS the Cognigate runtime
- cognigate.dev API implements these 4 layers
- SDK wraps Kaizen functionality

### With Aurais
- User-facing app built on Kaizen
- Dashboard shows trust scores (visible to users)
- Agent management through Kaizen validation

---

## Implementation Status

| Layer | Status | Location |
|-------|--------|----------|
| Layer 1: BASIS | 🟡 Partial | `packages/basis/` |
| Layer 2: INTENT | 🟡 Partial | `packages/platform-core/src/intent/` |
| Layer 3: ENFORCE | 🟡 Partial | `packages/platform-core/src/enforce/` |
| Layer 4: PROOF | 🟡 Partial | `packages/platform-core/src/proof/` |
| CHAIN (Optional) | ⚪ Not started | - |

---

*Document Version: 1.0.0*
*Last Updated: January 29, 2026*
*Author: Vorion AI Governance Team*
