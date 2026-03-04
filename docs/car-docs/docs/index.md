---
slug: /
sidebar_position: 1
title: Overview
---

# Categorical Agentic Registry (CAR)

The **Categorical Agentic Registry** is the mission certification standard for autonomous AI agents. Before an agent can operate in any domain, it needs a mission profile — a compact, verifiable record of who it is, what it's certified to do, and where it's authorized to operate. CAR defines how mission profiles are structured, issued, and verified across organizational boundaries.

## The Problem

As AI agents become autonomous actors in enterprise systems, Mission Control needs answers:

- **Identification**: Which agents are certified for this mission domain?
- **Clearance**: What clearance level has this agent earned through demonstrated performance?
- **Routing**: How do you direct missions to the right qualified agent?
- **Governance**: How do you enforce mission rules and regulatory compliance?

## The Solution: Mission Profile (CAR String)

CAR provides a compact, machine-parseable mission profile that encodes an agent's certification — identity, capabilities, and version:

```
a3i.vorion.banquet-advisor:FHC-L3@1.2.0
 │     │         │         │   │   └── Version (semver)
 │     │         │         │   └── Capability Level (Execute)
 │     │         │         └── Domains (Finance + Hospitality + Communications)
 │     │         └── Agent Class
 │     └── Organization
 └── Registry
```

**Key design decision**: Trust tier is **not** part of the CAR string — it is computed at runtime from certification status, behavioral history, and deployment context.

```
Effective Autonomy = MIN(CAR_Certification, Vorion_Runtime_Score)
```

## Core Components

### Capability Domains (10 codes)

| Code | Domain | Description |
|------|--------|-------------|
| **A** | Administration | System admin, user management |
| **B** | Business | Business logic, workflows, approvals |
| **C** | Communications | Email, messaging, notifications |
| **D** | Data | Data processing, analytics, reporting |
| **E** | External | Third-party integrations, APIs |
| **F** | Finance | Financial operations, payments, accounting |
| **G** | Governance | Policy, compliance, oversight |
| **H** | Hospitality | Venue, events, catering management |
| **I** | Infrastructure | Compute, storage, networking |
| **S** | Security | Authentication, authorization, audit |

### Capability Levels (8 levels)

| Level | Name | Approval Model |
|-------|------|---------------|
| **L0** | Observe | Every action (read-only) |
| **L1** | Advise | Every action (recommendations) |
| **L2** | Draft | Before commit (staging) |
| **L3** | Execute | Per action (human approves) |
| **L4** | Autonomous | Exception-based (policy bounds) |
| **L5** | Trusted | Minimal oversight |
| **L6** | Certified | Audit-only |
| **L7** | Sovereign | None |

### Clearance Tiers (8 tiers)

| Tier | Name | Score Range | Mission Control Frame |
|------|------|-------------|----------------------|
| **T0** | Sandbox | 0–199 | **Simulation Only** — Training missions, no live operations |
| **T1** | Observed | 200–349 | **Ground Restricted** — Operates under direct supervision |
| **T2** | Provisional | 350–499 | **Limited Clearance** — Approved for routine missions with monitoring |
| **T3** | Monitored | 500–649 | **Standard Clearance** — Trusted for standard operations, spot-checked |
| **T4** | Standard | 650–799 | **Elevated Clearance** — Broad operational authority, periodic review |
| **T5** | Trusted | 800–875 | **High Clearance** — Trusted for sensitive missions |
| **T6** | Certified | 876–950 | **Full Clearance** — Certified for all authorized domains |
| **T7** | Autonomous | 951–1000 | **Autonomous Authority** — Self-directed within mission parameters |

## Three-Layer Architecture

| Layer | Name | Purpose |
|-------|------|---------|
| **1** | Identity & Trust Primitives | WHO (DIDs, OIDC) + WHAT (Domains/Levels/Tiers) |
| **2** | Capability Certification & Extensions | What agent can do, how verified |
| **3** | Semantic Governance & Runtime Assurance | Behavioral monitoring, drift detection |

## CAR as a Unified System

CAR is both the **identifier format** and the **registry and certification layer**. The [CAR specification](https://aci.vorion.org) defines the identifier format, protocol standards, and adds:

- Runtime trust scoring (behavioral + certification + context)
- Registry API for agent discovery and management
- Certification workflow and attestation management
- Client SDKs (TypeScript, Python) and CLI tools

## Ecosystem

| Project | Description | Link |
|---------|-------------|------|
| **Vorion** | Mission Control — first validated CAR implementation | [vorion.org](https://vorion.org) |
| **CAR Spec** | Categorical Agentic Registry standard | [npmjs.com/@vorionsys/car-spec](https://npmjs.com/package/@vorionsys/car-spec) |
| **BASIS** | Baseline Authority for Safe & Interoperable Systems | [basis.vorion.org](https://basis.vorion.org) |
| **ATSF** | Agentic Trust Scoring Framework (46 layers) | [atsf.vorion.org](https://atsf.vorion.org) |
| **Cognigate** | AI governance gateway & policy engine | [cognigate.dev](https://cognigate.dev) |
| **AgentAnchor** | Agent identity & attestation registry | [agentanchorai.com](https://agentanchorai.com) |
