# ADR-002: 8-Tier Trust Model with Human Approval Gates

**Status:** Accepted
**Date:** 2026-01-31
**Deciders:** Vorion Architecture Team

## Context

AI agents require a trust framework that balances autonomy with safety. Previous industry approaches (binary trust, 3-tier models) lack granularity for production AI governance.

## Decision

Implement an 8-tier trust model (T0-T7) with strategic human approval gates at critical transitions.

### Tier Definitions

| Tier | Name | Range | Human Gate |
|------|------|-------|------------|
| T0 | Sandbox | 0-199 | Entry requires BASIS compliance |
| T1 | Observed | 200-349 | **Yes** - Exit from sandbox |
| T2 | Provisional | 350-499 | No |
| T3 | Monitored | 500-649 | No |
| T4 | Standard | 650-799 | No |
| T5 | Trusted | 800-875 | **Yes** - Cross-agent privileges |
| T6 | Certified | 876-950 | **Yes** - Admin capabilities |
| T7 | Autonomous | 951-1000 | **Yes** - Full autonomy |

### Human Approval Gates

Gates at T0→T1, T4→T5, T5→T6, T6→T7 require explicit human approval because:

- **T0→T1:** Agent exits sandbox into production observation
- **T4→T5:** Agent gains cross-agent communication rights
- **T5→T6:** Agent gains administrative capabilities
- **T6→T7:** Agent achieves full autonomy

## Consequences

### Positive

- Granular capability gating
- Clear progression path for agents
- Human oversight at high-stakes transitions
- Compatible with regulatory requirements (EU AI Act)

### Negative

- Complexity in tier boundary logic
- Human approval creates bottlenecks
- Score gaming risk

### Mitigations

- Anti-gaming detection with automatic penalties
- Asynchronous approval workflows
- Clear documentation of tier requirements

## Alternatives Considered

1. **5-tier model** - Rejected; insufficient granularity for enterprise
2. **Continuous score without tiers** - Rejected; harder to enforce capabilities
3. **Human gates at every transition** - Rejected; too much friction

## References

- [trust-factors-v2.md](../../packages/basis/specs/trust-factors-v2.md)
- [PLATFORM-ARCHITECTURE.md](../PLATFORM-ARCHITECTURE.md) Section 3
