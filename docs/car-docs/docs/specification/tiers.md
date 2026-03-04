---
sidebar_position: 4
title: Certification & Trust Tiers
---

# Certification & Trust Tiers

CAR defines **two distinct tier systems**, each with 8 levels (T0–T7), that work together to determine an agent's effective autonomy.

## Dual-Tier Architecture

| System | Scope | Changes When | Determines |
|--------|-------|-------------|-----------|
| **Certification Tier** | External attestation status | Re-certification, audit | What agent *could* do |
| **Runtime Tier** | Deployment-specific autonomy | Continuously (per-action) | What agent *may* do now |

```
Effective Autonomy = MIN(Certification_Tier, Runtime_Tier)
```

A T6-certified agent deployed in a T3-rated context operates at T3.

## Certification Tiers

External, point-in-time assessment by a certification authority.

| Tier | Name | Score | Color | Description |
|------|------|-------|-------|-------------|
| **T0** | Sandbox | 0–199 | Stone | No external verification, testing only |
| **T1** | Observed | 200–349 | Red | Identity registered, behavior monitored |
| **T2** | Provisional | 350–499 | Orange | Initial capabilities verified |
| **T3** | Monitored | 500–649 | Yellow | Continuous monitoring active |
| **T4** | Standard | 650–799 | Green | Standard certification achieved |
| **T5** | Trusted | 800–875 | Blue | Full trust established |
| **T6** | Certified | 876–950 | Purple | Third-party audit completed |
| **T7** | Autonomous | 951–1000 | Cyan | Highest assurance level |

## Runtime Tiers

Continuous, context-aware trust evaluation by the Vorion Trust Engine.

Same names and score ranges as Certification Tiers, but computed dynamically:

```
Runtime Score = (Certification × 0.3) + (Behavior History × 0.4) + (Context × 0.3)
```

### Scoring Components

| Component | Weight | Sources |
|-----------|--------|---------|
| **Certification** | 30% | CAR certification tier, attestation status |
| **Behavior History** | 40% | Success rate, policy violations, drift events |
| **Context** | 30% | Deployment environment, regulatory ceiling, org policy |

### Tier Transitions

```
Score ↑ (good behavior over time) → Tier promotion
Score ↓ (violations, drift, anomaly) → Tier demotion
Revocation event → Immediate drop to T0
```

## Regulatory Ceilings

Compliance frameworks impose maximum trust scores:

| Framework | Max Score | Max Tier | Retention |
|-----------|-----------|----------|-----------|
| EU AI Act | 699 | T4 | 7 years |
| ISO 42001 | 799 | T4 | 5 years |
| NIST AI RMF | 899 | T5 | 5 years |

An agent in an EU AI Act-regulated context can never exceed T4 regardless of its certification.

## Tier-Based Permissions

| Tier | Max Level | Delegation | Key Privileges |
|------|-----------|-----------|----------------|
| T0–T1 | L2 | None | Read-only + advisory |
| T2 | L3 | None | Supervised execution |
| T3 | L4 | Depth ≤ 2 | Autonomous within bounds |
| T4 | L5 | Depth ≤ 2 | Expanded scope |
| T5–T6 | L6 | Depth ≤ 4 | Agent spawning |
| T7 | L7 | Depth ≤ 8 | Sovereign authority |

## Trust Score API

```typescript
const client = new CARClient({ endpoint: 'https://api.agentanchor.io' });

// Get current trust evaluation
const trust = await client.getTrustScore('a3i.vorion.banquet-advisor:FHC-L3@1.2.0');

console.log(trust);
// {
//   score: 742,
//   tier: 4,
//   tierName: 'Standard',
//   components: {
//     certification: 0.8,    // T5 certified
//     behavior: 0.72,        // Good history
//     context: 0.65          // Standard deployment
//   },
//   ceiling: { framework: 'NIST', maxScore: 899 },
//   evaluatedAt: '2026-02-08T12:00:00Z'
// }
```

## Gaming Detection

The CAR specification includes anti-gaming measures:

- **Sudden score jumps** trigger manual review
- **Oscillating behavior** (good/bad cycles) limits maximum achievable tier
- **Context switching** (rapid environment changes) resets behavior scoring
- **Provenance modifiers** affect starting trust for cloned/imported agents
