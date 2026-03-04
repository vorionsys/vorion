# BASIS

## Baseline Authority for Safe & Interoperable Systems

**The open standard for AI agent governance**

---

## The Problem

AI agents are making autonomous decisions. Right now, there's no standard way to:

- **Verify** an agent will behave within bounds
- **Trust** that governance checks happen before action
- **Audit** what decisions were made and why
- **Interoperate** between different agent systems

Every company is building their own governance. None of it talks to each other. None of it is verifiable.

---

## The Solution

BASIS is an open standard that defines **what must happen before an AI agent acts**.

```
┌─────────────────────────────────────────────────────────────┐
│                    AGENT WANTS TO ACT                       │
└─────────────────────────────────┬───────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────┐
│                      BASIS GOVERNANCE                       │
│                                                             │
│   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   │
│   │ INTENT  │──▶│ ENFORCE │──▶│  PROOF  │──▶│  CHAIN  │   │
│   │         │   │         │   │         │   │         │   │
│   │ Parse   │   │ Check   │   │ Log     │   │ Anchor  │   │
│   │ Plan    │   │ Trust   │   │ Audit   │   │ Verify  │   │
│   │ Risk    │   │ Gate    │   │ Trail   │   │ Immutable│   │
│   └─────────┘   └─────────┘   └─────────┘   └─────────┘   │
│                                                             │
└─────────────────────────────────┬───────────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │  ALLOWED    │   DENIED  │
                    │  Execute    │   Block   │
                    └─────────────────────────┘
```

---

## The Four Layers

| Layer | Purpose | Key Question |
|-------|---------|--------------|
| [**INTENT**](/intent) | Understand what the agent wants to do | "What is being attempted?" |
| [**ENFORCE**](/enforce) | Check if it's allowed based on trust & policy | "Should this be permitted?" |
| [**PROOF**](/proof) | Create immutable audit trail | "What happened and why?" |
| [**CHAIN**](/chain) | Anchor proofs to blockchain | "Can this be independently verified?" |

---

## Core Principles

### 1. Governance Before Execution
No autonomous action proceeds without passing through governance checks. Period.

### 2. Trust is Quantified
Not binary allow/deny, but graduated trust scores (0-1000) that unlock capabilities progressively.

### 3. Everything is Auditable
Every governance decision is logged with enough detail to reconstruct exactly what happened.

### 4. Open Standard, Many Implementations
BASIS is the spec. Anyone can build a compliant implementation. No vendor lock-in.

---

## Trust Tiers

| Tier | Score | Capabilities |
|------|-------|--------------|
| T0 Sandbox | 0-199 | Sandbox only |
| T1 Observed | 200-349 | Limited operations |
| T2 Provisional | 350-499 | Basic operations |
| T3 Monitored | 500-649 | Standard operations |
| T4 Standard | 650-799 | Extended operations |
| T5 Trusted | 800-875 | Elevated operations |
| T6 Certified | 876-950 | Privileged operations |
| T7 Autonomous | 951-1000 | Full autonomy |

---

## Why Open?

**For Developers:**
- Build once, deploy anywhere
- No proprietary lock-in
- Community-driven improvements

**For Enterprises:**
- Vendor-neutral standard
- Auditable compliance
- Interoperable agents

**For the Ecosystem:**
- Shared infrastructure costs
- Network effects for trust
- Rising tide lifts all boats

---

## Quick Links

- [Read the Spec](/spec) — Full technical specification
- [Get Started](/quickstart) — Build your first compliant agent
- [Reference Implementation](https://github.com/voriongit/cognigate) — Working code
- [Community](/community) — Discord, GitHub, calls

---

## Implementations

### Cognigate (Reference)
The reference implementation maintained by Vorion.
- [GitHub](https://github.com/voriongit/cognigate)
- [Documentation](https://cognigate.dev)

### Build Your Own
Anyone can implement BASIS. See the [implementation guide](/implement).

---

## Get Involved

BASIS is community-governed. Here's how to participate:

1. **Use it** — Build agents on BASIS
2. **Contribute** — Code, docs, ideas
3. **Govern** — Shape the standard's future

[Join the Community →](/community)

---

## Status

| Component | Status |
|-----------|--------|
| Specification | v1.2 (Draft) |
| Reference Impl | Alpha |
| Test Suite | In Development |
| Certification | Coming Soon |

---

*BASIS is an open standard released under CC BY 4.0. Reference implementations are Apache 2.0.*
