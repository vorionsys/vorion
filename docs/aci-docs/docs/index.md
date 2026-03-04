---
slug: /
sidebar_position: 1
title: Overview
---

# Categorical Agentic Registry (ACI)

The **Categorical Agentic Registry** is a universal standard for AI agent identity, capability certification, and trust verification. ACI provides a hierarchical, human-readable, machine-parseable identifier format that encodes everything needed to understand what an AI agent is, what it can do, and how much it should be trusted.

## The Problem

As AI agents proliferate across industries, there is no standard way to:

- **Identify** an agent and its capabilities
- **Certify** what actions an agent is authorized to perform
- **Verify** an agent's trust level before granting access
- **Govern** agent interactions at runtime

## The Solution

ACI provides a **capability certification layer** — a standardized identifier format with supporting infrastructure for registration, verification, and governance.

```
aci:agentanchor:vorion:classifier/FH/L3/T5/1.0.0
 │       │        │        │      │   │   │   └── Version
 │       │        │        │      │   │   └── Trust Tier (Trusted)
 │       │        │        │      │   └── Capability Level (Supervised)
 │       │        │        │      └── Capability Domains (Finance + Healthcare)
 │       │        │        └── Agent Class
 │       │        └── Organization
 │       └── Registry
 └── Scheme
```

## Capability Domains

| Code | Domain | Description |
|------|--------|-------------|
| **A** | Administrative | System management, user provisioning |
| **C** | Communication | Messaging, notifications, channels |
| **D** | Data | Storage, retrieval, transformation |
| **E** | Engineering | Code generation, CI/CD, infrastructure |
| **F** | Financial | Payments, accounting, trading |
| **G** | General | Multi-purpose, utility functions |
| **H** | Healthcare | Medical records, diagnostics, HIPAA |
| **L** | Legal | Contracts, compliance, regulatory |
| **R** | Research | Analysis, literature review, experimentation |
| **S** | Security | Auth, encryption, threat detection |

## Capability Levels

| Level | Name | Description |
|-------|------|-------------|
| **L0** | Observe | Read-only monitoring |
| **L1** | Suggest | Can propose actions, no execution |
| **L2** | Assist | Execute with human approval |
| **L3** | Supervised | Autonomous within policy bounds |
| **L4** | Autonomous | Full autonomy, post-hoc review |
| **L5** | Sovereign | System-level authority |

## Trust Tiers

| Tier | Name | Score Range |
|------|------|-------------|
| **T0** | Sandbox | 0–199 |
| **T1** | Observed | 200–349 |
| **T2** | Provisional | 350–499 |
| **T3** | Monitored | 500–649 |
| **T4** | Standard | 650–799 |
| **T5** | Trusted | 800–875 |
| **T6** | Certified | 876–950 |
| **T7** | Autonomous | 951–1000 |

## Architecture

ACI defines a 5-layer security architecture:

| Layer | Name | Purpose |
|-------|------|---------|
| **L1** | Identity | ACI format, DID method, registration |
| **L2** | Verification | Attestations, capability proofs, trust scoring |
| **L3** | Authorization | OpenID claims, OAuth scopes, policy enforcement |
| **L4** | Runtime Assurance | Extension protocol, governance hooks, monitoring |
| **L5** | Semantic Governance | Instruction integrity, output binding, context auth |

## Quick Start

```bash
npm install @vorionsys/aci-spec
```

```typescript
import { parseACI, validateACI, satisfiesRequirements } from '@vorionsys/aci-spec';

// Parse an ACI string
const parsed = parseACI('aci:agentanchor:vorion:classifier/FH/L3/T5/1.0.0');

// Validate format
const result = validateACI('aci:agentanchor:vorion:classifier/FH/L3/T5/1.0.0');

// Check if agent meets requirements
const meets = satisfiesRequirements(parsed, {
  requiredDomains: ['F'],
  minimumLevel: 'L2',
  minimumTrust: 'T4',
});
```

## Integration Points

- **[DID Method](/specs/did-method)** — `did:aci` for W3C Decentralized Identifiers
- **[OpenID Connect](/specs/openid-claims)** — JWT/OIDC claims for capability-aware auth
- **[Registry API](/specs/registry-api)** — Agent Naming Service (ANS) for registration & discovery
- **[Extensions](/specs/extensions)** — Layer 4 runtime governance protocol

## Ecosystem

| Project | Description | Link |
|---------|-------------|------|
| **Vorion** | AI-native trust & compliance platform | [vorion.org](https://vorion.org) |
| **BASIS** | Baseline Authority for Safe & Interoperable Systems | [basis.vorion.org](https://basis.vorion.org) |
| **ATSF** | Agentic Trust Scoring Framework | [atsf.vorion.org](https://atsf.vorion.org) |
| **Cognigate** | AI governance gateway & policy engine | [cognigate.dev](https://cognigate.dev) |
| **AgentAnchor** | Agent identity & attestation registry | [agentanchorai.com](https://agentanchorai.com) |
