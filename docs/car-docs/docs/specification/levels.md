---
sidebar_position: 3
title: Capability Levels
---

# Capability Levels

CAR defines 8 capability levels (L0–L7) that describe an agent's degree of autonomy. Levels are hierarchical — each level includes all abilities from lower levels.

## Level Table

| Level | Name | Approval Model | Key Abilities (cumulative) |
|-------|------|---------------|---------------------------|
| **L0** | Observe | Every action | Read, monitor, report |
| **L1** | Advise | Every action | + Analyze, recommend |
| **L2** | Draft | Before commit | + Draft, stage changes |
| **L3** | Execute | Per action | + Execute/modify with approval |
| **L4** | Autonomous | Exception-based | + Execute within bounds, delegate |
| **L5** | Trusted | Minimal | + Execute with expanded scope |
| **L6** | Certified | Audit-only | + Execute independently, spawn agents |
| **L7** | Sovereign | None | + Execute anything, override constraints |

## Level Categories

### Advisory (L0–L2) — Human Decides

Agents at these levels cannot execute actions independently. They observe, analyze, and prepare work for human review.

- **L0 Observe**: Pure monitoring — read-only access to system state
- **L1 Advise**: Can analyze data and provide recommendations
- **L2 Draft**: Can prepare and stage changes for human review

### Supervised (L3–L4) — Agent Executes, Human Oversees

Agents at these levels can take action, but within constraints and with human oversight.

- **L3 Execute**: Can perform actions with explicit per-action approval
- **L4 Autonomous**: Can operate within predefined policy bounds; escalates exceptions

### Trusted (L5–L7) — Agent Leads

Reserved for highly trusted agents with strong certification and behavioral history.

- **L5 Trusted**: Minimal oversight, expanded operational scope
- **L6 Certified**: Third-party audited, can spawn sub-agents
- **L7 Sovereign**: Full system authority, no constraints

## Minimum Trust Requirements

Each level requires a minimum certification tier:

| Level | Min Tier | Rationale |
|-------|----------|-----------|
| L0–L2 | T0 | Advisory only — low risk |
| L3 | T2 | Execution requires verification |
| L4 | T3 | Autonomy requires monitoring |
| L5 | T4 | Expanded scope requires standard certification |
| L6 | T5 | Agent spawning requires high trust |
| L7 | T7 | Full authority requires highest assurance |

## Level Enforcement

```typescript
import { canExecuteAtLevel } from '@vorion/car-client';

// Check if agent's trust tier allows the requested level
const allowed = canExecuteAtLevel({
  agentLevel: 4,     // L4 Autonomous
  agentTier: 3,      // T3 Monitored
  requestedLevel: 4, // Requesting L4 actions
});
// allowed: true (T3 >= T3 required for L4)

const denied = canExecuteAtLevel({
  agentLevel: 4,
  agentTier: 1,      // T1 Observed — too low for L4
  requestedLevel: 4,
});
// denied: false (T1 < T3 required for L4)
```

## Delegation Rules

When an agent delegates to a sub-agent, the delegatee's effective level is capped:

```
Delegatee.effectiveLevel = MIN(Delegatee.level, Delegator.level - 1)
```

An L4 agent can delegate to an L3 sub-agent but not to an L4 or higher.
