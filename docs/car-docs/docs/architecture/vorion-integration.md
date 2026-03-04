---
sidebar_position: 2
title: Vorion Integration
---

# Vorion Integration

Vorion is the **first validated implementation** of the CAR specification. Its production deployment proves the CAR architecture works at scale.

## Component Mapping

Vorion's 6 core components map directly to CAR's three-layer architecture:

| Vorion Component | CAR Layer | Purpose |
|-----------------|-----------|---------|
| **INTENT** | Layer 1 | Agent classification, goal declaration |
| **BASIS** | Layer 1+2 | Behavioral safety standard, compliance framework |
| **ENFORCE** | Layer 2 | Policy enforcement, capability gating |
| **COGNIGATE** | Layer 3 | Runtime governance, policy engine |
| **PROOF** | Layer 2+3 | Attestation management, evidence chain |
| **TRUST ENGINE** | Layer 2 | Dynamic trust scoring (0–1000) |

## Trust Score Computation

Vorion's Trust Engine implements the CAR trust scoring formula:

```typescript
// Certification weight mapping
const CERT_WEIGHTS = {
  T0: 0.0,  T1: 0.2,  T2: 0.4,  T3: 0.6,
  T4: 0.8,  T5: 0.9,  T6: 0.95, T7: 1.0
};

function computeTrustScore(agent: CARAgent): number {
  const certification = CERT_WEIGHTS[agent.certificationTier] * 300;
  const behavior = agent.behaviorScore * 400;  // 0.0 - 1.0
  const context = agent.contextScore * 300;     // 0.0 - 1.0

  return Math.min(1000, Math.round(certification + behavior + context));
}

function effectiveAutonomy(certTier: number, runtimeTier: number): number {
  return Math.min(certTier, runtimeTier);
}
```

## Ceiling Enforcement

Vorion enforces regulatory and organizational trust ceilings:

```
┌─────────────────────────────────────────────┐
│ Regulatory Ceiling (EU AI Act: T4 max)      │
│ ┌─────────────────────────────────────────┐ │
│ │ Organizational Ceiling (Policy: T5 max) │ │
│ │ ┌─────────────────────────────────────┐ │ │
│ │ │ Agent Trust Score: 842 (T5)         │ │ │
│ │ │                                     │ │ │
│ │ │ Effective: MIN(T5, T5, T4) = T4    │ │ │
│ │ └─────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## Role Gates (Three-Layer Evaluation)

Before granting an agent a role, Vorion evaluates three gates:

| Gate | Layer | Check | Override? |
|------|-------|-------|-----------|
| **Kernel** | Core | Minimum tier for requested level | Never |
| **Policy** | Org | Organization-specific policies | Admin only |
| **BASIS** | Safety | Behavioral safety requirements | Safety board |

```
Agent requests L4 role
  → Kernel: T3+ required? ✅
  → Policy: Org allows L4 for this domain? ✅
  → BASIS: Behavioral safety threshold met? ✅
  → GRANTED
```

## Hierarchical Context

Vorion implements 4-tier context hierarchy with hash chain integrity:

| Level | Context | Example |
|-------|---------|---------|
| **Global** | Cross-org defaults | CAR spec minimums |
| **Registry** | Per-registry rules | AgentAnchor policies |
| **Organization** | Org-specific policies | Vorion rules |
| **Agent** | Individual overrides | Agent-specific constraints |

Each level's configuration hashes its parent's config, creating tamper-evident chains.

## Federated Presets

Trust scoring weights can be customized via a 3-tier derivation chain:

```
CAR Defaults → Registry Presets → Org Presets
     │               │                │
   Base            Override         Override
   weights         max delta        max delta
                   ±0.1             ±0.05
```

## Human-Centric Design ("Ralph Wiggum" Standard)

Vorion implements CAR's human-centric design requirements:

### Petnames
Agents get human-friendly names alongside their CAR strings.

### Traffic Light System
Trust tiers map to familiar colors (red → yellow → green → blue → purple → cyan).

### AI Nutrition Label
```
📍 Purpose: Helps plan events
⚙️ Can: Access calendar, search web, draft emails
✗ Cannot: Spend money, delete files, access HR data
⚠️ Limitation: May suggest outdated venue info
🔒 Trust: T4 Standard (score: 742)
```

### Just-In-Time Permissions
Agents request elevated permissions at the moment they're needed, not upfront.
