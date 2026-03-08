# FEATURE_PLAN_20260208.md
## Vorion Ecosystem — CAR Integration + Cross-Site Consistency + Feature Roadmap

---

## 1. Executive Summary

Vorion has five live sites, a strong governance architecture, and a clear commercial product — but it's speaking with four different voices. The trust model is described differently on every site, the standard has two competing names (BASIS vs ACI), the knowledge base has two competing names (Omniscience vs Kaizen), and critical CTAs route to a 500 error. The introduction of **CAR (Categorical Agentic Registry)** is the forcing function to resolve all of this. CAR gives the ecosystem a clean identity layer, resolves the ACI naming collision, and creates the most intuitive concept in the stack: *every AI agent gets a license plate*. The biggest opportunity right now is not new features — it's making the five sites tell one coherent story, with CAR as the narrative anchor that ties registration, trust, and governance into a single thread a developer or executive can follow in under 60 seconds.

---

## 2. The Canonical Stack (Post-CAR)

This is the single source of truth. Every site, README, and SDK must align to this.

```
┌─────────────────────────────────────────────────────────────────┐
│                     THE VORION STACK                            │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  BASIS   │  │   CAR    │  │ COGNIGATE│  │  PROOF   │       │
│  │          │  │          │  │          │  │          │       │
│  │ The Law  │  │ The DMV  │  │ The      │  │ The      │       │
│  │          │  │          │  │ Engine   │  │ Receipts │       │
│  │ Open     │  │ Identity │  │ Enforce- │  │ Immutable│       │
│  │ standard │  │ registry │  │ ment     │  │ audit    │       │
│  │ for AI   │  │ for AI   │  │ runtime  │  │ trail    │       │
│  │ govern-  │  │ agents   │  │ for AI   │  │ for AI   │       │
│  │ ance     │  │          │  │ actions  │  │ decisions│       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│                                                                 │
│  Processing Pipeline:                                           │
│  REGISTER (CAR) → PARSE (INTENT) → CHECK (ENFORCE) →          │
│  LOG (PROOF) → ANCHOR (CHAIN)                                  │
│                                                                 │
│  Technical Spec: ACI (Agent Capability Interface) — the         │
│  TypeScript types and contracts that implement this stack       │
│  npm: @vorionsys/aci-spec                                       │
└─────────────────────────────────────────────────────────────────┘
```

### Naming Definitions (Canonical)

| Name | What It Is | Analogy | Owned By |
|------|-----------|---------|----------|
| **BASIS** | Open governance standard | The traffic law | Community (Apache-2.0) |
| **CAR** | Categorical Agentic Registry — identity & trust tracking | The DMV / license plate | Vorion (open spec) |
| **CAR ID** | Unique identifier issued to each registered agent | License plate number | Issued per agent |
| **ACI Spec** | Agent Capability Interface — TypeScript types & contracts | The engineering blueprint | `@vorionsys/aci-spec` (Apache 2.0) |
| **Cognigate** | Governance enforcement runtime | The traffic cop | `voriongit/cognigate` (Apache 2.0) |
| **PROOF** | Immutable audit trail layer | The dashcam footage | Part of BASIS |
| **AgentAnchor** | Commercial SaaS platform | Full-service fleet management | Vorion |
| **Kaizen** | Educational knowledge base | Driving school | learn.vorion.org |

### One-Liner Relationship

> "BASIS sets the rules. CAR identifies the agent. Cognigate enforces the decisions. PROOF keeps the receipts."

---

## 3. Canonical Trust Model (8 Tiers)

**This is the ONLY valid trust model.** All sites must converge on this.

| Tier | Name | Score Range | Capabilities | Color |
|------|------|-------------|-------------|-------|
| T0 | Sandbox | 0–199 | Isolated testing only. No production access. | Red |
| T1 | Observed | 200–349 | Read-only production. All actions logged, human review required. | Orange |
| T2 | Provisional | 350–499 | Basic write operations. Policy-checked. Elevated logging. | Orange |
| T3 | Monitored | 500–649 | Standard operations. Anomaly detection active. | Yellow |
| T4 | Standard | 650–799 | Extended operations. Reduced review for low-risk actions. | Yellow |
| T5 | Trusted | 800–875 | Privileged operations. Express path for low/medium risk. | Green |
| T6 | Certified | 876–950 | High-autonomy operations. Council review only for critical risk. | Blue |
| T7 | Autonomous | 951–1000 | Full autonomy. Auto-approve all except critical risk. | Diamond |

---

## Phase 1: Ship This Week (Consistency + CAR Foundation)

| # | Feature | What |
|---|---------|------|
| 1.1 | Broken Link Sweep | Fix all 7 critical link issues |
| 1.2 | Trust Tier Alignment | Update sites to canonical 8-tier model |
| 1.3 | Stack Narrative Update | Add CAR to vorion.org stack section |
| 1.4 | Naming Alignment | Omniscience→Kaizen, ACI↔BASIS clarification |
| 1.5 | app.agentanchorai.com Triage | Fix 500 or redirect CTAs |
