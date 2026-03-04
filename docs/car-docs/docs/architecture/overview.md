---
sidebar_position: 1
title: Architecture Overview
---

# CAR Architecture Overview

The CAR system is built on a three-layer architecture that separates identity, certification, and runtime governance concerns.

## Layer Model

```
┌──────────────────────────────────────────────────────────┐
│  Layer 3: Semantic Governance & Runtime Assurance         │
│  Behavioral monitoring, drift detection, policy engine    │
├──────────────────────────────────────────────────────────┤
│  Layer 2: Capability Certification & Extensions           │
│  Attestations, extensions, trust scoring                  │
├──────────────────────────────────────────────────────────┤
│  Layer 1: Identity & Trust Primitives                     │
│  CAR string, DIDs, OIDC claims, domains/levels/tiers      │
└──────────────────────────────────────────────────────────┘
```

## Layer 1: Identity & Trust Primitives

**Purpose**: Establish WHO the agent is and WHAT it claims to do.

| Component | Standard | Purpose |
|-----------|----------|---------|
| CAR String | CAR Spec | Compact agent identifier |
| DID | W3C DID Core | Cryptographic identity |
| OIDC Claims | OpenID Connect | Token-based auth |
| Domains | CAR Spec | Capability areas (10 codes) |
| Levels | CAR Spec | Autonomy degree (L0–L7) |
| Tiers | CAR Spec | Trust classification (T0–T7) |

## Layer 2: Capability Certification & Extensions

**Purpose**: Verify and certify WHAT the agent can actually do.

| Component | Purpose |
|-----------|---------|
| Attestations | Third-party capability proofs |
| Certification Authority | Issues/revokes attestations |
| Trust Engine | Computes runtime trust scores |
| Extensions | Optional governance hooks |
| Registry API | Agent discovery and management |

## Layer 3: Semantic Governance & Runtime Assurance

**Purpose**: Monitor HOW the agent behaves and enforce guardrails.

| Component | Purpose |
|-----------|---------|
| Instruction Integrity | Bind agents to approved instruction sets |
| Output Schema Binding | Prevent data exfiltration |
| Behavioral Drift Detection | Detect anomalous behavior |
| Context Authentication | Prevent indirect injection |
| Audit Trail | Immutable action history |

## System Components

### Agent Naming Service (ANS)

The registry for agent registration, discovery, and DID resolution.

```
POST /api/v1/agents          — Register
GET  /api/v1/agents?domain=F — Discover
GET  /api/v1/agents/{did}    — Resolve
```

### Certification Authority (CA)

Issues verifiable attestations that certify an agent's capabilities.

### Trust Engine

Continuously evaluates trust scores from three inputs:

```
Trust Score = Certification(30%) + Behavior(40%) + Context(30%)
```

### Cognigate Policy Engine

Evaluates governance policies before agent actions:

```
Agent Action → Cognigate Policy Check → Allow/Deny → Execute/Block
```

## Agent Lifecycle

```
1. Registration  → CAR string assigned, DID created
2. Certification → Capabilities attested by CA
3. Deployment    → Runtime tier computed for context
4. Operation     → Actions gated by trust + policy
5. Monitoring    → Behavior tracked, trust updated
6. Re-Cert       → Periodic re-attestation
7. Revocation    → Immediate trust zeroing if needed
```

## Agent Provenance

How an agent was created affects its initial trust:

| Creation Type | Trust Modifier | Use Case |
|--------------|---------------|----------|
| FRESH | ±0 | New agent, starts at baseline |
| CLONED | -50 | Copy of existing agent |
| EVOLVED | +100 | Upgraded from proven agent |
| PROMOTED | +150 | Elevated from lower tier |
| IMPORTED | -100 | External agent, untrusted source |
