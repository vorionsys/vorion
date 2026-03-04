# ADR-006: User Decides Risk, System Enforces Caps

**Status:** Accepted
**Date:** 2026-01-31
**Deciders:** Vorion Architecture Team

## Context

AI governance platforms must balance user autonomy with safety. Users have different risk tolerances; the platform must enforce boundaries without making risk decisions for users.

## Decision

Establish clear liability boundaries:

1. **Users decide risk tolerance** - What level of agent autonomy they're comfortable with
2. **System enforces tier capability caps** - Agents cannot exceed their tier's capabilities
3. **Platform provides information, not decisions** - Trust scores inform, not dictate

### Responsibility Matrix

| Decision | Owner |
|----------|-------|
| "Should I use this T3 agent for financial ops?" | User |
| "Can this T3 agent access external APIs?" | System (No, requires T4+) |
| "Is the trust score accurate?" | System |
| "Is this risk acceptable for my business?" | User |

### Capability Caps by Tier

System ENFORCES these caps regardless of user preference:

| Tier | Maximum Capabilities |
|------|---------------------|
| T0-T1 | Read-only, no external access |
| T2-T3 | Basic operations, supervised |
| T4 | External APIs, policy-governed |
| T5 | Cross-agent communication |
| T6 | Admin tasks, agent spawning |
| T7 | Full autonomy |

### What This Means

- User CAN give a T3 agent T3-level permissions (their choice)
- User CANNOT give a T3 agent T5-level permissions (system blocks)
- User CANNOT lower an agent's tier to bypass monitoring
- User CAN choose not to use an agent they deem too risky

## Consequences

### Positive

- Clear liability boundaries
- User autonomy respected
- System cannot be blamed for user risk choices
- Regulatory defensibility

### Negative

- Users may make poor risk decisions
- Support burden for explaining risk
- Potential for user frustration at caps

### Mitigations

- Clear documentation of tier capabilities
- In-product warnings for high-risk configurations
- Analytics on risk distribution for product decisions

## Legal Framing

```
Platform provides:
- Accurate trust scoring
- Capability enforcement
- Audit trail

User provides:
- Risk tolerance decisions
- Agent selection
- Business judgment
```

## References

- [PLATFORM-ARCHITECTURE.md](../PLATFORM-ARCHITECTURE.md)
- Terms of Service (to be written)
