# ADR-005: Agent Lifecycle State Machine

**Status:** Accepted
**Date:** 2026-01-31
**Deciders:** Vorion Architecture Team

## Context

Agents need clear lifecycle states beyond just trust tiers. Problematic agents must have defined remediation and removal paths.

## Decision

Implement a formal state machine with active tiers (T0-T7) and exception states (Quarantine, Suspended, Revoked, Expelled).

### State Diagram

```
UNREGISTERED
     │
     │ BASIS Compliance
     ▼
T0 ──► T1 ──► T2 ──► T3 ──► T4 ──► T5 ──► T6 ──► T7
 │                                                  │
 └─────────────────────────────────────────────────┘
                       │
    ┌──────────────────┴───────────────────┐
    │                                       │
    ▼                                       ▼
QUARANTINE ──► SUSPENDED ──► REVOKED ──► EXPELLED
```

### Exception State Rules

| State | Duration | Entry Condition | Exit Condition |
|-------|----------|-----------------|----------------|
| Quarantine | Until resolved | Trust concern detected | X successful actions |
| Suspended | 30 days | 3 quarantines in 30 days OR quarantine timeout | Period ends |
| Revoked | 6 months | 3rd suspension | Review + reinstatement |
| Expelled | Permanent | 2nd revocation OR malicious intent | None |

### Transition Rules

1. **3 quarantines in 30 days** → Suspension
2. **Quarantine timeout** → Suspension
3. **3rd suspension** → Revocation
4. **2nd revocation** → Expulsion
5. **Malicious/harmful intent** → Immediate expulsion

### Redemption Paths

All non-expelled agents have redemption paths:
- Quarantine: Demonstrate good behavior
- Suspended: Wait period + maintenance
- Revoked: 6-month wait + review

## Consequences

### Positive

- Clear, predictable consequences for violations
- Redemption paths for non-malicious failures
- Permanent ban only for repeat/malicious offenders
- Auditable state transitions

### Negative

- Complex state machine logic
- Requires tracking violation history
- Human judgment needed for "malicious intent" determination

### Mitigations

- Immutable event log for all state transitions
- Clear criteria documentation
- Human oversight for expulsion decisions

## User vs Agent Accountability

| Entity | Can Be Blocked | Reason |
|--------|----------------|--------|
| Agent | Yes | Performance issues, violations |
| User | Only for malice | Building agents of ill intent, deception |

Users are NOT blocked for agent mistakes (non-malicious). Only deliberate Terms of Service violations result in user blocking.

## References

- [PLATFORM-ARCHITECTURE.md](../PLATFORM-ARCHITECTURE.md) Section 3
