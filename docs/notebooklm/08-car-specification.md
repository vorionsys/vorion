# CAR Specification v1.0
## Categorical Agentic Registry (CAR) Standard
## Source: docs/CAR-SPECIFICATION.md

**Version:** 1.0.0 | **Status:** Draft | **Date:** 2026-01-26

---

## Abstract

The Categorical Agentic Registry (CAR) standard defines a comprehensive framework for AI agent identity and registration. It establishes protocols for trust computation, role-based access control, regulatory compliance, and provenance tracking across multi-agent systems.

This specification is the result of five architecture decisions (Q1-Q5) that address production-grade requirements for AI agent governance.

---

## Trust Tiers

| Tier | Name | Score Range | Description |
|------|------|-------------|-------------|
| T0 | Sandbox | 0-199 | Isolated testing, no external access |
| T1 | Observed | 200-349 | Limited operations under supervision |
| T2 | Provisional | 350-499 | Constrained autonomy |
| T3 | Monitored | 500-649 | Normal operational capabilities |
| T4 | Standard | 650-799 | Standard operations, reduced oversight |
| T5 | Trusted | 800-875 | Elevated privileges, light oversight |
| T6 | Certified | 876-950 | Independent operation within bounds |
| T7 | Autonomous | 951-1000 | Full autonomy, self-governance |

### Tier Transitions
- Transitions between tiers MUST be logged
- Downward transitions require immediate role reevaluation
- Upward transitions MAY require attestation verification

---

## Agent Roles

| Role | Level | Min Tier | Description | Capabilities |
|------|-------|----------|-------------|--------------|
| R-L0 | Listener | T0 | Passive observation | Read-only access |
| R-L1 | Executor | T0 | Task execution | Single actions |
| R-L2 | Planner | T1 | Multi-step planning | Sequences |
| R-L3 | Orchestrator | T2 | Agent coordination | Multi-agent |
| R-L4 | Architect | T3 | System design | Infrastructure |
| R-L5 | Governor | T4 | Policy control | Rule modification |
| R-L6 | Sovereign | T5 | Full autonomy | Unrestricted |
| R-L7 | Meta-Agent | T5 | Agent creation | Spawn agents |
| R-L8 | Ecosystem | T5 | System control | Full ecosystem |

---

## Q1: Ceiling Enforcement

Dual-layer trust score limits:
1. **Regulatory Ceiling**: Jurisdiction-mandated maximum
2. **Organizational Ceiling**: Deployment-specific maximum

### Regulatory Ceilings

| Framework | Max Score | Retention | Reference |
|-----------|-----------|-----------|-----------|
| EU AI Act | 699 | 7 years | Article 6 |
| NIST AI RMF | 899 | 5 years | -- |
| ISO 42001 | 799 | 5 years | -- |
| Default | 1000 | 1 year | -- |

### Ceiling Computation
```
effectiveCeiling = min(regulatoryCeiling, organizationalCeiling)
finalScore = min(proposedScore, effectiveCeiling)
```

### Gaming Detection
Implementations MUST detect:
| Pattern | Threshold | Window |
|---------|-----------|--------|
| Rapid Change | 100 points | 60 seconds |
| Oscillation | 3 reversals | 5 minutes |
| Boundary Testing | 5 near-ceiling hits | 10 minutes |
| Ceiling Breach | Any attempt | Immediate |

---

## Q2: Hierarchical Context

4-tier context hierarchy:
1. **Deployment** -- Top level (region, environment)
2. **Organization** -- Tenant/company level
3. **Agent** -- Individual agent level
4. **Operation** -- Per-action level

Contexts are hierarchical: agent context inherits from org, which inherits from deployment. Lower contexts can restrict but never expand permissions beyond parent.

---

## Q3: Role Gates (3-Layer Evaluation)

Every role assignment passes through 3 evaluation layers:

1. **Kernel Layer** -- Hard-coded tier-to-role matrix (cannot be overridden)
2. **Policy Layer** -- Deployment-specific policies (can restrict beyond kernel)
3. **BASIS Layer** -- Trust factor evaluation (can escalate for human review)

Decision: ALLOW | DENY | ESCALATE

If any layer denies, the request is denied. Escalation routes to human review.

---

## Q4: Federated Presets

Weight preset derivation chains:

```
ACI Presets (industry standard)
  -> Vorion Presets (platform customization)
    -> Axiom Presets (deployment-specific)
```

Each level derives from its parent with:
- Hash chain verification (tamper detection)
- Bounded deviation (child can't deviate >20% from parent)
- Lineage tracking (full derivation history)

---

## Q5: Provenance

Immutable agent origin tracking:

### Creation Types

| Type | Trust Modifier | Description |
|------|---------------|-------------|
| FRESH | 0 | Newly created agent |
| CLONED | -100 | Copied from existing agent |
| EVOLVED | -50 | Modified from existing agent |
| PROMOTED | +50 | Elevated from lower role |
| IMPORTED | -200 | Transferred from external system |

### Provenance Records
- Immutable once created
- Hash-chained for integrity
- Include: creation type, parent agent, creator, trust modifier, metadata
- All provenance events logged to proof chain

---

## CAR String Format

Agent identifiers follow the CAR string format:

```
registry.organization.class:DOMAINS-Ln@version
```

Example: `a3i.acme-corp.invoice-bot:ABF-L3@1.0.0`

Components:
- `a3i` -- Registry (always a3i for Vorion)
- `acme-corp` -- Organization
- `invoice-bot` -- Agent class
- `ABF` -- Domain codes (Accounting, Business, Finance)
- `L3` -- Capability level (0-7)
- `1.0.0` -- Semantic version

---

## Compliance Frameworks

| Framework | Ceiling | Retention | Special Rules |
|-----------|---------|-----------|---------------|
| **EU AI Act** | 699 (high-risk) | 7 years | Mandatory human oversight for high-risk |
| **NIST AI RMF** | 899 | 5 years | Govern, Map, Measure, Manage functions |
| **ISO 42001** | 799 | 5 years | AI management system alignment |
| **Default** | 1000 | 1 year | No additional restrictions |

---

## Security Considerations

- All API communication MUST use TLS 1.3+
- Trust scores MUST NOT be self-reported by agents
- Ceiling enforcement MUST be server-side only
- Gaming detection MUST run on every score update
- Provenance records MUST be append-only
- Role gate evaluations MUST be logged immutably
