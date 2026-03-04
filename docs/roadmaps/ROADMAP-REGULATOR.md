# Vorion for Regulators and Policy Makers

> **Read time**: 8 minutes | **Audience**: Policy makers, compliance officers, standards bodies, legal counsel

## Executive Summary

Vorion is open-source governance infrastructure for AI agents. It provides four capabilities that regulatory frameworks require but no standard currently delivers:

1. **Agent Identity** — Every AI agent gets a unique, verifiable identifier (CAR ID)
2. **Behavioral Constraints** — Machine-readable rules that define what an agent can and cannot do (BASIS)
3. **Runtime Enforcement** — Real-time verification that agent actions comply with constraints (Cognigate)
4. **Immutable Audit Trail** — Tamper-evident record of every governance decision (PROOF chain)

This is not an AI model. It is governance infrastructure — the layer between AI capabilities and compliant operations.

## Regulatory Alignment

### EU AI Act — Article-by-Article Mapping

| EU AI Act Requirement | Article | Vorion Component | How |
|----------------------|---------|-----------------|-----|
| Risk classification | Art. 6 | ATSF Trust Tiers | 8-tier classification (T0-T7) maps to risk levels |
| Risk management system | Art. 9 | BASIS + Cognigate | Constraints define acceptable behavior; Cognigate enforces |
| Data governance | Art. 10 | PROOF Chain | All data processing decisions recorded with dual-hash integrity |
| Technical documentation | Art. 11 | CAR Registry + ADRs | Agent specifications, capability declarations, architecture records |
| Record-keeping | Art. 12 | PROOF Chain | Immutable, timestamped, queryable audit trail |
| Transparency | Art. 13 | Trust Scores + PROOF | Behavioral metrics visible; decision rationale recorded |
| Human oversight | Art. 14 | Trust Tiers T0-T3 | Lower-tier agents require human approval for actions |
| Accuracy & robustness | Art. 15 | ATSF Scoring | Competence and reliability dimensions with continuous measurement |
| Quality management | Art. 17 | CI/CD + SBOM | 15 automated pipelines, software bill of materials |
| Conformity assessment | Art. 43 | Compliance Reports | Exportable evidence packages from PROOF chain |
| Post-market monitoring | Art. 72 | Trust Score Drift | Continuous behavioral monitoring with degradation alerts |

### NIST AI Risk Management Framework

| NIST AI RMF Function | Vorion Component | Coverage |
|---------------------|-----------------|----------|
| **GOVERN** | BASIS constraint specification | Policies encoded as machine-readable rules |
| **MAP** | CAR Registry + ATSF classification | Agent inventory with risk-tier classification |
| **MEASURE** | ATSF Trust Scoring (5 dimensions) | Continuous quantitative measurement of behavioral reliability |
| **MANAGE** | Cognigate enforcement + Trust Tiers | Runtime enforcement with graduated autonomy controls |

### ISO/IEC 42001 — AI Management System

| ISO 42001 Clause | Vorion Coverage | Status |
|-----------------|----------------|--------|
| 4. Context | CAR Registry (agent inventory, stakeholder mapping) | Implemented |
| 5. Leadership | Council governance model (16-agent deliberation) | Designed |
| 6. Planning | BASIS constraints (risk-based rules) | Implemented |
| 7. Support | SDK + documentation + training (Kaizen) | Partial |
| 8. Operation | Cognigate (runtime governance engine) | Implemented |
| 9. Performance evaluation | ATSF scoring + PROOF audit trail | Implemented |
| 10. Improvement | Trust score trending + drift detection | Designed |

## Technical Architecture (Non-Technical Summary)

```
┌─────────────────────────────────────────────────┐
│                 PROOF CHAIN                      │
│     Immutable record of every decision           │
│     (think: blockchain for governance, not crypto)│
└────────────────────┬────────────────────────────┘
                     │ records
┌────────────────────┴────────────────────────────┐
│               COGNIGATE                          │
│     Real-time: "Is this agent allowed to         │
│     do this action under these constraints?"     │
└────────────────────┬────────────────────────────┘
                     │ checks against
┌────────────────────┴────────────────────────────┐
│            BASIS CONSTRAINTS                     │
│     Machine-readable rules:                      │
│     - What the agent CAN do                      │
│     - What the agent CANNOT do                   │
│     - Under what conditions                      │
│     - With what level of human oversight         │
└────────────────────┬────────────────────────────┘
                     │ applied to
┌────────────────────┴────────────────────────────┐
│             CAR REGISTRY                         │
│     Unique identity for every AI agent:          │
│     - Who built it                               │
│     - What it does                               │
│     - What model(s) it uses                      │
│     - Current trust tier (T0-T7)                 │
└─────────────────────────────────────────────────┘
```

## Trust Scoring — What It Is and What It Is Not

### What It Is

A **behavioral reliability metric**. It measures how consistently an agent operates within its defined constraints over time. The 8-tier model (T0-T7) determines the level of autonomous authority an agent earns:

- **T0-T1**: All actions require human approval (high risk, new agents)
- **T2-T3**: Standard operations auto-approved, novel actions flagged
- **T4-T5**: Broad operational autonomy within defined domains
- **T6-T7**: Full autonomy with audit-only oversight (proven track record)

Trust scores are computed from 5 measurable dimensions:
1. **Competence**: Task success rate
2. **Reliability**: Consistency of behavior
3. **Integrity**: Adherence to constraints
4. **Benevolence**: Alignment with declared objectives
5. **Transparency**: Quality of decision explanations

### What It Is Not

- It is **not** an AI alignment guarantee
- It is **not** a safety certification
- It is **not** a replacement for human judgment on high-stakes decisions
- It is a **quantitative input** to governance decisions, not the final authority

## PROOF Chain — Audit Trail Architecture

Every governance decision produces an immutable PROOF record:

| Field | Purpose |
|-------|---------|
| Timestamp | When the decision was made |
| Agent ID (CAR) | Which agent was involved |
| Action requested | What the agent wanted to do |
| Constraints evaluated | Which BASIS rules were checked |
| Decision | Approved, denied, or escalated |
| Trust score at time | Agent's behavioral reliability at decision time |
| Content hash (SHA-256) | Integrity of this individual record |
| Chain hash (SHA-256) | Integrity of the entire chain up to this point |

**Dual-hash design**: Content hash proves this record wasn't altered. Chain hash proves no records were inserted, deleted, or reordered. Together they provide tamper-evident integrity without requiring distributed consensus (no blockchain overhead).

## Availability Timeline

| Date | What's Available | Regulatory Use |
|------|-----------------|----------------|
| **Feb 26** | Open standards (npm packages) | Evaluate the specification |
| **Mar 16** | Live API + developer tools | Test governance flows |
| **Mar 30** | Enterprise portal (invite-only) | Pilot with regulated entities |
| **Apr 20** | Operations console | Monitoring and compliance reporting |
| **May 4** | Documentation + training | Staff training, audit preparation |

## Limitations (Honest Disclosures)

| Area | Current State | Planned |
|------|--------------|---------|
| Certification | No formal certification | Standards body engagement planned H2 2026 |
| Jurisdiction | No jurisdiction-specific customization | Configurable policy engine allows jurisdictional rules |
| Audit by third party | Not independently audited | SOC 2 Type II planned for Q4 2026 |
| Scale | Tested at development scale | Production load testing planned for Wave 3 |
| Federated governance | Single-node only | Multi-node federation designed, not built (Phase 9) |
| Formal verification | Not formally verified | Research track, not near-term |

## Open Source Commitment

The governance standards (BASIS, CAR, ATSF, PROOF specification) are released under Apache-2.0. This means:

- Anyone can implement the standard
- No vendor lock-in to Vorion's commercial platform
- Standards can evolve through community governance
- Regulatory bodies can reference the standard without licensing concerns

## Contact

For regulatory inquiries, compliance assessments, or pilot programs with regulated entities, Vorion is available for direct engagement.

## One Line

Vorion provides the technical infrastructure to implement what regulations require: identity, constraints, enforcement, and audit trails for every AI agent in operation.
